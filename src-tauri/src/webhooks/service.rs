use std::sync::Arc;
use std::time::{Duration, Instant};
use reqwest::{Client, header::HeaderMap};
use serde_json;
use chrono::Utc;
use tokio::time::sleep;

use crate::webhooks::models::*;
use crate::webhooks::repository::WebhookRepository;
use crate::logger::{debug, error, info, warn, Component};

#[derive(Debug, thiserror::Error)]
pub enum WebhookError {
    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),
    
    #[error("Timeout after {0:?}")]
    Timeout(Duration),
    
    #[error("Invalid URL: {0}")]
    InvalidUrl(String),
    
    #[error("Database error: {0}")]
    Database(String),
    
    #[error("Webhook not found")]
    NotFound,
    
    #[error("Max retries exceeded")]
    MaxRetriesExceeded,
    
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}

pub struct WebhookService {
    client: Client,
    repository: Arc<WebhookRepository>,
    max_retries: u32,
    timeout_duration: Duration,
    base_retry_delay: Duration,
}

impl WebhookService {
    pub fn new(repository: Arc<WebhookRepository>) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent(format!("Scout/{}", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("Failed to create HTTP client");

        Self {
            client,
            repository,
            max_retries: 2, // Total of 3 attempts (initial + 2 retries)
            timeout_duration: Duration::from_secs(30),
            base_retry_delay: Duration::from_secs(5),
        }
    }

    /// Deliver webhook to all enabled webhooks for a transcription
    pub async fn deliver_all_webhooks(&self, transcript: &crate::db::Transcript) -> Result<(), WebhookError> {
        let webhooks = self.repository.get_enabled().await
            .map_err(WebhookError::Database)?;

        if webhooks.is_empty() {
            debug(Component::Webhooks, "No enabled webhooks found, skipping delivery");
            return Ok(());
        }

        info(Component::Webhooks, &format!("Delivering to {} enabled webhooks", webhooks.len()));

        // Create the webhook payload
        let payload = self.create_payload(transcript).await?;

        // Deliver to all webhooks concurrently (but with some limits to avoid overwhelming)
        let delivery_tasks: Vec<_> = webhooks
            .into_iter()
            .map(|webhook| {
                let payload = payload.clone();
                let service = self.clone_for_task();
                async move { service.deliver_webhook_with_retries(&webhook, &payload).await }
            })
            .collect();

        // Execute all deliveries concurrently but limit concurrency to avoid resource exhaustion
        let semaphore = Arc::new(tokio::sync::Semaphore::new(5)); // Max 5 concurrent deliveries
        let results = futures_util::future::join_all(
            delivery_tasks.into_iter().map(|task| {
                let semaphore = semaphore.clone();
                async move {
                    let _permit = semaphore.acquire().await.unwrap();
                    task.await
                }
            })
        ).await;

        let mut failed_count = 0;
        for result in results {
            if let Err(e) = result {
                error(Component::Webhooks, &format!("Webhook delivery failed: {}", e));
                failed_count += 1;
            }
        }

        if failed_count > 0 {
            warn(Component::Webhooks, &format!("{} webhook deliveries failed", failed_count));
        }

        Ok(())
    }

    /// Test webhook delivery with a sample payload
    pub async fn test_webhook(&self, webhook_id: i64) -> Result<TestResult, WebhookError> {
        let webhook = self.repository.get_by_id(webhook_id).await
            .map_err(WebhookError::Database)?
            .ok_or(WebhookError::NotFound)?;

        let test_payload = self.create_test_payload().await;
        let start_time = Instant::now();
        
        let result = self.attempt_delivery(&webhook, &test_payload, 1).await;
        let response_time_ms = start_time.elapsed().as_millis() as i32;

        let test_result = match &result {
            Ok(delivery_result) => TestResult {
                success: delivery_result.success,
                status_code: delivery_result.status_code.map(|s| s as i32),
                response_time_ms,
                error: delivery_result.error_message.clone(),
                tested_at: Utc::now(),
            },
            Err(e) => TestResult {
                success: false,
                status_code: None,
                response_time_ms,
                error: Some(e.to_string()),
                tested_at: Utc::now(),
            },
        };

        // Log the test attempt (but don't fail if logging fails)
        if let Ok(delivery_result) = result {
            let _ = self.repository.log_delivery(webhook_id, &delivery_result).await;
        }

        Ok(test_result)
    }

    /// Create a webhook payload from a transcript
    async fn create_payload(&self, transcript: &crate::db::Transcript) -> Result<WebhookPayload, WebhookError> {
        let transcription_data = TranscriptionData::from(transcript);
        
        // Extract model information from metadata if available
        let model_info = transcript.metadata
            .as_ref()
            .and_then(|m| serde_json::from_str::<serde_json::Value>(m).ok())
            .and_then(|metadata| {
                Some(ModelInfo {
                    name: metadata.get("model_used")?.as_str()?.to_string(),
                    version: "1.0".to_string(), // Default version
                    size: None, // TODO: Get from model metadata
                })
            })
            .unwrap_or_else(|| ModelInfo {
                name: "unknown".to_string(),
                version: "1.0".to_string(),
                size: None,
            });

        let app_info = AppInfo {
            name: "Scout".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            platform: self.get_platform(),
            arch: self.get_arch(),
        };

        Ok(WebhookPayload {
            event: "transcription.completed".to_string(),
            timestamp: Utc::now(),
            transcription: transcription_data,
            model: model_info,
            app: app_info,
        })
    }

    /// Create a test payload for webhook testing
    async fn create_test_payload(&self) -> WebhookPayload {
        let test_transcription = TranscriptionData {
            id: 0,
            text: "This is a test transcription from Scout.".to_string(),
            duration_ms: 3000,
            created_at: Utc::now().to_rfc3339(),
            audio_file: Some("test_recording.wav".to_string()),
            file_size: Some(1024000),
            word_count: 8,
            metadata: Some(serde_json::json!({
                "test": true,
                "source": "webhook_test"
            })),
        };

        let model_info = ModelInfo {
            name: "whisper-base".to_string(),
            version: "1.0".to_string(),
            size: Some("74MB".to_string()),
        };

        let app_info = AppInfo {
            name: "Scout".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            platform: self.get_platform(),
            arch: self.get_arch(),
        };

        WebhookPayload {
            event: "transcription.completed".to_string(),
            timestamp: Utc::now(),
            transcription: test_transcription,
            model: model_info,
            app: app_info,
        }
    }

    /// Deliver webhook with retry logic
    async fn deliver_webhook_with_retries(&self, webhook: &Webhook, payload: &WebhookPayload) -> Result<DeliveryResult, WebhookError> {
        let mut _last_error = None;

        for attempt in 1..=(self.max_retries + 1) {
            match self.attempt_delivery(webhook, payload, attempt as i32).await {
                Ok(result) => {
                    // Log successful delivery
                    if let Err(e) = self.repository.log_delivery(webhook.id, &result).await {
                        error(Component::Webhooks, &format!("Failed to log webhook delivery: {}", e));
                    }

                    // Update last triggered time
                    if let Err(e) = self.repository.update_last_triggered(webhook.id).await {
                        error(Component::Webhooks, &format!("Failed to update last triggered time: {}", e));
                    }

                    if result.success {
                        info(Component::Webhooks, &format!("Webhook delivered successfully to {} on attempt {}", webhook.url, attempt));
                        return Ok(result);
                    } else {
                        warn(Component::Webhooks, &format!("Webhook delivery failed to {} on attempt {}: status {}", 
                            webhook.url, attempt, result.status_code.unwrap_or(0)));
                        _last_error = result.error_message.clone();
                    }
                }
                Err(e) => {
                    error(Component::Webhooks, &format!("Webhook delivery error to {} on attempt {}: {}", webhook.url, attempt, e));
                    _last_error = Some(e.to_string());
                }
            }

            // Don't sleep after the last attempt
            if attempt <= self.max_retries {
                let delay = self.base_retry_delay * (2_u32.pow(attempt - 1)); // Exponential backoff
                debug(Component::Webhooks, &format!("Retrying webhook delivery in {:?}", delay));
                sleep(delay).await;
            }
        }

        Err(WebhookError::MaxRetriesExceeded)
    }

    /// Attempt a single webhook delivery
    async fn attempt_delivery(&self, webhook: &Webhook, payload: &WebhookPayload, attempt: i32) -> Result<DeliveryResult, WebhookError> {
        let start_time = Instant::now();
        
        // Parse custom headers if any
        let mut headers = HeaderMap::new();
        headers.insert("Content-Type", "application/json".parse().unwrap());
        headers.insert("X-Scout-Event", payload.event.parse().unwrap());
        headers.insert("X-Request-ID", uuid::Uuid::new_v4().to_string().parse().unwrap());

        if let Some(custom_headers_str) = &webhook.headers {
            if let Ok(custom_headers) = serde_json::from_str::<serde_json::Value>(custom_headers_str) {
                if let Some(headers_obj) = custom_headers.as_object() {
                    for (key, value) in headers_obj {
                        if let Some(value_str) = value.as_str() {
                            if let (Ok(header_name), Ok(header_value)) = (
                                key.parse::<reqwest::header::HeaderName>(),
                                value_str.parse::<reqwest::header::HeaderValue>()
                            ) {
                                headers.insert(header_name, header_value);
                            }
                        }
                    }
                }
            }
        }

        // Serialize payload
        let payload_json = serde_json::to_string(payload)?;
        let _payload_size = payload_json.len() as i32;

        // Validate URL
        if !webhook.url.starts_with("http://") && !webhook.url.starts_with("https://") {
            return Ok(DeliveryResult {
                success: false,
                status_code: None,
                response_time_ms: 0,
                error_message: Some("Invalid URL: must start with http:// or https://".to_string()),
                attempt_number: attempt,
                request_headers: Some(self.headers_to_json(&headers)),
                response_headers: None,
            });
        }

        // Make the HTTP request
        let response = match self
            .client
            .post(&webhook.url)
            .headers(headers.clone())
            .body(payload_json)
            .send()
            .await
        {
            Ok(response) => response,
            Err(e) => {
                let response_time_ms = start_time.elapsed().as_millis() as i32;
                return Ok(DeliveryResult {
                    success: false,
                    status_code: None,
                    response_time_ms,
                    error_message: Some(e.to_string()),
                    attempt_number: attempt,
                    request_headers: Some(self.headers_to_json(&headers)),
                    response_headers: None,
                });
            }
        };

        let response_time_ms = start_time.elapsed().as_millis() as i32;
        let status_code = response.status().as_u16();
        let success = response.status().is_success();
        let response_headers = Some(self.headers_to_json(response.headers()));

        let error_message = if !success {
            match response.text().await {
                Ok(body) => {
                    if body.len() > 500 {
                        Some(format!("HTTP {} - Response too large", status_code))
                    } else if body.is_empty() {
                        Some(format!("HTTP {}", status_code))
                    } else {
                        Some(format!("HTTP {}: {}", status_code, body))
                    }
                }
                Err(_) => Some(format!("HTTP {}", status_code)),
            }
        } else {
            None
        };

        Ok(DeliveryResult {
            success,
            status_code: Some(status_code),
            response_time_ms,
            error_message,
            attempt_number: attempt,
            request_headers: Some(self.headers_to_json(&headers)),
            response_headers,
        })
    }

    /// Convert HeaderMap to JSON for logging
    fn headers_to_json(&self, headers: &HeaderMap) -> serde_json::Value {
        let mut json_headers = serde_json::Map::new();
        for (name, value) in headers {
            if let Ok(value_str) = value.to_str() {
                json_headers.insert(name.to_string(), serde_json::Value::String(value_str.to_string()));
            }
        }
        serde_json::Value::Object(json_headers)
    }

    /// Get current platform string
    fn get_platform(&self) -> String {
        if cfg!(target_os = "macos") {
            "macos".to_string()
        } else if cfg!(target_os = "windows") {
            "windows".to_string()
        } else if cfg!(target_os = "linux") {
            "linux".to_string()
        } else {
            "unknown".to_string()
        }
    }

    /// Get current architecture string
    fn get_arch(&self) -> String {
        if cfg!(target_arch = "x86_64") {
            "x86_64".to_string()
        } else if cfg!(target_arch = "aarch64") {
            "aarch64".to_string()
        } else {
            "unknown".to_string()
        }
    }

    /// Clone service for use in async tasks
    fn clone_for_task(&self) -> Self {
        Self {
            client: self.client.clone(),
            repository: self.repository.clone(),
            max_retries: self.max_retries,
            timeout_duration: self.timeout_duration,
            base_retry_delay: self.base_retry_delay,
        }
    }
}
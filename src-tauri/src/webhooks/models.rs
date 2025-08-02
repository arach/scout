use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Webhook {
    pub id: i64,
    pub url: String,
    pub description: Option<String>,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
    pub last_triggered_at: Option<String>,
    pub headers: Option<String>, // JSON string for custom headers
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateWebhookDto {
    pub url: String,
    pub description: Option<String>,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    pub headers: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateWebhookDto {
    pub url: Option<String>,
    pub description: Option<String>,
    pub enabled: Option<bool>,
    pub headers: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct WebhookLog {
    pub id: i64,
    pub webhook_id: i64,
    pub timestamp: String,
    pub status: String, // 'success' or 'failure'
    pub status_code: Option<i32>,
    pub response_time_ms: Option<i32>,
    pub error_message: Option<String>,
    pub attempt_number: i32,
    pub payload_size: Option<i32>,
    pub request_headers: Option<String>,  // JSON
    pub response_headers: Option<String>, // JSON
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookPayload {
    pub event: String,
    pub timestamp: DateTime<Utc>,
    pub transcription: TranscriptionData,
    pub model: ModelInfo,
    pub app: AppInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionData {
    pub id: i64,
    pub text: String,
    pub duration_ms: i32,
    pub created_at: String,
    pub audio_file: Option<String>,
    pub file_size: Option<i64>,
    pub word_count: i32,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub name: String,
    pub version: String,
    pub size: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub platform: String,
    pub arch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestResult {
    pub success: bool,
    pub status_code: Option<i32>,
    pub response_time_ms: i32,
    pub error: Option<String>,
    pub tested_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogFilters {
    pub webhook_id: Option<i64>,
    pub status: Option<String>,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    pub page: Option<i32>,
    pub per_page: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginatedLogs {
    pub logs: Vec<WebhookLogWithUrl>,
    pub total: i64,
    pub page: i32,
    pub per_page: i32,
    pub total_pages: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookLogWithUrl {
    #[serde(flatten)]
    pub log: WebhookLog,
    pub webhook_url: String,
}

#[derive(Debug, Clone)]
pub struct DeliveryResult {
    pub success: bool,
    pub status_code: Option<u16>,
    pub response_time_ms: i32,
    pub error_message: Option<String>,
    pub attempt_number: i32,
    pub request_headers: Option<serde_json::Value>,
    pub response_headers: Option<serde_json::Value>,
}

fn default_enabled() -> bool {
    true
}

impl From<&crate::db::Transcript> for TranscriptionData {
    fn from(transcript: &crate::db::Transcript) -> Self {
        let word_count = transcript.text.split_whitespace().count() as i32;
        let metadata = transcript.metadata
            .as_ref()
            .and_then(|m| serde_json::from_str(m).ok());
            
        Self {
            id: transcript.id,
            text: transcript.text.clone(),
            duration_ms: transcript.duration_ms,
            created_at: transcript.created_at.clone(),
            audio_file: transcript.audio_path.clone(),
            file_size: transcript.file_size,
            word_count,
            metadata,
        }
    }
}
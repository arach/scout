use crate::webhooks::models::*;
use crate::webhooks::service::WebhookService;
use crate::webhooks::repository::WebhookRepository;
use crate::logger::{debug, Component};

/// Get all webhooks
#[tauri::command]
pub async fn get_webhooks(
    state: tauri::State<'_, crate::AppState>,
) -> Result<Vec<Webhook>, String> {
    debug(Component::Webhooks, "Getting all webhooks");
    
    let webhook_repo = WebhookRepository::new(state.database.get_pool());
    webhook_repo.get_all().await
}

/// Create a new webhook
#[tauri::command]
pub async fn create_webhook(
    state: tauri::State<'_, crate::AppState>,
    webhook: CreateWebhookDto,
) -> Result<Webhook, String> {
    debug(Component::Webhooks, &format!("Creating webhook: {}", webhook.url));
    
    // Basic URL validation
    if !webhook.url.starts_with("http://") && !webhook.url.starts_with("https://") {
        return Err("URL must start with http:// or https://".to_string());
    }

    // Validate URL is well-formed
    if let Err(e) = url::Url::parse(&webhook.url) {
        return Err(format!("Invalid URL format: {}", e));
    }

    // Check for duplicate URL
    let webhook_repo = WebhookRepository::new(state.database.get_pool());
    let existing_webhooks = webhook_repo.get_all().await?;
    
    if existing_webhooks.iter().any(|w| w.url == webhook.url) {
        return Err("A webhook with this URL already exists".to_string());
    }

    // Limit number of webhooks per user
    if existing_webhooks.len() >= 10 {
        return Err("Maximum number of webhooks (10) reached".to_string());
    }

    webhook_repo.create(webhook).await
}

/// Update an existing webhook
#[tauri::command]
pub async fn update_webhook(
    state: tauri::State<'_, crate::AppState>,
    id: i64,
    webhook: UpdateWebhookDto,
) -> Result<Webhook, String> {
    debug(Component::Webhooks, &format!("Updating webhook: {}", id));
    
    // Basic URL validation if URL is being updated
    if let Some(ref url) = webhook.url {
        if !url.starts_with("http://") && !url.starts_with("https://") {
            return Err("URL must start with http:// or https://".to_string());
        }

        if let Err(e) = url::Url::parse(url) {
            return Err(format!("Invalid URL format: {}", e));
        }

        // Check for duplicate URL (excluding current webhook)
        let webhook_repo = WebhookRepository::new(state.database.get_pool());
        let existing_webhooks = webhook_repo.get_all().await?;
        
        if existing_webhooks.iter().any(|w| w.id != id && w.url == *url) {
            return Err("A webhook with this URL already exists".to_string());
        }
    }

    let webhook_repo = WebhookRepository::new(state.database.get_pool());
    webhook_repo.update(id, webhook).await
}

/// Delete a webhook
#[tauri::command]
pub async fn delete_webhook(
    state: tauri::State<'_, crate::AppState>,
    id: i64,
) -> Result<(), String> {
    debug(Component::Webhooks, &format!("Deleting webhook: {}", id));
    
    let webhook_repo = WebhookRepository::new(state.database.get_pool());
    webhook_repo.delete(id).await
}

/// Test a webhook by sending a sample payload
#[tauri::command]
pub async fn test_webhook(
    state: tauri::State<'_, crate::AppState>,
    id: i64,
) -> Result<TestResult, String> {
    debug(Component::Webhooks, &format!("Testing webhook: {}", id));
    
    let webhook_repo = WebhookRepository::new(state.database.get_pool());
    let webhook_service = WebhookService::new(webhook_repo.into());
    
    webhook_service.test_webhook(id).await
        .map_err(|e| format!("Webhook test failed: {}", e))
}

/// Get webhook delivery logs with filtering and pagination
#[tauri::command]
pub async fn get_webhook_logs(
    state: tauri::State<'_, crate::AppState>,
    filters: LogFilters,
) -> Result<PaginatedLogs, String> {
    debug(Component::Webhooks, "Getting webhook logs");
    
    let webhook_repo = WebhookRepository::new(state.database.get_pool());
    webhook_repo.get_logs(filters).await
}

/// Clean up old webhook logs (keep last N entries)
#[tauri::command]
pub async fn cleanup_webhook_logs(
    state: tauri::State<'_, crate::AppState>,
    keep_count: i64,
) -> Result<u64, String> {
    debug(Component::Webhooks, &format!("Cleaning up webhook logs, keeping {}", keep_count));
    
    let webhook_repo = WebhookRepository::new(state.database.get_pool());
    webhook_repo.cleanup_old_logs(keep_count).await
}
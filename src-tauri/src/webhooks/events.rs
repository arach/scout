use std::sync::Arc;
use crate::webhooks::service::WebhookService;
use crate::webhooks::repository::WebhookRepository;
use crate::logger::{debug, error, info, Component};

/// Called when a transcription is completed to trigger webhook deliveries
pub async fn on_transcription_complete(
    database: Arc<crate::db::Database>,
    transcript: &crate::db::Transcript,
) -> Result<(), String> {
    debug(Component::Webhooks, &format!("Transcription completed, checking for webhooks: transcript_id={}", transcript.id));

    // Create webhook repository and service
    let webhook_repo = Arc::new(WebhookRepository::new(database.get_pool()));
    let webhook_service = WebhookService::new(webhook_repo);

    // Spawn a separate task to handle webhook delivery so it doesn't block transcription processing
    let transcript_clone = transcript.clone();
    tokio::spawn(async move {
        match webhook_service.deliver_all_webhooks(&transcript_clone).await {
            Ok(()) => {
                info(Component::Webhooks, &format!("Webhook deliveries completed for transcript {}", transcript_clone.id));
            }
            Err(e) => {
                error(Component::Webhooks, &format!("Webhook delivery failed for transcript {}: {}", transcript_clone.id, e));
            }
        }
    });

    Ok(())
}

/// Initialize webhook system (called during app startup)
pub async fn initialize_webhook_system(database: Arc<crate::db::Database>) -> Result<(), String> {
    info(Component::Webhooks, "Initializing webhook system");
    
    // Verify webhook tables exist and are accessible
    let webhook_repo = WebhookRepository::new(database.get_pool());
    let webhook_count = webhook_repo.get_all().await?.len();
    
    info(Component::Webhooks, &format!("Webhook system initialized successfully, {} webhooks configured", webhook_count));
    
    Ok(())
}

/// Cleanup webhook logs periodically (called from background task)
pub async fn cleanup_webhook_logs_periodic(database: Arc<crate::db::Database>) -> Result<(), String> {
    debug(Component::Webhooks, "Running periodic webhook log cleanup");
    
    let webhook_repo = WebhookRepository::new(database.get_pool());
    let deleted_count = webhook_repo.cleanup_old_logs(1000).await?; // Keep last 1000 logs
    
    if deleted_count > 0 {
        info(Component::Webhooks, &format!("Cleaned up {} old webhook logs", deleted_count));
    }
    
    Ok(())
}
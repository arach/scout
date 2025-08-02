use std::sync::Arc;
use crate::webhooks::service::WebhookService;
use crate::webhooks::repository::WebhookRepository;
use crate::logger::{debug, error, info, Component};

/// Called when a transcription is completed to trigger webhook deliveries
/// This function immediately returns after spawning a background task, ensuring
/// it never blocks the transcription completion process.
pub fn trigger_webhook_delivery_async(
    database: Arc<crate::db::Database>,
    transcript: crate::db::Transcript,
) {
    debug(Component::Webhooks, &format!("Scheduling webhook delivery for transcript_id={}", transcript.id));

    // Spawn a completely independent background task for webhook delivery
    // This ensures webhook processing never blocks transcription completion
    let task_handle = tokio::spawn(async move {
        // Add a small delay to ensure transcription processing is fully complete
        // before webhook processing begins (prevents any potential race conditions)
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        
        debug(Component::Webhooks, &format!("Starting background webhook delivery for transcript {}", transcript.id));
        
        // Create webhook repository and service inside the background task
        let webhook_repo = Arc::new(WebhookRepository::new(database.get_pool()));
        let webhook_service = WebhookService::new(webhook_repo);

        // Add timeout protection to prevent webhooks from running indefinitely
        let webhook_timeout = tokio::time::Duration::from_secs(300); // 5 minutes max for all webhooks
        
        match tokio::time::timeout(webhook_timeout, webhook_service.deliver_all_webhooks(&transcript)).await {
            Ok(Ok(())) => {
                info(Component::Webhooks, &format!("Background webhook deliveries completed for transcript {}", transcript.id));
            }
            Ok(Err(e)) => {
                error(Component::Webhooks, &format!("Background webhook delivery failed for transcript {}: {}", transcript.id, e));
            }
            Err(_) => {
                error(Component::Webhooks, &format!("Background webhook delivery timed out for transcript {} after 5 minutes", transcript.id));
            }
        }
    });

    // Detach the task so it doesn't need to be awaited
    // This ensures the webhook task runs completely independently
    std::mem::drop(task_handle);
}

/// Legacy async function for backward compatibility
/// This now just calls the new non-blocking function
pub async fn on_transcription_complete(
    database: Arc<crate::db::Database>,
    transcript: &crate::db::Transcript,
) -> Result<(), String> {
    trigger_webhook_delivery_async(database, transcript.clone());
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
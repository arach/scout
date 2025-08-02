use std::sync::Arc;
use sqlx::{SqlitePool, Row};
use crate::webhooks::models::*;
use crate::logger::{debug, Component};

#[derive(Debug)]
pub struct WebhookRepository {
    db_pool: Arc<SqlitePool>,
}

impl WebhookRepository {
    pub fn new(db_pool: &SqlitePool) -> Self {
        Self { 
            db_pool: Arc::new(db_pool.clone())
        }
    }

    pub async fn create(&self, webhook: CreateWebhookDto) -> Result<Webhook, String> {
        let headers_json = webhook.headers
            .map(|h| serde_json::to_string(&h).unwrap_or_default());

        let result = sqlx::query(
            r#"
            INSERT INTO webhooks (url, description, enabled, headers)
            VALUES (?1, ?2, ?3, ?4)
            "#,
        )
        .bind(&webhook.url)
        .bind(&webhook.description)
        .bind(webhook.enabled)
        .bind(&headers_json)
        .execute(&*self.db_pool)
        .await
        .map_err(|e| format!("Failed to create webhook: {}", e))?;

        let id = result.last_insert_rowid();
        
        // Fetch the newly created webhook
        self.get_by_id(id).await?
            .ok_or_else(|| "Failed to fetch newly created webhook".to_string())
    }

    pub async fn update(&self, id: i64, webhook: UpdateWebhookDto) -> Result<Webhook, String> {
        // First, get the existing webhook to preserve unchanged fields
        let existing = self.get_by_id(id).await?
            .ok_or_else(|| "Webhook not found".to_string())?;

        let url = webhook.url.unwrap_or(existing.url);
        let description = webhook.description.or(existing.description);
        let enabled = webhook.enabled.unwrap_or(existing.enabled);
        let headers_json = webhook.headers
            .map(|h| serde_json::to_string(&h).unwrap_or_default())
            .or(existing.headers);

        sqlx::query(
            r#"
            UPDATE webhooks 
            SET url = ?1, description = ?2, enabled = ?3, headers = ?4, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?5
            "#,
        )
        .bind(&url)
        .bind(&description)
        .bind(enabled)
        .bind(&headers_json)
        .bind(id)
        .execute(&*self.db_pool)
        .await
        .map_err(|e| format!("Failed to update webhook: {}", e))?;

        // Fetch the updated webhook
        self.get_by_id(id).await?
            .ok_or_else(|| "Failed to fetch updated webhook".to_string())
    }

    pub async fn delete(&self, id: i64) -> Result<(), String> {
        let result = sqlx::query("DELETE FROM webhooks WHERE id = ?1")
            .bind(id)
            .execute(&*self.db_pool)
            .await
            .map_err(|e| format!("Failed to delete webhook: {}", e))?;

        if result.rows_affected() == 0 {
            return Err("Webhook not found".to_string());
        }

        debug(Component::Webhooks, &format!("Deleted webhook with id: {}", id));
        Ok(())
    }

    pub async fn get_all(&self) -> Result<Vec<Webhook>, String> {
        let webhooks = sqlx::query_as::<_, Webhook>(
            r#"
            SELECT id, url, description, enabled, created_at, updated_at, last_triggered_at, headers
            FROM webhooks
            ORDER BY created_at DESC
            "#
        )
        .fetch_all(&*self.db_pool)
        .await
        .map_err(|e| format!("Failed to get webhooks: {}", e))?;

        Ok(webhooks)
    }

    pub async fn get_by_id(&self, id: i64) -> Result<Option<Webhook>, String> {
        let webhook = sqlx::query_as::<_, Webhook>(
            r#"
            SELECT id, url, description, enabled, created_at, updated_at, last_triggered_at, headers
            FROM webhooks
            WHERE id = ?1
            "#
        )
        .bind(id)
        .fetch_optional(&*self.db_pool)
        .await
        .map_err(|e| format!("Failed to get webhook: {}", e))?;

        Ok(webhook)
    }

    pub async fn get_enabled(&self) -> Result<Vec<Webhook>, String> {
        let webhooks = sqlx::query_as::<_, Webhook>(
            r#"
            SELECT id, url, description, enabled, created_at, updated_at, last_triggered_at, headers
            FROM webhooks
            WHERE enabled = 1
            ORDER BY created_at DESC
            "#
        )
        .fetch_all(&*self.db_pool)
        .await
        .map_err(|e| format!("Failed to get enabled webhooks: {}", e))?;

        Ok(webhooks)
    }

    pub async fn update_last_triggered(&self, id: i64) -> Result<(), String> {
        sqlx::query(
            r#"
            UPDATE webhooks 
            SET last_triggered_at = CURRENT_TIMESTAMP
            WHERE id = ?1
            "#,
        )
        .bind(id)
        .execute(&*self.db_pool)
        .await
        .map_err(|e| format!("Failed to update last triggered time: {}", e))?;

        Ok(())
    }

    pub async fn log_delivery(&self, webhook_id: i64, result: &DeliveryResult) -> Result<i64, String> {
        let request_headers_json = result.request_headers
            .as_ref()
            .map(|h| serde_json::to_string(h).unwrap_or_default());
        
        let response_headers_json = result.response_headers
            .as_ref()
            .map(|h| serde_json::to_string(h).unwrap_or_default());

        let status = if result.success { "success" } else { "failure" };
        let status_code = result.status_code.map(|s| s as i32);

        let log_result = sqlx::query(
            r#"
            INSERT INTO webhook_logs (
                webhook_id, status, status_code, response_time_ms, error_message,
                attempt_number, request_headers, response_headers
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
        )
        .bind(webhook_id)
        .bind(status)
        .bind(status_code)
        .bind(result.response_time_ms)
        .bind(&result.error_message)
        .bind(result.attempt_number)
        .bind(&request_headers_json)
        .bind(&response_headers_json)
        .execute(&*self.db_pool)
        .await
        .map_err(|e| format!("Failed to log webhook delivery: {}", e))?;

        Ok(log_result.last_insert_rowid())
    }

    pub async fn get_logs(&self, filters: LogFilters) -> Result<PaginatedLogs, String> {
        let page = filters.page.unwrap_or(1).max(1);
        let per_page = filters.per_page.unwrap_or(50).min(100).max(1);
        let offset = (page - 1) * per_page;

        // For simplicity, let's implement basic filtering without dynamic queries
        // This can be enhanced later with more complex query building
        
        let (logs_query, count_query) = if let Some(webhook_id) = filters.webhook_id {
            (
                r#"
                SELECT 
                    wl.id, wl.webhook_id, wl.timestamp, wl.status, wl.status_code,
                    wl.response_time_ms, wl.error_message, wl.attempt_number,
                    wl.payload_size, wl.request_headers, wl.response_headers,
                    w.url as webhook_url
                FROM webhook_logs wl
                JOIN webhooks w ON wl.webhook_id = w.id
                WHERE wl.webhook_id = ?1
                ORDER BY wl.timestamp DESC
                LIMIT ?2 OFFSET ?3
                "#,
                r#"
                SELECT COUNT(*) as count
                FROM webhook_logs wl
                JOIN webhooks w ON wl.webhook_id = w.id
                WHERE wl.webhook_id = ?1
                "#
            )
        } else {
            (
                r#"
                SELECT 
                    wl.id, wl.webhook_id, wl.timestamp, wl.status, wl.status_code,
                    wl.response_time_ms, wl.error_message, wl.attempt_number,
                    wl.payload_size, wl.request_headers, wl.response_headers,
                    w.url as webhook_url
                FROM webhook_logs wl
                JOIN webhooks w ON wl.webhook_id = w.id
                ORDER BY wl.timestamp DESC
                LIMIT ?1 OFFSET ?2
                "#,
                r#"
                SELECT COUNT(*) as count
                FROM webhook_logs wl
                JOIN webhooks w ON wl.webhook_id = w.id
                "#
            )
        };

        // Get total count
        let total: i64 = if let Some(webhook_id) = filters.webhook_id {
            sqlx::query(count_query)
                .bind(webhook_id)
                .fetch_one(&*self.db_pool)
                .await
                .map_err(|e| format!("Failed to count webhook logs: {}", e))?
                .get(0)
        } else {
            sqlx::query(count_query)
                .fetch_one(&*self.db_pool)
                .await
                .map_err(|e| format!("Failed to count webhook logs: {}", e))?
                .get(0)
        };

        // Get logs
        let rows = if let Some(webhook_id) = filters.webhook_id {
            sqlx::query(logs_query)
                .bind(webhook_id)
                .bind(per_page)
                .bind(offset)
                .fetch_all(&*self.db_pool)
                .await
                .map_err(|e| format!("Failed to fetch webhook logs: {}", e))?
        } else {
            sqlx::query(logs_query)
                .bind(per_page)
                .bind(offset)
                .fetch_all(&*self.db_pool)
                .await
                .map_err(|e| format!("Failed to fetch webhook logs: {}", e))?
        };

        let logs: Vec<WebhookLogWithUrl> = rows
            .into_iter()
            .map(|row| WebhookLogWithUrl {
                log: WebhookLog {
                    id: row.get("id"),
                    webhook_id: row.get("webhook_id"),
                    timestamp: row.get("timestamp"),
                    status: row.get("status"),
                    status_code: row.get("status_code"),
                    response_time_ms: row.get("response_time_ms"),
                    error_message: row.get("error_message"),
                    attempt_number: row.get("attempt_number"),
                    payload_size: row.get("payload_size"),
                    request_headers: row.get("request_headers"),
                    response_headers: row.get("response_headers"),
                },
                webhook_url: row.get("webhook_url"),
            })
            .collect();

        let total_pages = ((total as f64) / (per_page as f64)).ceil() as i32;

        Ok(PaginatedLogs {
            logs,
            total,
            page,
            per_page,
            total_pages,
        })
    }

    pub async fn cleanup_old_logs(&self, keep_count: i64) -> Result<u64, String> {
        let result = sqlx::query(
            r#"
            DELETE FROM webhook_logs 
            WHERE id NOT IN (
                SELECT id FROM webhook_logs 
                ORDER BY timestamp DESC 
                LIMIT ?1
            )
            "#,
        )
        .bind(keep_count)
        .execute(&*self.db_pool)
        .await
        .map_err(|e| format!("Failed to cleanup old webhook logs: {}", e))?;

        debug(Component::Webhooks, &format!("Cleaned up {} old webhook logs", result.rows_affected()));
        Ok(result.rows_affected())
    }
}
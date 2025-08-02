# Backend Engineering Tasks - Webhooks

## Overview
Implement the Rust backend service for webhook delivery, storage, and retry logic.

## Prerequisites
- Review the [webhook specification](../../webhooks-spec.md)
- Coordinate with Frontend Engineer on API contracts
- Review existing Scout backend patterns

## Task Breakdown

### 1. Database Schema Design (0.5 days)

**File**: `src-tauri/src/db/migrations/webhook_tables.sql`

**Requirements**:
- Create webhooks table for configuration storage
- Create webhook_logs table for delivery history
- Add indexes for performance

**Schema**:
```sql
-- Webhooks configuration table
CREATE TABLE webhooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    description TEXT,
    enabled BOOLEAN NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_triggered_at TEXT,
    headers TEXT -- JSON string for custom headers
);

-- Webhook delivery logs
CREATE TABLE webhook_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    webhook_id INTEGER NOT NULL,
    timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status TEXT NOT NULL CHECK (status IN ('success', 'failure')),
    status_code INTEGER,
    response_time_ms INTEGER,
    error_message TEXT,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    payload_size INTEGER,
    request_headers TEXT, -- JSON
    response_headers TEXT, -- JSON
    FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX idx_webhook_logs_webhook_id ON webhook_logs(webhook_id);
CREATE INDEX idx_webhook_logs_timestamp ON webhook_logs(timestamp);
CREATE INDEX idx_webhook_logs_status ON webhook_logs(status);
```

### 2. Webhook Service Implementation (2 days)

**File**: `src-tauri/src/webhooks/service.rs`

**Requirements**:
- HTTP client with timeout and retry logic
- Payload construction from transcription data
- Async delivery to avoid blocking
- Configurable retry strategy

**Core Structure**:
```rust
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tokio::time::{timeout, Duration};

pub struct WebhookService {
    client: Client,
    db_pool: Arc<SqlitePool>,
    max_retries: u32,
    timeout_duration: Duration,
}

#[derive(Serialize)]
pub struct WebhookPayload {
    event: String,
    timestamp: DateTime<Utc>,
    transcription: TranscriptionData,
    model: ModelInfo,
    app: AppInfo,
}

impl WebhookService {
    pub async fn deliver_webhook(
        &self,
        webhook: &Webhook,
        transcription: &Transcript,
    ) -> Result<DeliveryResult, WebhookError> {
        // Implementation
    }
    
    async fn attempt_delivery(
        &self,
        webhook: &Webhook,
        payload: &WebhookPayload,
        attempt: u32,
    ) -> Result<DeliveryAttempt, WebhookError> {
        // HTTP POST with timeout
    }
    
    async fn log_delivery(
        &self,
        webhook_id: i64,
        result: &DeliveryResult,
    ) -> Result<(), sqlx::Error> {
        // Log to database
    }
}
```

### 3. Webhook CRUD Operations (1 day)

**File**: `src-tauri/src/webhooks/repository.rs`

**Requirements**:
- Database operations for webhook management
- Input validation
- Transaction support for consistency

**API Methods**:
```rust
pub struct WebhookRepository {
    db_pool: Arc<SqlitePool>,
}

impl WebhookRepository {
    pub async fn create(&self, webhook: CreateWebhookDto) -> Result<Webhook, Error>;
    pub async fn update(&self, id: i64, webhook: UpdateWebhookDto) -> Result<Webhook, Error>;
    pub async fn delete(&self, id: i64) -> Result<(), Error>;
    pub async fn get_all(&self) -> Result<Vec<Webhook>, Error>;
    pub async fn get_by_id(&self, id: i64) -> Result<Webhook, Error>;
    pub async fn get_enabled(&self) -> Result<Vec<Webhook>, Error>;
}
```

### 4. Tauri Command Handlers (1 day)

**File**: `src-tauri/src/webhooks/commands.rs`

**Requirements**:
- Expose webhook operations as Tauri commands
- Error handling and serialization
- State management integration

**Commands**:
```rust
#[tauri::command]
pub async fn get_webhooks(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Webhook>, String> {
    // Implementation
}

#[tauri::command]
pub async fn create_webhook(
    state: tauri::State<'_, AppState>,
    webhook: CreateWebhookDto,
) -> Result<Webhook, String> {
    // Implementation
}

#[tauri::command]
pub async fn update_webhook(
    state: tauri::State<'_, AppState>,
    id: i64,
    webhook: UpdateWebhookDto,
) -> Result<Webhook, String> {
    // Implementation
}

#[tauri::command]
pub async fn delete_webhook(
    state: tauri::State<'_, AppState>,
    id: i64,
) -> Result<(), String> {
    // Implementation
}

#[tauri::command]
pub async fn test_webhook(
    state: tauri::State<'_, AppState>,
    id: i64,
) -> Result<TestResult, String> {
    // Send test payload
}

#[tauri::command]
pub async fn get_webhook_logs(
    state: tauri::State<'_, AppState>,
    filters: LogFilters,
) -> Result<PaginatedLogs, String> {
    // Query logs with filtering
}
```

### 5. Transcription Event Integration (1 day)

**File**: `src-tauri/src/webhooks/events.rs`

**Requirements**:
- Hook into transcription completion event
- Queue webhooks for delivery
- Non-blocking execution

**Integration Points**:
```rust
// In transcription completion handler
pub async fn on_transcription_complete(
    app_state: &AppState,
    transcript: &Transcript,
) -> Result<(), Error> {
    // Get enabled webhooks
    let webhooks = app_state.webhook_repo.get_enabled().await?;
    
    // Queue webhook deliveries
    for webhook in webhooks {
        tokio::spawn(async move {
            if let Err(e) = app_state.webhook_service
                .deliver_webhook(&webhook, transcript)
                .await 
            {
                error!("Webhook delivery failed: {}", e);
            }
        });
    }
    
    Ok(())
}
```

### 6. Webhook Log Management (0.5 days)

**File**: `src-tauri/src/webhooks/logs.rs`

**Requirements**:
- Query logs with filtering and pagination
- Log retention policy (e.g., keep last 1000 entries)
- Log cleanup job

**Implementation**:
```rust
pub struct LogRepository {
    db_pool: Arc<SqlitePool>,
}

impl LogRepository {
    pub async fn insert(&self, log: WebhookLog) -> Result<(), Error>;
    pub async fn query(&self, filters: LogFilters) -> Result<PaginatedLogs, Error>;
    pub async fn cleanup_old_logs(&self, keep_count: i64) -> Result<u64, Error>;
}
```

### 7. Error Handling & Resilience (1 day)

**Requirements**:
- Graceful handling of network errors
- Timeout handling
- Circuit breaker for failing endpoints
- Proper error types and messages

**Error Types**:
```rust
#[derive(thiserror::Error, Debug)]
pub enum WebhookError {
    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),
    
    #[error("Timeout after {0:?}")]
    Timeout(Duration),
    
    #[error("Invalid URL: {0}")]
    InvalidUrl(String),
    
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    
    #[error("Webhook not found")]
    NotFound,
    
    #[error("Max retries exceeded")]
    MaxRetriesExceeded,
}
```

## Testing Requirements

### Unit Tests
- [ ] Webhook URL validation
- [ ] Payload construction
- [ ] Retry logic
- [ ] Database operations

### Integration Tests
- [ ] Full webhook delivery flow
- [ ] Retry behavior with mock server
- [ ] Database persistence
- [ ] Concurrent webhook delivery

## Dependencies

### On Frontend Team:
- API contract agreement
- Error message requirements

### On Database:
- SQLite schema migration

## Performance Considerations

1. **Async Delivery**: Use tokio::spawn for non-blocking delivery
2. **Connection Pooling**: Reuse HTTP client connections
3. **Batch Operations**: Consider batching log inserts
4. **Timeout Strategy**: 30s timeout with exponential backoff
5. **Concurrent Limits**: Limit concurrent webhook deliveries to prevent resource exhaustion

## Security Considerations

1. **HTTPS Only**: Enforce HTTPS for production (allow HTTP for localhost)
2. **Header Validation**: Sanitize custom headers
3. **Payload Size Limits**: Cap payload size at 1MB
4. **Rate Limiting**: Implement per-webhook rate limits
5. **URL Validation**: Prevent SSRF attacks

## Estimated Timeline

- **Total**: 7 days
- Database schema can be done in parallel with service design
- Integration with transcription events depends on service completion

## Notes for Implementation

1. Follow Scout's existing error handling patterns
2. Use existing database connection pool
3. Make webhook delivery resilient to app restarts
4. Consider adding webhook signing (HMAC) in future phase
5. Log enough detail for debugging without exposing sensitive data
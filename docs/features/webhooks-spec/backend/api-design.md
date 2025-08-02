# Webhook API Design

## Overview
RESTful API design for webhook management operations exposed through Tauri commands.

## API Endpoints

### 1. Get All Webhooks
```rust
#[tauri::command]
async fn get_webhooks() -> Result<Vec<Webhook>, String>
```

**Response**:
```json
[
  {
    "id": "webhook_123",
    "url": "https://example.com/webhook",
    "description": "Production webhook",
    "enabled": true,
    "created_at": "2025-01-08T10:00:00Z",
    "updated_at": "2025-01-08T10:00:00Z",
    "last_triggered_at": "2025-01-08T14:30:00Z"
  }
]
```

### 2. Create Webhook
```rust
#[tauri::command]
async fn create_webhook(webhook: CreateWebhookDto) -> Result<Webhook, String>
```

**Request**:
```json
{
  "url": "https://example.com/webhook",
  "description": "Production webhook",
  "enabled": true
}
```

**Validation**:
- URL must be valid HTTP/HTTPS
- URL must be reachable (optional test)
- Description max 200 characters

### 3. Update Webhook
```rust
#[tauri::command]
async fn update_webhook(id: String, webhook: UpdateWebhookDto) -> Result<Webhook, String>
```

**Request**:
```json
{
  "url": "https://example.com/webhook/v2",
  "description": "Updated description",
  "enabled": false
}
```

### 4. Delete Webhook
```rust
#[tauri::command]
async fn delete_webhook(id: String) -> Result<(), String>
```

**Response**: 204 No Content

### 5. Test Webhook
```rust
#[tauri::command]
async fn test_webhook(id: String) -> Result<TestResult, String>
```

**Response**:
```json
{
  "success": true,
  "status_code": 200,
  "response_time_ms": 234,
  "error": null,
  "tested_at": "2025-01-08T14:35:00Z"
}
```

### 6. Get Webhook Logs
```rust
#[tauri::command]
async fn get_webhook_logs(filters: LogFilters) -> Result<PaginatedLogs, String>
```

**Request**:
```json
{
  "webhook_id": "webhook_123",
  "status": "failure",
  "from_date": "2025-01-01T00:00:00Z",
  "to_date": "2025-01-08T23:59:59Z",
  "page": 1,
  "per_page": 50
}
```

**Response**:
```json
{
  "logs": [
    {
      "id": "log_456",
      "webhook_id": "webhook_123",
      "webhook_url": "https://example.com/webhook",
      "timestamp": "2025-01-08T14:30:00Z",
      "status": "failure",
      "status_code": 500,
      "response_time_ms": 1200,
      "error_message": "Internal Server Error",
      "attempt_number": 3,
      "payload_size": 4096
    }
  ],
  "total": 145,
  "page": 1,
  "per_page": 50,
  "total_pages": 3
}
```

## Webhook Payload Schema

### Transcription Completed Event
```json
{
  "event": "transcription.completed",
  "timestamp": "2025-01-08T14:30:00Z",
  "transcription": {
    "id": 123,
    "text": "This is the full transcription text...",
    "duration_ms": 5000,
    "created_at": "2025-01-08T14:30:00Z",
    "audio_file": "recording_123.wav",
    "file_size": 1024000,
    "word_count": 250,
    "metadata": {
      "model_used": "whisper-base",
      "processing_time_ms": 1200,
      "language": "en"
    }
  },
  "model": {
    "name": "whisper-base",
    "version": "1.0",
    "size": "74MB"
  },
  "app": {
    "name": "Scout",
    "version": "0.4.0",
    "platform": "macos",
    "arch": "aarch64"
  }
}
```

## Error Responses

### Standard Error Format
```json
{
  "error": {
    "code": "WEBHOOK_NOT_FOUND",
    "message": "Webhook with id 'webhook_123' not found",
    "details": {}
  }
}
```

### Error Codes
- `WEBHOOK_NOT_FOUND` - Webhook ID doesn't exist
- `INVALID_URL` - URL format is invalid
- `URL_UNREACHABLE` - URL cannot be reached
- `DUPLICATE_URL` - URL already exists
- `VALIDATION_ERROR` - Input validation failed
- `DATABASE_ERROR` - Database operation failed
- `NETWORK_ERROR` - Network request failed
- `TIMEOUT_ERROR` - Request timed out

## Rate Limiting

- Max 10 webhooks per user
- Max 100 test requests per hour
- Max 1000 deliveries per hour

## Security Headers

### Webhook Delivery Headers
```
Content-Type: application/json
User-Agent: Scout/0.4.0
X-Scout-Event: transcription.completed
X-Scout-Signature: <HMAC-SHA256> (future)
X-Request-ID: <UUID>
```

## Retry Strategy

1. Initial delivery attempt
2. If failed, retry after 5 seconds
3. If failed, retry after 15 seconds
4. Mark as failed after 3 attempts

## Performance Targets

- Webhook CRUD operations: <100ms
- Test webhook: <5s timeout
- Webhook delivery: <30s timeout
- Log queries: <200ms for 1000 records
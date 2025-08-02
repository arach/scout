# Transcription Webhooks Specification

## Overview

Enable technical users of Scout to configure webhooks that automatically trigger upon transcription completion. When triggered, the app sends a fixed payload—including file name, transcript, model, and app context—to a user-defined endpoint. This feature streamlines integration with external workflows and automation tools.

## Goals

### Business Goals
- Increase product extensibility and developer adoption by enabling easy integration with external systems
- Differentiate Scout from competitors by offering local-first, open-source automation features
- Lay the groundwork for future extensibility and marketplace integrations
- Reduce manual steps for users who want to automate post-transcription workflows

### User Goals
- Allow users to automatically trigger external actions when a transcription completes
- Enable seamless integration with custom scripts, automation tools, or third-party services
- Provide a simple, reliable way to configure and test webhook delivery
- Minimize manual effort and repetitive tasks for technical users

### Non-Goals
- Customizable payloads (beyond the fixed schema) are out of scope for this release
- Config file-driven webhook setup is not included in the initial release (planned as a fast follow)
- Notification systems for failed webhook deliveries are not included in this release
- Marketplace or extensibility for post-processing actions is not addressed in this release

## User Stories

**Persona: Technical End-User (Developer/Power User)**

- As a technical user, I want to define a webhook endpoint in the app UI, so that I can receive transcription data automatically
- As a technical user, I want to test my webhook configuration from the UI, so that I can verify my endpoint is working before using it in production
- As a technical user, I want the webhook to send a fixed payload with relevant transcription details, so that I can process or store the data externally
- As a technical user, I want the app to retry webhook delivery if the first attempt fails, so that transient network issues do not cause data loss
- As a technical user, I want to view logs of webhook delivery attempts, so that I can debug integration issues

## Functional Requirements

### Webhook Configuration (Priority: High)
- **Webhook Setup UI**: Users can add, edit, and remove webhook endpoints via the app's settings
- **Endpoint Validation**: The app validates the URL format before saving
- **Test Webhook**: Users can send a test payload to verify endpoint connectivity

### Webhook Delivery (Priority: High)
- **Trigger on Transcription Completion**: Webhook fires automatically when a transcription is completed
- **Fixed Payload**: The webhook sends a JSON payload with the following fields:
  ```json
  {
    "event": "transcription.completed",
    "timestamp": "2025-01-08T14:30:00Z",
    "transcription": {
      "id": 123,
      "text": "Full transcription text...",
      "duration_ms": 5000,
      "created_at": "2025-01-08T14:30:00Z",
      "audio_file": "recording_123.wav",
      "file_size": 1024000
    },
    "model": {
      "name": "whisper-base",
      "version": "1.0"
    },
    "app": {
      "name": "Scout",
      "version": "0.4.0",
      "platform": "macos"
    }
  }
  ```
- **Delivery Method**: HTTP POST to the user-defined endpoint

### Retry Logic (Priority: Medium)
- **Automatic Retries**: If delivery fails (e.g., non-2xx response or network error), retry up to 2 additional times with a short delay
- **Logging**: All attempts (success/failure) are logged for user review

### Error Handling & Logging (Priority: Medium)
- **Delivery Status**: Users can view the status of recent webhook deliveries in the app
- **Error Messages**: Clear error messages are shown for failed test deliveries or invalid endpoints

## User Experience

### Entry Point & First-Time User Experience
- Users access the app's settings or integrations section to discover the webhook feature
- A brief tooltip or help link explains what webhooks are and how they work
- First-time users see a simple form to add a new webhook endpoint

### Core Experience

**Step 1: Navigate to Webhooks**
- User navigates to the "Webhooks" section in app settings
- UI presents a list of existing webhooks (if any) and an "Add Webhook" button
- Minimal friction: clear labels, concise descriptions

**Step 2: Add Webhook**
- User clicks "Add Webhook" and enters the endpoint URL
- URL is validated for correct format (must start with http:// or https://)
- Option to add a description or label for the webhook

**Step 3: Test Webhook**
- App sends a sample payload to the endpoint
- User receives immediate feedback: success (with response code) or error (with details)

**Step 4: Save Configuration**
- Webhook is now active and listed in the UI

**Step 5: Automatic Delivery**
- Upon transcription completion, the app automatically sends the fixed payload to the configured endpoint
- If delivery fails, the app retries up to 2 times
- All attempts are logged and visible in the "Webhook Logs" section

**Step 6: Review Logs**
- Logs show timestamp, endpoint, status (success/failure), and error details if applicable

### Advanced Features & Edge Cases
- If the endpoint is unreachable or returns a non-2xx status, retries are attempted with a short delay (e.g., 5 seconds)
- If all retries fail, the failure is logged but does not block the user or trigger notifications
- Users can delete or disable webhooks at any time
- Multiple webhooks can be configured; all are triggered on transcription completion

### UI/UX Highlights
- Clear, accessible forms with validation and helpful error messages
- Responsive layout for different Mac screen sizes
- High-contrast color scheme for accessibility
- Concise documentation link for payload schema and troubleshooting
- Logs are easy to filter and search

## Technical Considerations

### Technical Implementation

#### Frontend Components
```typescript
// src/components/WebhookSettings.tsx
interface Webhook {
  id: string;
  url: string;
  description?: string;
  enabled: boolean;
  created_at: string;
}

interface WebhookLog {
  id: string;
  webhook_id: string;
  timestamp: string;
  status: 'success' | 'failure';
  status_code?: number;
  error_message?: string;
  attempt_number: number;
}
```

#### Backend Implementation
```rust
// src-tauri/src/webhooks/mod.rs
pub struct WebhookService {
    // Webhook configuration management
    // HTTP client for delivery
    // Retry logic implementation
    // Logging subsystem
}

pub struct WebhookPayload {
    event: String,
    timestamp: DateTime<Utc>,
    transcription: TranscriptionData,
    model: ModelInfo,
    app: AppInfo,
}
```

### Integration Points
- Local transcription engine (event hook on completion)
- User-defined external endpoints (no third-party dependencies required)
- Settings storage system
- Future: config file integration (planned as a fast follow)

### Data Storage & Privacy
- Webhook configurations stored locally in user settings
- Delivery logs stored locally and accessible only to the user
- Payload contains transcript data; users are responsible for endpoint security and privacy

### Scalability & Performance
- Designed for single-user, local-first operation
- Must handle multiple webhooks per user without significant performance impact
- Efficient retry logic to avoid blocking main app flow
- Webhook delivery should be non-blocking (async)

### Potential Challenges
- Handling unreliable or slow endpoints without degrading app performance
- Ensuring clear error reporting without overwhelming the user
- Managing large transcript payloads in webhook delivery
- User education on securing their endpoints

## Success Metrics

### User-Centric Metrics
- Number of users who configure at least one webhook
- Frequency of successful webhook deliveries per user
- User satisfaction with webhook setup and reliability (via in-app feedback)

### Business Metrics
- Increase in user retention among technical users
- Growth in new user signups citing automation/integration as a reason
- Reduction in support requests related to manual export or integration

### Technical Metrics
- Webhook delivery success rate (target: >98%)
- Average webhook delivery latency (target: <2 seconds)
- Number of failed deliveries and retry success rate

### Tracking Plan
- Webhook added/edited/deleted events
- Test webhook attempts and results
- Webhook delivery attempts (success/failure)
- User views of webhook logs
- Transcription completion events triggering webhooks

## Implementation Plan

### Phase 1: Core Webhook Functionality (1 week)
**Deliverables:**
- Webhook management UI (add, edit, delete, test)
- Backend logic for triggering webhooks on transcription completion
- Fixed payload schema and documentation
- Basic retry logic (up to 2 retries)
- Delivery logging and log viewer

**Tasks:**
1. Design and implement webhook settings UI component
2. Create webhook storage schema in SQLite
3. Implement webhook HTTP client with retry logic
4. Add transcription completion event hook
5. Build webhook log viewer UI
6. Write user documentation

### Phase 2: Polish & Testing (0.5 week)
**Deliverables:**
- UI/UX refinements based on internal testing
- Improved error messages and help documentation
- Performance tuning for delivery and logging
- Comprehensive test coverage

**Tasks:**
1. Conduct internal testing and gather feedback
2. Refine UI based on feedback
3. Add unit and integration tests
4. Performance optimization
5. Documentation updates

### Phase 3: Future Enhancements (Post-Launch)
**Potential Features:**
- Config file support for webhook configuration
- Custom payload templates
- Webhook filtering (e.g., only for certain file types)
- Batch delivery for multiple transcriptions
- Integration with popular automation tools (Zapier, IFTTT)

## Security Considerations

### Authentication & Authorization
- Consider adding optional webhook signing (HMAC-SHA256) for endpoint verification
- Support for custom headers (e.g., API keys)

### Data Protection
- Webhooks should use HTTPS endpoints only (with option to allow HTTP for local development)
- Clear warnings about sending transcript data to external endpoints
- Option to exclude sensitive data from payloads

### Rate Limiting
- Implement rate limiting to prevent abuse
- Maximum number of webhooks per user
- Maximum retry attempts and backoff strategy

## Example Use Cases

### Use Case 1: Archive to Cloud Storage
Developer uses webhook to automatically upload transcripts to S3/Google Drive/Dropbox for long-term storage.

### Use Case 2: Slack Notifications
Team receives Slack notifications whenever a meeting transcript is completed, with key insights highlighted.

### Use Case 3: Database Integration
Transcripts are automatically inserted into a PostgreSQL database for searchability and analysis.

### Use Case 4: AI Post-Processing
Webhook triggers an AI service to summarize the transcript and extract action items.

## Documentation Requirements

### User Documentation
- Getting Started guide with webhook basics
- Step-by-step setup instructions with screenshots
- Payload schema reference
- Troubleshooting guide
- Example webhook receivers (Node.js, Python)

### Developer Documentation
- API reference for webhook payload
- Security best practices
- Sample webhook receiver implementations
- Integration guides for popular platforms

## Testing Strategy

### Unit Tests
- URL validation logic
- Retry mechanism
- Payload construction
- Log storage and retrieval

### Integration Tests
- End-to-end webhook delivery
- Failed delivery and retry scenarios
- Multiple webhook handling
- Large payload handling

### Manual Testing
- UI/UX flow testing
- Error message clarity
- Performance with slow endpoints
- Concurrent webhook deliveries

## Conclusion

The webhook feature transforms Scout from a standalone transcription tool into an extensible platform that integrates seamlessly with users' existing workflows. By providing a simple, reliable way to automatically send transcription data to external endpoints, we enable power users to build custom automations and unlock new use cases for their transcription needs.
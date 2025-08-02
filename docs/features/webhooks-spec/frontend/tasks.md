# Frontend Engineering Tasks - Webhooks

## Overview
Implement the UI components and frontend logic for webhook management, testing, and monitoring.

## Prerequisites
- Review the [webhook specification](../../webhooks-spec.md)
- Coordinate with Design Engineer on UI mockups
- Coordinate with Backend Engineer on API contracts

## Task Breakdown

### 1. Webhook Settings Component (3 days)

**File**: `src/components/settings/WebhookSettings.tsx`

**Requirements**:
- Create main webhook settings panel that integrates with existing SettingsView
- List view showing all configured webhooks
- Add/Edit webhook form with URL validation
- Enable/disable toggle for each webhook
- Delete webhook with confirmation dialog

**Acceptance Criteria**:
- [ ] Component renders in settings panel
- [ ] Can add new webhook with URL validation
- [ ] Can edit existing webhook
- [ ] Can toggle webhook enabled state
- [ ] Can delete webhook with confirmation
- [ ] Integrates with existing settings UI pattern

**Code Structure**:
```typescript
interface Webhook {
  id: string;
  url: string;
  description?: string;
  enabled: boolean;
  created_at: string;
  last_triggered?: string;
}

interface WebhookSettingsProps {
  webhooks: Webhook[];
  onAdd: (webhook: Omit<Webhook, 'id' | 'created_at'>) => void;
  onUpdate: (id: string, webhook: Partial<Webhook>) => void;
  onDelete: (id: string) => void;
  onTest: (id: string) => void;
}
```

### 2. Webhook Test Functionality (1 day)

**File**: `src/components/settings/WebhookTestButton.tsx`

**Requirements**:
- Test button for each webhook
- Loading state during test
- Success/failure feedback with response details
- Show sample payload that will be sent

**Acceptance Criteria**:
- [ ] Test button triggers API call
- [ ] Shows loading spinner during test
- [ ] Displays success with status code
- [ ] Shows error details on failure
- [ ] Can view sample payload before testing

### 3. Webhook Logs Viewer (2 days)

**File**: `src/components/WebhookLogs.tsx`

**Requirements**:
- Separate view/modal for webhook delivery logs
- Table showing recent delivery attempts
- Filter by webhook, status, date range
- Detailed view for each log entry
- Pagination for large log sets

**Acceptance Criteria**:
- [ ] Can view all webhook delivery logs
- [ ] Can filter by webhook URL
- [ ] Can filter by success/failure status
- [ ] Can view detailed error messages
- [ ] Shows retry attempts clearly
- [ ] Pagination works correctly

**Log Entry Structure**:
```typescript
interface WebhookLog {
  id: string;
  webhook_id: string;
  webhook_url: string;
  timestamp: string;
  status: 'success' | 'failure';
  status_code?: number;
  response_time_ms: number;
  error_message?: string;
  attempt_number: number;
  payload_size: number;
}
```

### 4. Context Integration (1 day)

**File**: `src/contexts/WebhookContext.tsx`

**Requirements**:
- Create webhook context for state management
- Integrate with existing settings context
- Handle webhook CRUD operations
- Cache webhook configurations

**Acceptance Criteria**:
- [ ] Context provides webhook state to components
- [ ] Persists webhook config to backend
- [ ] Handles loading and error states
- [ ] Integrates with settings persistence

### 5. API Integration (1 day)

**Files**: 
- `src/lib/webhooks.ts` - API client functions
- `src/types/webhook.ts` - TypeScript types

**Requirements**:
- Implement Tauri command bindings for webhook operations
- Type-safe API client functions
- Error handling and retry logic for API calls

**API Functions**:
```typescript
// Get all webhooks
async function getWebhooks(): Promise<Webhook[]>

// Create webhook
async function createWebhook(webhook: CreateWebhookDto): Promise<Webhook>

// Update webhook
async function updateWebhook(id: string, webhook: UpdateWebhookDto): Promise<Webhook>

// Delete webhook
async function deleteWebhook(id: string): Promise<void>

// Test webhook
async function testWebhook(id: string): Promise<TestResult>

// Get webhook logs
async function getWebhookLogs(filters?: LogFilters): Promise<PaginatedLogs>
```

### 6. UI Polish & Error Handling (1 day)

**Requirements**:
- Loading states for all async operations
- Error boundaries for webhook components
- Toast notifications for success/failure
- Keyboard shortcuts for common actions
- Accessibility (ARIA labels, focus management)

**Acceptance Criteria**:
- [ ] All async operations show loading state
- [ ] Errors show user-friendly messages
- [ ] Success operations show confirmation
- [ ] Components are keyboard navigable
- [ ] Screen reader friendly

## Testing Requirements

### Unit Tests
- [ ] WebhookSettings component rendering
- [ ] Form validation logic
- [ ] URL validation function
- [ ] Log filtering logic

### Integration Tests
- [ ] Adding webhook flow
- [ ] Editing webhook flow
- [ ] Deleting webhook flow
- [ ] Testing webhook flow
- [ ] Viewing logs flow

### E2E Tests
- [ ] Complete webhook configuration journey
- [ ] Webhook firing on transcription completion

## Dependencies

### On Design Team:
- UI mockups for webhook settings
- Icon designs for webhook states
- Error and success state designs

### On Backend Team:
- Webhook CRUD API endpoints
- Webhook test endpoint
- Webhook logs API
- Webhook delivery implementation

## Estimated Timeline

- **Total**: 8 days
- Can parallelize some tasks after initial component setup
- Testing and polish can overlap with backend completion

## Notes for Implementation

1. Follow existing Scout UI patterns (VSCode-inspired theme)
2. Use existing form components where possible
3. Ensure responsive design for different window sizes
4. Consider performance with large numbers of webhooks
5. Make webhook URL input smart (auto-prepend https:// if needed)
6. Show helpful examples and documentation links
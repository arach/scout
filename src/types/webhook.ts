export interface Webhook {
  id: string;
  url: string;
  description?: string;
  enabled: boolean;
  created_at: string;
  last_triggered?: string;
}

export interface CreateWebhookDto {
  url: string;
  description?: string;
  enabled?: boolean;
}

export interface UpdateWebhookDto {
  url?: string;
  description?: string;
  enabled?: boolean;
}

export interface WebhookLog {
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

export interface WebhookTestResult {
  success: boolean;
  status_code?: number;
  response_time_ms?: number;
  error_message?: string;
}

export interface WebhookLogFilters {
  webhook_id?: string;
  status?: 'success' | 'failure';
  start_date?: string;
  end_date?: string;
  limit?: number;
  offset?: number;
}

export interface PaginatedWebhookLogs {
  logs: WebhookLog[];
  total: number;
  offset: number;
  limit: number;
}

// Webhook payload structure that gets sent to endpoints
export interface WebhookPayload {
  event: 'transcription.completed';
  timestamp: string;
  transcription: {
    id: number;
    text: string;
    duration_ms: number;
    created_at: string;
    audio_file: string;
    file_size: number;
  };
  model: {
    name: string;
    version: string;
  };
  app: {
    name: string;
    version: string;
    platform: string;
  };
}
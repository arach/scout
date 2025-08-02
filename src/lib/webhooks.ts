import { invokeTyped } from '../types/tauri';
import { 
  Webhook, 
  CreateWebhookDto, 
  UpdateWebhookDto, 
  WebhookTestResult, 
  WebhookLogFilters, 
  PaginatedWebhookLogs 
} from '../types/webhook';
import { loggers } from '../utils/logger';

/**
 * Webhook API client for interfacing with Tauri backend
 */
export const webhookApi = {
  /**
   * Get all webhooks
   */
  async getWebhooks(): Promise<Webhook[]> {
    try {
      const webhooks = await invokeTyped<Webhook[]>('get_webhooks');
      loggers.api.debug('Retrieved webhooks', { count: webhooks.length });
      return webhooks;
    } catch (error) {
      loggers.api.error('Failed to get webhooks', error);
      throw error;
    }
  },

  /**
   * Create a new webhook
   */
  async createWebhook(webhook: CreateWebhookDto): Promise<Webhook> {
    try {
      // Validate URL format
      if (!isValidUrl(webhook.url)) {
        throw new Error('Invalid URL format');
      }

      const newWebhook = await invokeTyped<Webhook>('create_webhook', { webhook });
      loggers.api.info('Created webhook', { id: newWebhook.id, url: newWebhook.url });
      return newWebhook;
    } catch (error) {
      loggers.api.error('Failed to create webhook', error);
      throw error;
    }
  },

  /**
   * Update an existing webhook
   */
  async updateWebhook(id: string, webhook: UpdateWebhookDto): Promise<Webhook> {
    try {
      // Validate URL format if URL is being updated
      if (webhook.url && !isValidUrl(webhook.url)) {
        throw new Error('Invalid URL format');
      }

      const updatedWebhook = await invokeTyped<Webhook>('update_webhook', { id, webhook });
      loggers.api.info('Updated webhook', { id, changes: Object.keys(webhook) });
      return updatedWebhook;
    } catch (error) {
      loggers.api.error('Failed to update webhook', error);
      throw error;
    }
  },

  /**
   * Delete a webhook
   */
  async deleteWebhook(id: string): Promise<void> {
    try {
      await invokeTyped<void>('delete_webhook', { id });
      loggers.api.info('Deleted webhook', { id });
    } catch (error) {
      loggers.api.error('Failed to delete webhook', error);
      throw error;
    }
  },

  /**
   * Test a webhook endpoint
   */
  async testWebhook(id: string): Promise<WebhookTestResult> {
    try {
      const result = await invokeTyped<WebhookTestResult>('test_webhook', { id });
      loggers.api.info('Tested webhook', { 
        id, 
        success: result.success, 
        statusCode: result.status_code,
        responseTime: result.response_time_ms 
      });
      return result;
    } catch (error) {
      loggers.api.error('Failed to test webhook', error);
      throw error;
    }
  },

  /**
   * Get webhook delivery logs with optional filtering
   */
  async getWebhookLogs(filters?: WebhookLogFilters): Promise<PaginatedWebhookLogs> {
    try {
      const logs = await invokeTyped<PaginatedWebhookLogs>('get_webhook_logs', { filters });
      loggers.api.debug('Retrieved webhook logs', { 
        count: logs.logs.length, 
        total: logs.total,
        filters 
      });
      return logs;
    } catch (error) {
      loggers.api.error('Failed to get webhook logs', error);
      throw error;
    }
  }
};

/**
 * Validate URL format
 */
export function isValidUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Format URL for display - adds https:// if no protocol is present
 */
export function formatWebhookUrl(url: string): string {
  if (!url) return '';
  
  // If no protocol, assume https
  if (!url.includes('://')) {
    return `https://${url}`;
  }
  
  return url;
}

/**
 * Validate webhook form data
 */
export function validateWebhookForm(data: CreateWebhookDto | UpdateWebhookDto): string[] {
  const errors: string[] = [];
  
  if ('url' in data && data.url) {
    if (!isValidUrl(data.url)) {
      errors.push('Please enter a valid URL (must start with http:// or https://)');
    }
  }
  
  if ('description' in data && data.description && data.description.length > 255) {
    errors.push('Description must be less than 255 characters');
  }
  
  return errors;
}

/**
 * Get webhook status display info
 */
export function getWebhookStatusInfo(webhook: Webhook) {
  if (!webhook.enabled) {
    return {
      status: 'disabled' as const,
      color: 'var(--text-secondary)',
      text: 'Disabled'
    };
  }
  
  if (!webhook.last_triggered) {
    return {
      status: 'untested' as const,
      color: 'var(--warning-color)',
      text: 'Not yet triggered'
    };
  }
  
  return {
    status: 'active' as const,
    color: 'var(--success-color)',
    text: 'Active'
  };
}
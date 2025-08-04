import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Globe, Trash2, Edit3, TestTube, Activity, AlertCircle, Clock } from 'lucide-react';
import { Button } from './Button';
import { WebhookLogsModal } from './WebhookLogsModal';
import { Webhook, CreateWebhookDto, UpdateWebhookDto } from '../types/webhook';
import { webhookApi, validateWebhookForm, getWebhookStatusInfo, formatWebhookUrl } from '../lib/webhooks';
import { loggers } from '../utils/logger';
import './WebhookManagement.css';

interface WebhookManagementProps {
  className?: string;
}

export const WebhookManagement: React.FC<WebhookManagementProps> = ({ className = '' }) => {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingWebhook, setEditingWebhook] = useState<Webhook | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [testingWebhookId, setTestingWebhookId] = useState<string | null>(null);
  const [showLogsModal, setShowLogsModal] = useState(false);

  // Load webhooks on mount
  useEffect(() => {
    loadWebhooks();
  }, []);

  const loadWebhooks = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const webhookData = await webhookApi.getWebhooks();
      setWebhooks(webhookData);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load webhooks';
      setError(errorMessage);
      loggers.ui.error('Failed to load webhooks', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleAddWebhook = () => {
    setShowAddForm(true);
    setEditingWebhook(null);
  };

  const handleEditWebhook = (webhook: Webhook) => {
    setEditingWebhook(webhook);
    setShowAddForm(false);
  };

  const handleCancelEdit = () => {
    setEditingWebhook(null);
    setShowAddForm(false);
  };

  const handleDeleteWebhook = async (id: string) => {
    if (!confirm('Are you sure you want to delete this webhook? This action cannot be undone.')) {
      return;
    }

    try {
      await webhookApi.deleteWebhook(id);
      setWebhooks(prev => prev.filter(w => w.id !== id));
      loggers.ui.info('Webhook deleted successfully');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete webhook';
      setError(errorMessage);
      loggers.ui.error('Failed to delete webhook', err);
    }
  };

  const handleTestWebhook = async (id: string) => {
    try {
      setTestingWebhookId(id);
      const result = await webhookApi.testWebhook(id);
      
      if (result.success) {
        alert(`Webhook test successful!\nStatus: ${result.status_code}\nResponse time: ${result.response_time_ms}ms`);
      } else {
        alert(`Webhook test failed:\n${result.error_message || 'Unknown error'}`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to test webhook';
      alert(`Test failed: ${errorMessage}`);
      loggers.ui.error('Failed to test webhook', err);
    } finally {
      setTestingWebhookId(null);
    }
  };

  const handleToggleWebhook = async (webhook: Webhook) => {
    try {
      const updatedWebhook = await webhookApi.updateWebhook(webhook.id, {
        enabled: !webhook.enabled
      });
      
      setWebhooks(prev => prev.map(w => 
        w.id === webhook.id ? updatedWebhook : w
      ));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to toggle webhook';
      setError(errorMessage);
      loggers.ui.error('Failed to toggle webhook', err);
    }
  };

  if (loading) {
    return (
      <div className={`min-h-screen bg-gray-50 dark:bg-gray-900 ${className}`}>
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
              Webhook Management
            </h1>
          </div>
          <div className="webhook-loading">
            <Clock size={16} />
            Loading webhooks...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-gray-50 dark:bg-gray-900 ${className}`}>
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Webhook Management
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Configure webhooks to automatically send transcription data to external services and APIs
          </p>
        </div>

        {error && (
          <div className="webhook-error mb-6">
            <AlertCircle size={16} />
            <span>{error}</span>
            <button onClick={() => setError(null)} className="error-dismiss">×</button>
          </div>
        )}

        <div className="webhook-header">
          <div className="webhook-header-content">
            <h4>Configured Webhooks</h4>
            <p className="webhook-description">
              Automatically send transcription data to external endpoints
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button
            variant="ghost"
            size="small"
            icon={<Activity size={14} />}
            onClick={() => setShowLogsModal(true)}
          >
            View Logs
          </Button>
          <Button
            variant="primary"
            size="small"
            icon={<Plus size={14} />}
            onClick={handleAddWebhook}
          >
            Add Webhook
          </Button>
        </div>
      </div>

      {webhooks.length === 0 ? (
        <div className="webhook-empty-state">
          <Globe size={32} />
          <h4>No webhooks configured</h4>
          <p>Add your first webhook to start receiving transcription notifications</p>
          <Button
            variant="primary"
            icon={<Plus size={16} />}
            onClick={handleAddWebhook}
          >
            Add Webhook
          </Button>
        </div>
      ) : (
        <div className="webhook-list">
          {webhooks.map((webhook) => (
            <WebhookItem
              key={webhook.id}
              webhook={webhook}
              onEdit={() => handleEditWebhook(webhook)}
              onDelete={() => handleDeleteWebhook(webhook.id)}
              onTest={() => handleTestWebhook(webhook.id)}
              onToggle={() => handleToggleWebhook(webhook)}
              testing={testingWebhookId === webhook.id}
            />
          ))}
        </div>
      )}

      {(showAddForm || editingWebhook) && (
        <WebhookForm
          webhook={editingWebhook}
          onSave={async (webhookData) => {
            try {
              if (editingWebhook) {
                const updated = await webhookApi.updateWebhook(editingWebhook.id, webhookData);
                setWebhooks(prev => prev.map(w => 
                  w.id === editingWebhook.id ? updated : w
                ));
              } else {
                const newWebhook = await webhookApi.createWebhook(webhookData as CreateWebhookDto);
                setWebhooks(prev => [...prev, newWebhook]);
              }
              handleCancelEdit();
            } catch (err) {
              const errorMessage = err instanceof Error ? err.message : 'Failed to save webhook';
              setError(errorMessage);
              throw err;
            }
          }}
          onCancel={handleCancelEdit}
        />
      )}

        <WebhookLogsModal
          isOpen={showLogsModal}
          onClose={() => setShowLogsModal(false)}
        />
      </div>
    </div>
  );
};

interface WebhookItemProps {
  webhook: Webhook;
  onEdit: () => void;
  onDelete: () => void;
  onTest: () => void;
  onToggle: () => void;
  testing: boolean;
}

const WebhookItem: React.FC<WebhookItemProps> = ({
  webhook,
  onEdit,
  onDelete,
  onTest,
  onToggle,
  testing
}) => {
  const statusInfo = getWebhookStatusInfo(webhook);

  return (
    <div className={`webhook-item ${!webhook.enabled ? 'webhook-item--disabled' : ''}`}>
      <div className="webhook-item-main">
        <div className="webhook-item-header">
          <div className="webhook-url">
            <Globe size={14} />
            <span>{webhook.url}</span>
          </div>
          <div className="webhook-status" style={{ color: statusInfo.color }}>
            <span className="webhook-status-indicator" />
            {statusInfo.text}
          </div>
        </div>
        
        {webhook.description && (
          <div className="webhook-description">
            {webhook.description}
          </div>
        )}

        <div className="webhook-meta">
          <span>Created {new Date(webhook.created_at).toLocaleDateString()}</span>
          {webhook.last_triggered && (
            <span>Last triggered {new Date(webhook.last_triggered).toLocaleDateString()}</span>
          )}
        </div>
      </div>

      <div className="webhook-actions">
        <Button
          variant="ghost"
          size="small"
          icon={<TestTube size={14} />}
          onClick={onTest}
          loading={testing}
          disabled={!webhook.enabled}
        >
          Test
        </Button>
        <Button
          variant="ghost"
          size="small"
          icon={<Edit3 size={14} />}
          onClick={onEdit}
        >
          Edit
        </Button>
        <Button
          variant="ghost"
          size="small"
          icon={<Trash2 size={14} />}
          onClick={onDelete}
        >
          Delete
        </Button>
        <label className="webhook-toggle">
          <input
            type="checkbox"
            checked={webhook.enabled}
            onChange={onToggle}
          />
          <span className="webhook-toggle-slider" />
        </label>
      </div>
    </div>
  );
};

interface WebhookFormProps {
  webhook?: Webhook | null;
  onSave: (webhook: CreateWebhookDto | UpdateWebhookDto) => Promise<void>;
  onCancel: () => void;
}

const WebhookForm: React.FC<WebhookFormProps> = ({ webhook, onSave, onCancel }) => {
  const [formData, setFormData] = useState({
    url: webhook?.url || '',
    description: webhook?.description || '',
    enabled: webhook?.enabled ?? true
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const formattedUrl = formatWebhookUrl(formData.url);
    const validationErrors = validateWebhookForm({
      url: formattedUrl,
      description: formData.description,
      enabled: formData.enabled
    });
    
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    if (!formattedUrl) {
      setErrors(['URL is required']);
      return;
    }

    try {
      setSaving(true);
      setErrors([]);
      
      const webhookData = {
        url: formattedUrl,
        description: formData.description || undefined,
        enabled: formData.enabled
      };
      await onSave(webhookData);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to save webhook';
      setErrors([errorMessage]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="webhook-form-overlay">
      <div className="webhook-form">
        <div className="webhook-form-header">
          <h4>{webhook ? 'Edit Webhook' : 'Add New Webhook'}</h4>
        </div>

        {errors.length > 0 && (
          <div className="webhook-form-errors">
            {errors.map((error, index) => (
              <div key={index} className="webhook-form-error">
                <AlertCircle size={14} />
                {error}
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="webhook-form-field">
            <label htmlFor="webhook-url">
              Endpoint URL *
            </label>
            <input
              id="webhook-url"
              type="url"
              value={formData.url}
              onChange={(e) => setFormData(prev => ({ ...prev, url: e.target.value }))}
              placeholder="https://api.example.com/webhooks"
              required
            />
            <div className="webhook-form-hint">
              The URL where transcription data will be sent via HTTP POST
            </div>
          </div>

          <div className="webhook-form-field">
            <label htmlFor="webhook-description">
              Description
            </label>
            <input
              id="webhook-description"
              type="text"
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              placeholder="e.g., Slack notifications, Database sync"
              maxLength={255}
            />
            <div className="webhook-form-hint">
              Optional description to help identify this webhook
            </div>
          </div>

          <div className="webhook-form-field">
            <label className="webhook-form-checkbox">
              <input
                type="checkbox"
                checked={formData.enabled}
                onChange={(e) => setFormData(prev => ({ ...prev, enabled: e.target.checked }))}
              />
              Enable webhook
            </label>
            <div className="webhook-form-hint">
              Disabled webhooks will not receive transcription notifications
            </div>
          </div>

          <div className="webhook-form-actions">
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={saving}
            >
              {webhook ? 'Update Webhook' : 'Add Webhook'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
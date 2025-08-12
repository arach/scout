import React, { useState, useEffect } from 'react';
import { useUIContext } from '../../contexts/UIContext';
import { webhookApi } from '../../lib/webhooks';
import { Toggle } from '../ui/Toggle';
import { ArrowRight, CheckCircle, Clock, Shield, Zap, ExternalLink } from 'lucide-react';
import './WebhookSettingsSimple.css';

export const WebhookSettingsSimple: React.FC = () => {
  const [webhooksEnabled, setWebhooksEnabled] = useState(false);
  const [webhookCount, setWebhookCount] = useState(0);
  const { setCurrentView } = useUIContext();

  useEffect(() => {
    loadWebhookStatus();
  }, []);

  const loadWebhookStatus = async () => {
    try {
      const webhooks = await webhookApi.getWebhooks();
      setWebhookCount(webhooks.length);
      setWebhooksEnabled(webhooks.some(webhook => webhook.enabled));
    } catch (err) {
      console.error('Failed to load webhook status', err);
    }
  };

  const handleToggleWebhooks = async () => {
    try {
      const webhooks = await webhookApi.getWebhooks();
      
      if (webhooksEnabled) {
        // Disable all
        await Promise.all(
          webhooks.map(webhook => 
            webhookApi.updateWebhook(webhook.id, { ...webhook, enabled: false })
          )
        );
        setWebhooksEnabled(false);
        
        // Trigger a custom event to notify sidebar
        window.dispatchEvent(new CustomEvent('webhook-status-changed', { 
          detail: { enabled: false } 
        }));
      } else {
        // If no webhooks, go to setup
        if (webhookCount === 0) {
          setCurrentView('webhooks');
          return;
        }
        
        // Enable all
        await Promise.all(
          webhooks.map(webhook => 
            webhookApi.updateWebhook(webhook.id, { ...webhook, enabled: true })
          )
        );
        setWebhooksEnabled(true);
        
        // Trigger a custom event to notify sidebar
        window.dispatchEvent(new CustomEvent('webhook-status-changed', { 
          detail: { enabled: true } 
        }));
      }
    } catch (err) {
      console.error('Failed to toggle webhooks', err);
    }
  };

  const payloadExample = `{
  "id": "transcript_abc123",
  "text": "Meeting transcript content...",
  "timestamp": "2024-01-15T10:30:00Z",
  "duration_ms": 45000,
  "word_count": 523,
  "source": "scout",
  "metadata": {
    "app_version": "0.4.0",
    "model": "whisper-base"
  }
}`;

  return (
    <div className="webhook-settings-simple">
      {/* Main toggle and controls */}
      <div className="setting-item">
        <Toggle
          label={`Enable webhooks${webhookCount > 0 ? ` (${webhookCount} configured)` : ''}`}
          checked={webhooksEnabled}
          onChange={handleToggleWebhooks}
          disabled={webhookCount === 0}
          description={webhookCount === 0 ? 'Send transcriptions to external services automatically' : undefined}
        />
        
        {webhookCount > 0 && webhooksEnabled && (
          <div className="webhook-status enabled">
            <CheckCircle size={12} />
            <span>Active - Sending to {webhookCount} endpoint{webhookCount > 1 ? 's' : ''}</span>
          </div>
        )}
      </div>

      {/* Information section */}
      <div className="webhook-info-section">
        <h3 className="webhook-info-title">How Webhooks Work</h3>
        <p className="webhook-description">
          Webhooks automatically send your transcriptions to external services in real-time. 
          Perfect for integrations with note-taking apps, CRMs, or custom workflows.
        </p>
        
        <div className="webhook-features">
          <div className="webhook-feature">
            <Zap size={14} />
            <span>Real-time delivery within seconds of transcription</span>
          </div>
          <div className="webhook-feature">
            <Shield size={14} />
            <span>Secure HTTPS endpoints with optional authentication</span>
          </div>
          <div className="webhook-feature">
            <Clock size={14} />
            <span>Automatic retry with exponential backoff on failure</span>
          </div>
        </div>

        {/* Payload structure */}
        <div className="payload-structure">
          <h4 className="payload-title">Payload Structure (JSON)</h4>
          <pre className="payload-code">
            <code dangerouslySetInnerHTML={{ __html: 
              payloadExample
                .replace(/"([^"]+)":/g, '<span class="key">"$1"</span>:')
                .replace(/: "(transcript_[^"]+)"/g, ': <span class="type">"$1"</span>')
                .replace(/: (\d+)/g, ': <span class="type">$1</span>')
                .replace(/: (true|false)/g, ': <span class="type">$1</span>')
            }} />
          </pre>
        </div>
      </div>

      {/* Manage button */}
      <div className="webhook-controls">
        <button
          onClick={() => setCurrentView('webhooks')}
          className="manage-button"
        >
          {webhookCount === 0 ? (
            <>
              <span>Set up webhooks</span>
              <ArrowRight size={14} />
            </>
          ) : (
            <>
              <span>Manage webhooks</span>
              <ExternalLink size={14} />
            </>
          )}
        </button>
      </div>
    </div>
  );
};
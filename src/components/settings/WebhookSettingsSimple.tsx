import React, { useState, useEffect } from 'react';
import { useUIContext } from '../../contexts/UIContext';
import { webhookApi } from '../../lib/webhooks';
import { Toggle } from '../ui/Toggle';

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

  return (
    <div className="webhook-settings-simple">
      <div className="setting-item">
        <Toggle
          label={`Enable webhooks${webhookCount > 0 ? ` (${webhookCount} configured)` : ''}`}
          checked={webhooksEnabled}
          onChange={handleToggleWebhooks}
          disabled={webhookCount === 0}
          description={webhookCount === 0 ? 'Send transcriptions to external services automatically' : undefined}
        />
        <button
          onClick={() => setCurrentView('webhooks')}
          className="manage-button"
          style={{ marginTop: '12px' }}
        >
          {webhookCount === 0 ? 'Set up' : 'Manage'}
        </button>
      </div>
    </div>
  );
};
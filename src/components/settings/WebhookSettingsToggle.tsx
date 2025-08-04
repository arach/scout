import React, { useState, useEffect } from 'react';
import { Globe, ExternalLink } from 'lucide-react';
import { useUIContext } from '../../contexts/UIContext';
import { webhookApi } from '../../lib/webhooks';
import { loggers } from '../../utils/logger';

interface WebhookSettingsToggleProps {
  className?: string;
}

export const WebhookSettingsToggle: React.FC<WebhookSettingsToggleProps> = ({ className = '' }) => {
  const [webhooksEnabled, setWebhooksEnabled] = useState(false);
  const [webhookCount, setWebhookCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const { setCurrentView } = useUIContext();

  useEffect(() => {
    loadWebhookStatus();
  }, []);

  const loadWebhookStatus = async () => {
    try {
      setLoading(true);
      const webhooks = await webhookApi.getWebhooks();
      setWebhookCount(webhooks.length);
      setWebhooksEnabled(webhooks.some(webhook => webhook.enabled));
    } catch (err) {
      loggers.ui.error('Failed to load webhook status', err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleWebhooks = async () => {
    try {
      if (webhooksEnabled) {
        // Disable all webhooks
        const webhooks = await webhookApi.getWebhooks();
        await Promise.all(
          webhooks.map(webhook => 
            webhookApi.updateWebhook(webhook.id, { ...webhook, enabled: false })
          )
        );
        setWebhooksEnabled(false);
      } else {
        // If no webhooks exist, navigate to management page
        if (webhookCount === 0) {
          setCurrentView('webhooks');
          return;
        }
        
        // Enable all webhooks
        const webhooks = await webhookApi.getWebhooks();
        await Promise.all(
          webhooks.map(webhook => 
            webhookApi.updateWebhook(webhook.id, { ...webhook, enabled: true })
          )
        );
        setWebhooksEnabled(true);
      }
    } catch (err) {
      loggers.ui.error('Failed to toggle webhooks', err);
    }
  };

  const handleManageWebhooks = () => {
    setCurrentView('webhooks');
  };

  if (loading) {
    return (
      <div className={`p-4 border rounded-lg bg-white dark:bg-gray-800 ${className}`}>
        <div className="flex items-center space-x-2">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            Loading webhook settings...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={`p-4 border rounded-lg bg-white dark:bg-gray-800 ${className}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Globe className="h-5 w-5 text-blue-600" />
          <div>
            <h4 className="text-lg font-medium text-gray-900 dark:text-white">
              Webhooks
            </h4>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {webhookCount === 0 
                ? 'Send transcriptions to external services'
                : `${webhookCount} webhook${webhookCount !== 1 ? 's' : ''} configured`
              }
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {webhookCount > 0 && (
            <label className="flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={webhooksEnabled}
                onChange={handleToggleWebhooks}
                className="sr-only"
              />
              <div className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                webhooksEnabled 
                  ? 'bg-blue-600' 
                  : 'bg-gray-200 dark:bg-gray-700'
              }`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  webhooksEnabled ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </div>
              <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                {webhooksEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </label>
          )}
          
          <button
            onClick={handleManageWebhooks}
            className="flex items-center space-x-1 px-3 py-2 text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/20"
          >
            <span>{webhookCount === 0 ? 'Set up' : 'Manage'}</span>
            <ExternalLink className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
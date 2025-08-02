import React from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';
import { WebhookLogs } from './WebhookLogs';
import './WebhookLogsModal.css';

interface WebhookLogsModalProps {
  isOpen: boolean;
  onClose: () => void;
  webhookId?: string;
}

export const WebhookLogsModal: React.FC<WebhookLogsModalProps> = ({
  isOpen,
  onClose,
  webhookId
}) => {
  if (!isOpen) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="webhook-logs-modal-overlay" onClick={handleOverlayClick}>
      <div className="webhook-logs-modal">
        <div className="webhook-logs-modal-header">
          <h2>Webhook Delivery Logs</h2>
          <Button
            variant="ghost"
            size="small"
            icon={<X size={16} />}
            onClick={onClose}
            iconOnly
            aria-label="Close logs"
          />
        </div>
        
        <div className="webhook-logs-modal-content">
          <WebhookLogs webhookId={webhookId} />
        </div>
      </div>
    </div>
  );
};
import React, { useState, useEffect, useCallback } from 'react';
import { 
  Activity, 
  Filter, 
  Clock, 
  CheckCircle, 
  XCircle, 
  AlertCircle,
  ChevronDown,
  RefreshCw,
  Globe
} from 'lucide-react';
import { Button } from './Button';
import { WebhookLog, type WebhookLogFilters, PaginatedWebhookLogs } from '../types/webhook';
import { webhookApi } from '../lib/webhooks';
import { loggers } from '../utils/logger';
import './WebhookLogs.css';

interface WebhookLogsProps {
  className?: string;
  webhookId?: string; // Filter to specific webhook
}

export const WebhookLogs: React.FC<WebhookLogsProps> = ({ 
  className = '', 
  webhookId 
}) => {
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<WebhookLogFilters>({
    webhook_id: webhookId,
    limit: 50,
    offset: 0
  });
  const [totalLogs, setTotalLogs] = useState(0);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  // Load logs on mount and when filters change
  useEffect(() => {
    loadLogs();
  }, [filters]);

  const loadLogs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result: PaginatedWebhookLogs = await webhookApi.getWebhookLogs(filters);
      setLogs(result.logs);
      setTotalLogs(result.total);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load webhook logs';
      setError(errorMessage);
      loggers.ui.error('Failed to load webhook logs', err);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const handleRefresh = () => {
    loadLogs();
  };

  const handleFilterChange = (newFilters: Partial<WebhookLogFilters>) => {
    setFilters(prev => ({
      ...prev,
      ...newFilters,
      offset: 0 // Reset pagination when filters change
    }));
  };

  const handleLoadMore = () => {
    setFilters(prev => ({
      ...prev,
      offset: (prev.offset || 0) + (prev.limit || 50)
    }));
  };


  return (
    <div className={`webhook-logs ${className}`}>
      <div className="webhook-logs-header">
        <div className="webhook-logs-title">
          <Activity size={20} />
          <h3>Webhook Delivery Logs</h3>
          <span className="webhook-logs-count">
            {totalLogs} {totalLogs === 1 ? 'entry' : 'entries'}
          </span>
        </div>
        
        <div className="webhook-logs-actions">
          <Button
            variant="ghost"
            size="small"
            icon={<Filter size={14} />}
            onClick={() => setShowFilters(!showFilters)}
          >
            Filters
          </Button>
          <Button
            variant="ghost"
            size="small"
            icon={<RefreshCw size={14} />}
            onClick={handleRefresh}
            loading={loading}
          >
            Refresh
          </Button>
        </div>
      </div>

      {showFilters && (
        <WebhookLogFilters
          filters={filters}
          onChange={handleFilterChange}
          onClose={() => setShowFilters(false)}
        />
      )}

      {error && (
        <div className="webhook-logs-error">
          <AlertCircle size={16} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="error-dismiss">×</button>
        </div>
      )}

      {loading && logs.length === 0 ? (
        <div className="webhook-logs-loading">
          <Clock size={16} />
          Loading logs...
        </div>
      ) : logs.length === 0 ? (
        <div className="webhook-logs-empty">
          <Activity size={32} />
          <h4>No delivery logs</h4>
          <p>Webhook delivery attempts will appear here once you start receiving transcriptions</p>
        </div>
      ) : (
        <>
          <div className="webhook-logs-list">
            {logs.map((log) => (
              <WebhookLogItem
                key={log.id}
                log={log}
                expanded={expandedLogId === log.id}
                onToggleExpanded={() => 
                  setExpandedLogId(prev => prev === log.id ? null : log.id)
                }
              />
            ))}
          </div>
          
          {logs.length < totalLogs && (
            <div className="webhook-logs-pagination">
              <Button
                variant="ghost"
                onClick={handleLoadMore}
                loading={loading}
              >
                Load More ({totalLogs - logs.length} remaining)
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

interface WebhookLogFiltersProps {
  filters: WebhookLogFilters;
  onChange: (filters: Partial<WebhookLogFilters>) => void;
  onClose: () => void;
}

const WebhookLogFilters: React.FC<WebhookLogFiltersProps> = ({
  filters,
  onChange,
  onClose
}) => {
  const [localFilters, setLocalFilters] = useState(filters);

  const handleApply = () => {
    onChange(localFilters);
    onClose();
  };

  const handleReset = () => {
    const resetFilters = { limit: 50, offset: 0 };
    setLocalFilters(resetFilters);
    onChange(resetFilters);
    onClose();
  };

  return (
    <div className="webhook-log-filters">
      <div className="webhook-log-filters-content">
        <div className="webhook-log-filters-field">
          <label>Status</label>
          <select
            value={localFilters.status || ''}
            onChange={(e) => setLocalFilters(prev => ({
              ...prev,
              status: e.target.value as 'success' | 'failure' | undefined
            }))}
          >
            <option value="">All statuses</option>
            <option value="success">Success</option>
            <option value="failure">Failure</option>
          </select>
        </div>

        <div className="webhook-log-filters-field">
          <label>Start Date</label>
          <input
            type="date"
            value={localFilters.start_date || ''}
            onChange={(e) => setLocalFilters(prev => ({
              ...prev,
              start_date: e.target.value || undefined
            }))}
          />
        </div>

        <div className="webhook-log-filters-field">
          <label>End Date</label>
          <input
            type="date"
            value={localFilters.end_date || ''}
            onChange={(e) => setLocalFilters(prev => ({
              ...prev,
              end_date: e.target.value || undefined
            }))}
          />
        </div>
      </div>

      <div className="webhook-log-filters-actions">
        <Button variant="ghost" size="small" onClick={handleReset}>
          Reset
        </Button>
        <Button variant="primary" size="small" onClick={handleApply}>
          Apply Filters
        </Button>
      </div>
    </div>
  );
};

interface WebhookLogItemProps {
  log: WebhookLog;
  expanded: boolean;
  onToggleExpanded: () => void;
}

const WebhookLogItem: React.FC<WebhookLogItemProps> = ({
  log,
  expanded,
  onToggleExpanded
}) => {
  const getStatusIcon = (status: 'success' | 'failure') => {
    return status === 'success' ? (
      <CheckCircle size={16} className="status-icon status-icon--success" />
    ) : (
      <XCircle size={16} className="status-icon status-icon--failure" />
    );
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return {
      date: date.toLocaleDateString(),
      time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
  };

  const getResponseTimeColor = (responseTime: number) => {
    if (responseTime < 500) return 'var(--success-color)';
    if (responseTime < 2000) return 'var(--warning-color)';
    return 'var(--error-color)';
  };

  const { date, time } = formatTimestamp(log.timestamp);
  const responseTimeColor = getResponseTimeColor(log.response_time_ms);

  return (
    <div className={`webhook-log-item ${log.status === 'failure' ? 'webhook-log-item--failure' : ''}`}>
      <div className="webhook-log-item-header" onClick={onToggleExpanded}>
        <div className="webhook-log-item-main">
          <div className="webhook-log-item-status">
            {getStatusIcon(log.status)}
            <span className="webhook-log-item-url">
              <Globe size={12} />
              {log.webhook_url}
            </span>
          </div>
          
          <div className="webhook-log-item-meta">
            <span className="webhook-log-item-time">
              <Clock size={12} />
              {date} at {time}
            </span>
            <span 
              className="webhook-log-item-response-time"
              style={{ color: responseTimeColor }}
            >
              {log.response_time_ms}ms
            </span>
            {log.status_code && (
              <span className="webhook-log-item-status-code">
                HTTP {log.status_code}
              </span>
            )}
            {log.attempt_number > 1 && (
              <span className="webhook-log-item-retry">
                Attempt {log.attempt_number}
              </span>
            )}
          </div>
        </div>

        <ChevronDown 
          size={16} 
          className={`webhook-log-item-chevron ${expanded ? 'expanded' : ''}`}
        />
      </div>

      {expanded && (
        <div className="webhook-log-item-details">
          <div className="webhook-log-item-detail-row">
            <strong>Payload Size:</strong>
            <span>{(log.payload_size / 1024).toFixed(1)} KB</span>
          </div>
          
          {log.error_message && (
            <div className="webhook-log-item-detail-row">
              <strong>Error:</strong>
              <span className="webhook-log-item-error">{log.error_message}</span>
            </div>
          )}
          
          <div className="webhook-log-item-detail-row">
            <strong>Webhook ID:</strong>
            <span className="webhook-log-item-id">{log.webhook_id}</span>
          </div>
          
          <div className="webhook-log-item-detail-row">
            <strong>Log ID:</strong>
            <span className="webhook-log-item-id">{log.id}</span>
          </div>
        </div>
      )}
    </div>
  );
};
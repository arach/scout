import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { 
  Activity, 
  Cpu, 
  HardDrive, 
  Hash, 
  RefreshCw, 
  CheckCircle, 
  AlertCircle,
  Trash2,
  RotateCw,
  Info
} from 'lucide-react';
import './ProcessMonitor.css';

interface ProcessInfo {
  name: string;
  pid: number;
  command: string;
  memory_mb: number;
  cpu_percent: number;
  children: number[];
  started_at: number;
}

interface ProcessStatus {
  processes: ProcessInfo[];
  count: number;
  timestamp: number;
}

interface ServiceHealth {
  transcriber: {
    healthy: boolean;
    error?: string;
    details: Record<string, string>;
    last_check: number;
  };
  launchctl: {
    running: boolean;
    pid?: number;
    healthy: boolean;
    error?: string;
  };
  timestamp: number;
}

export const ProcessMonitor: React.FC = () => {
  const [processStatus, setProcessStatus] = useState<ProcessStatus | null>(null);
  const [serviceHealth, setServiceHealth] = useState<ServiceHealth | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastError, setLastError] = useState<string | null>(null);
  const [operationInProgress, setOperationInProgress] = useState<string | null>(null);

  useEffect(() => {
    refreshStatus();
  }, []);

  useEffect(() => {
    if (autoRefresh) {
      const interval = setInterval(refreshStatus, 3000); // Refresh every 3 seconds
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const refreshStatus = async () => {
    if (isRefreshing) return;
    
    setIsRefreshing(true);
    setLastError(null);
    
    try {
      // Get process status
      const status = await invoke<ProcessStatus>('get_process_status');
      setProcessStatus(status);
      
      // Get service health
      const health = await invoke<ServiceHealth>('check_service_health');
      setServiceHealth(health);
    } catch (error) {
      console.error('Failed to refresh process status:', error);
      setLastError(String(error));
    } finally {
      setIsRefreshing(false);
    }
  };

  const killOrphaned = async () => {
    setOperationInProgress('kill_orphaned');
    try {
      const result = await invoke<string>('kill_orphaned_processes');
      console.log('Kill orphaned result:', result);
      await refreshStatus();
    } catch (error) {
      console.error('Failed to kill orphaned processes:', error);
      setLastError(String(error));
    } finally {
      setOperationInProgress(null);
    }
  };

  const restartUnhealthy = async () => {
    setOperationInProgress('restart_unhealthy');
    try {
      const result = await invoke<string>('restart_unhealthy_services');
      console.log('Restart result:', result);
      await refreshStatus();
    } catch (error) {
      console.error('Failed to restart services:', error);
      setLastError(String(error));
    } finally {
      setOperationInProgress(null);
    }
  };

  const formatUptime = (startedAt: number) => {
    const now = Date.now() / 1000;
    const diff = now - startedAt;
    
    if (diff < 60) return `${Math.floor(diff)}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`;
    return `${Math.floor(diff / 86400)}d ${Math.floor((diff % 86400) / 3600)}h`;
  };

  const getHealthIcon = (healthy: boolean) => {
    return healthy ? 
      <CheckCircle className="status-icon healthy" size={16} /> :
      <AlertCircle className="status-icon unhealthy" size={16} />;
  };

  const getPortStatus = (details: Record<string, string>) => {
    const ports = [
      { port: '5555', name: 'Push' },
      { port: '5556', name: 'Pull' },
      { port: '5557', name: 'Control' }
    ];
    return ports.map(({ port, name }) => {
      const status = details[`port_${port}`];
      const isOpen = status === 'open';
      const statusText = status || 'not responding';
      
      return (
        <div key={port} className={`port-status ${isOpen ? 'open' : 'closed'}`} title={`${name} port ${port}`}>
          <span className="port-number">{port}</span>
          <span className="port-state">
            {isOpen ? '✓' : statusText}
          </span>
        </div>
      );
    });
  };

  return (
    <div className="process-monitor">
      <div className="monitor-header">
        <h3 className="monitor-title">
          <Activity size={18} />
          Process Monitor
        </h3>
        <div className="monitor-controls">
          <label className="auto-refresh-toggle">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh
          </label>
          <button 
            className="refresh-btn"
            onClick={refreshStatus}
            disabled={isRefreshing}
            title="Refresh status"
          >
            <RefreshCw size={14} className={isRefreshing ? 'spinning' : ''} />
          </button>
        </div>
      </div>

      {lastError && (
        <div className="error-banner">
          <AlertCircle size={14} />
          {lastError}
        </div>
      )}

      {/* Service Health Overview */}
      {serviceHealth && (
        <div className="health-overview">
          <div className="health-card">
            <div className="health-header">
              <span className="health-label">Transcriber Service</span>
              {getHealthIcon(serviceHealth.transcriber.healthy)}
            </div>
            {serviceHealth.transcriber.error && (
              <div className="health-error">{serviceHealth.transcriber.error}</div>
            )}
            {!serviceHealth.transcriber.healthy && serviceHealth.launchctl.running && (
              <div className="health-warning">
                Process started but not responding
              </div>
            )}
            <div className="port-list">
              {getPortStatus(serviceHealth.transcriber.details)}
            </div>
          </div>

          <div className="health-card">
            <div className="health-header">
              <span className="health-label">LaunchCtl</span>
              {getHealthIcon(serviceHealth.launchctl.running)}
            </div>
            {serviceHealth.launchctl.pid && (
              <div className="health-detail">PID: {serviceHealth.launchctl.pid}</div>
            )}
            {serviceHealth.launchctl.error && (
              <div className="health-error">{serviceHealth.launchctl.error}</div>
            )}
          </div>
        </div>
      )}

      {/* Process List */}
      {processStatus && processStatus.count > 0 ? (
        <div className="process-list">
          <div className="process-list-header">
            <span className="process-count">{processStatus.count} Process{processStatus.count !== 1 ? 'es' : ''}</span>
          </div>
          {processStatus.processes.map((process) => (
            <div key={process.pid} className="process-item">
              <div className="process-main">
                <div className="process-identity">
                  <Hash size={12} className="pid-icon" />
                  <span className="process-pid">{process.pid}</span>
                  <span className="process-name">{process.name}</span>
                </div>
                <div className="process-stats">
                  <div className="stat-item" title="Memory usage">
                    <HardDrive size={12} />
                    <span>{process.memory_mb.toFixed(1)} MB</span>
                  </div>
                  <div className="stat-item" title="CPU usage">
                    <Cpu size={12} />
                    <span>{process.cpu_percent.toFixed(1)}%</span>
                  </div>
                  <div className="stat-item" title="Uptime">
                    <Activity size={12} />
                    <span>{formatUptime(process.started_at)}</span>
                  </div>
                </div>
              </div>
              <div className="process-command">{process.command}</div>
              {process.children.length > 0 && (
                <div className="process-children">
                  <Info size={12} />
                  {process.children.length} child process{process.children.length !== 1 ? 'es' : ''}
                  <span className="child-pids">({process.children.join(', ')})</span>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="no-processes">
          <Info size={16} />
          <span>No managed processes running</span>
        </div>
      )}

      {/* Action Buttons */}
      <div className="monitor-actions">
        <button 
          className="action-btn cleanup"
          onClick={killOrphaned}
          disabled={operationInProgress !== null}
        >
          {operationInProgress === 'kill_orphaned' ? (
            <RefreshCw size={14} className="spinning" />
          ) : (
            <Trash2 size={14} />
          )}
          Clean up orphaned
        </button>
        
        <button 
          className="action-btn restart"
          onClick={restartUnhealthy}
          disabled={operationInProgress !== null || (serviceHealth?.transcriber.healthy ?? true)}
        >
          {operationInProgress === 'restart_unhealthy' ? (
            <RefreshCw size={14} className="spinning" />
          ) : (
            <RotateCw size={14} />
          )}
          Restart unhealthy
        </button>
      </div>
    </div>
  );
};
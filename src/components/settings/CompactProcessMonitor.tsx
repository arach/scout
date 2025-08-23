import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Activity, RefreshCw, Trash2 } from 'lucide-react';
import './CompactProcessMonitor.css';

interface ServiceStatus {
  running: boolean;
  healthy: boolean;
  pid?: number;
  memory_mb?: number;
  cpu_percent?: number;
  ports?: { [key: string]: string };
  control_plane?: {
    connected: boolean;
    is_healthy?: boolean;
    last_heartbeat_seconds_ago?: number;
    messages_processed?: number;
    worker_id?: string;
  };
  process_stats?: {
    pid: number;
    name: string;
    memory_mb: number;
    cpu_percent: number;
    children: number[];
  };
}

export const CompactProcessMonitor: React.FC = () => {
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const checkStatus = async () => {
    if (isRefreshing) return;
    
    try {
      // Get the service health status including control plane
      const healthStatus = await invoke<any>('check_service_health');
      
      // Transform to our simplified format
      setStatus({
        running: healthStatus.launchctl?.running || false,
        healthy: healthStatus.transcriber?.healthy || false,
        pid: healthStatus.launchctl?.pid,
        memory_mb: healthStatus.process_stats?.memory_mb,
        cpu_percent: healthStatus.process_stats?.cpu_percent,
        ports: healthStatus.transcriber?.details || {},
        control_plane: healthStatus.control_plane,
        process_stats: healthStatus.process_stats
      });
    } catch (error) {
      console.error('Failed to check status:', error);
    }
  };

  const killOrphaned = async () => {
    setIsRefreshing(true);
    try {
      await invoke('kill_orphaned_processes');
      setTimeout(checkStatus, 1000);
    } catch (error) {
      console.error('Failed to kill orphaned processes:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  if (!status || !status.running) return null;

  const portsHealthy = status.ports && 
    Object.values(status.ports).every(s => s === 'listening');

  return (
    <div className="compact-monitor">
      <div className="monitor-row">
        <div className="monitor-status">
          <Activity size={12} className={status.healthy ? 'healthy' : 'unhealthy'} />
          <span className="pid">PID {status.pid}</span>
          {status.memory_mb && (
            <span className="stat" title="Memory usage">
              {status.memory_mb.toFixed(0)}MB
            </span>
          )}
          {status.cpu_percent !== undefined && (
            <span className="stat" title="CPU usage">
              {status.cpu_percent.toFixed(0)}%
            </span>
          )}
          {status.control_plane?.is_healthy && (
            <span className="stat" title={`Last heartbeat ${status.control_plane.last_heartbeat_seconds_ago}s ago`}>
              HB: {status.control_plane.last_heartbeat_seconds_ago}s
            </span>
          )}
        </div>
        
        <div className="monitor-ports">
          {status.ports && Object.entries(status.ports).map(([portKey, status]) => {
            const port = portKey.replace('port_', '');
            const isOpen = status === 'listening';
            return (
              <span key={port} className={`port ${isOpen ? 'open' : 'closed'}`}>
                {port}
              </span>
            );
          })}
        </div>

        <div className="monitor-actions">
          <button 
            className="mini-btn"
            onClick={checkStatus}
            disabled={isRefreshing}
            title="Refresh"
          >
            <RefreshCw size={12} className={isRefreshing ? 'spinning' : ''} />
          </button>
          <button 
            className="mini-btn danger"
            onClick={killOrphaned}
            title="Clean up orphaned processes"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      
      {!status.healthy && (
        <div className="monitor-warning">
          {!portsHealthy ? 'Some ports not listening' : 
           !status.control_plane?.is_healthy ? 'No heartbeat from worker' :
           'Service unhealthy'}
        </div>
      )}
    </div>
  );
};
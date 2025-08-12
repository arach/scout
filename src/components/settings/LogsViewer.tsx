import { memo, useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FileText, FolderOpen, Download, RefreshCw } from 'lucide-react';
import './LogsViewer.css';

export const LogsViewer = memo(function LogsViewer() {
  const [logPath, setLogPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadLogPath();
  }, []);

  const loadLogPath = async () => {
    try {
      setLoading(true);
      const path = await invoke<string | null>('get_log_file_path');
      setLogPath(path);
    } catch (error) {
      console.error('Failed to get log file path:', error);
    } finally {
      setLoading(false);
    }
  };

  const openLogFile = async () => {
    try {
      await invoke('open_log_file');
    } catch (error) {
      console.error('Failed to open log file:', error);
    }
  };

  const showLogInFinder = async () => {
    try {
      await invoke('show_log_file_in_finder');
    } catch (error) {
      console.error('Failed to show log file in finder:', error);
    }
  };

  const exportLogs = async () => {
    try {
      // For now, just open the log file location
      // In the future, we could implement a proper export dialog
      await showLogInFinder();
    } catch (error) {
      console.error('Failed to export logs:', error);
    }
  };

  return (
    <div className="logs-viewer">
      <div className="logs-info">
        <h3>Application Logs</h3>
        <p className="logs-description">
          View and export application logs for debugging and support purposes.
        </p>
        
        {logPath && (
          <div className="log-path">
            <span className="log-path-label">Log file:</span>
            <code className="log-path-value">{logPath}</code>
          </div>
        )}
      </div>

      <div className="logs-actions">
        <button 
          className="logs-btn logs-btn-primary"
          onClick={openLogFile}
          disabled={!logPath || loading}
        >
          <FileText size={16} />
          <span>View Logs</span>
        </button>

        <button 
          className="logs-btn logs-btn-secondary"
          onClick={showLogInFinder}
          disabled={!logPath || loading}
        >
          <FolderOpen size={16} />
          <span>Show in Finder</span>
        </button>

        <button 
          className="logs-btn logs-btn-secondary"
          onClick={exportLogs}
          disabled={!logPath || loading}
        >
          <Download size={16} />
          <span>Export Logs</span>
        </button>

        <button 
          className="logs-btn logs-btn-icon"
          onClick={loadLogPath}
          disabled={loading}
          title="Refresh"
        >
          <RefreshCw size={16} className={loading ? 'spinning' : ''} />
        </button>
      </div>

      <div className="logs-help">
        <p className="logs-help-text">
          <strong>Note:</strong> Logs contain technical information about the application's operation. 
          They may be helpful when reporting issues or getting support.
        </p>
      </div>
    </div>
  );
});
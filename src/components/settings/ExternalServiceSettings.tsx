import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './ExternalServiceSettings.css';

interface ExternalServiceConfig {
  enabled: boolean;
  binary_path?: string;
  use_zeromq: boolean;
  zmq_push_port: number;
  zmq_pull_port: number;
  zmq_control_port: number;
  workers: number;
  model: string;
}

interface ServiceStatus {
  running: boolean;
  healthy: boolean;
  last_check?: string;
  error?: string;
}

export const ExternalServiceSettings: React.FC = () => {
  const [config, setConfig] = useState<ExternalServiceConfig>({
    enabled: false,
    binary_path: 'scout-transcriber',
    use_zeromq: true,
    zmq_push_port: 5555,
    zmq_pull_port: 5556,
    zmq_control_port: 5557,
    workers: 2,
    model: 'whisper'
  });
  
  const [status, setStatus] = useState<ServiceStatus>({
    running: false,
    healthy: false
  });
  
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [installStatus, setInstallStatus] = useState<'checking' | 'installed' | 'not_installed'>('checking');

  useEffect(() => {
    loadConfig();
    checkServiceStatus();
    checkInstallation();
  }, []);

  const loadConfig = async () => {
    try {
      const settings = await invoke<any>('get_settings');
      if (settings.external_service) {
        setConfig(prev => ({ ...prev, ...settings.external_service }));
      }
    } catch (error) {
      console.error('Failed to load external service config:', error);
    }
  };

  const checkServiceStatus = async () => {
    try {
      const status = await invoke<ServiceStatus>('check_external_service_status');
      setStatus(status);
    } catch (error) {
      console.error('Failed to check service status:', error);
      setStatus({ running: false, healthy: false, error: error as string });
    }
  };

  const checkInstallation = async () => {
    try {
      const isInstalled = await invoke<boolean>('check_transcriber_installed');
      setInstallStatus(isInstalled ? 'installed' : 'not_installed');
    } catch (error) {
      console.error('Failed to check installation:', error);
      setInstallStatus('not_installed');
    }
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      const settings = await invoke<any>('get_settings');
      await invoke('update_settings', {
        newSettings: {
          ...settings,
          external_service: config
        }
      });
      
      // If enabled, start the service
      if (config.enabled) {
        await invoke('start_external_service');
      } else {
        await invoke('stop_external_service');
      }
      
      // Recheck status
      await checkServiceStatus();
    } catch (error) {
      console.error('Failed to save config:', error);
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      const result = await invoke<{ success: boolean; message: string }>('test_external_service');
      if (result.success) {
        alert('✅ Connection successful!\n\n' + result.message);
      } else {
        alert('❌ Connection failed\n\n' + result.message);
      }
    } catch (error) {
      alert('❌ Connection test failed\n\n' + error);
    } finally {
      setTesting(false);
      await checkServiceStatus();
    }
  };

  const handleInstall = () => {
    // Open installation script in browser (as .txt so it displays rather than downloads)
    invoke('open_url', { url: 'https://scout.arach.dev/transcriber-install.txt' });
  };

  const handleToggleEnabled = async () => {
    const newEnabled = !config.enabled;
    setConfig(prev => ({ ...prev, enabled: newEnabled }));
    
    // Auto-save when toggling
    setSaving(true);
    try {
      const settings = await invoke<any>('get_settings');
      await invoke('update_settings', {
        newSettings: {
          ...settings,
          external_service: { ...config, enabled: newEnabled }
        }
      });
      
      if (newEnabled) {
        await invoke('start_external_service');
      } else {
        await invoke('stop_external_service');
      }
      
      await checkServiceStatus();
    } catch (error) {
      console.error('Failed to toggle service:', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="external-service-settings">
      {installStatus === 'not_installed' && (
        <div className="install-prompt">
          <div className="install-prompt-content">
            <h3>Scout Transcriber Not Installed</h3>
            <p>The Scout Transcriber service provides advanced transcription capabilities including support for Parakeet and other models.</p>
            <div className="install-command">
              <code>curl -sSf https://scout.arach.dev/transcriber-install.sh | bash</code>
            </div>
            <div className="install-actions">
              <button className="install-button" onClick={handleInstall}>
                View Installer Script
              </button>
              <a 
                href="https://scout.arach.dev/transcriber-readme.txt" 
                target="_blank" 
                rel="noopener noreferrer"
                className="install-link"
              >
                Installation Guide
              </a>
            </div>
          </div>
        </div>
      )}

      {installStatus === 'installed' && (
        <>
          <div className="service-status">
            <div className="status-indicator">
              <span className={`status-dot ${status.running ? (status.healthy ? 'healthy' : 'warning') : 'offline'}`} />
              <span className="status-text">
                {status.running ? (status.healthy ? 'Service Healthy' : 'Service Unhealthy') : 'Service Offline'}
              </span>
            </div>
            {status.error && (
              <div className="status-error">{status.error}</div>
            )}
          </div>

          <div className="setting-group">
            <div className="setting-item">
              <label className="setting-label">
                <input
                  type="checkbox"
                  checked={config.enabled}
                  onChange={handleToggleEnabled}
                  disabled={saving}
                />
                <span>Enable External Service</span>
              </label>
              <p className="setting-description">
                Use Scout Transcriber for enhanced transcription with support for multiple models
              </p>
            </div>
          </div>

          {config.enabled && (
            <>
              <div className="setting-group">
                <h3>Model Selection</h3>
                <div className="setting-item">
                  <label className="setting-label">Transcription Model</label>
                  <select
                    value={config.model}
                    onChange={(e) => setConfig(prev => ({ ...prev, model: e.target.value }))}
                    className="setting-select"
                  >
                    <option value="whisper">Whisper (OpenAI)</option>
                    <option value="wav2vec2">Wav2Vec2 (Facebook)</option>
                    <option value="parakeet">Parakeet (NVIDIA)</option>
                  </select>
                  <p className="setting-description">
                    Choose the AI model for transcription
                  </p>
                </div>
              </div>

              <div className="setting-group">
                <h3>Network Configuration</h3>
                <div className="setting-item">
                  <label className="setting-label">Audio Input Port</label>
                  <input
                    type="number"
                    value={config.zmq_push_port}
                    onChange={(e) => setConfig(prev => ({ ...prev, zmq_push_port: parseInt(e.target.value) || 5555 }))}
                    className="setting-input"
                    min="1024"
                    max="65535"
                  />
                </div>
                
                <div className="setting-item">
                  <label className="setting-label">Transcript Output Port</label>
                  <input
                    type="number"
                    value={config.zmq_pull_port}
                    onChange={(e) => setConfig(prev => ({ ...prev, zmq_pull_port: parseInt(e.target.value) || 5556 }))}
                    className="setting-input"
                    min="1024"
                    max="65535"
                  />
                </div>
                
                <div className="setting-item">
                  <label className="setting-label">Control Port</label>
                  <input
                    type="number"
                    value={config.zmq_control_port}
                    onChange={(e) => setConfig(prev => ({ ...prev, zmq_control_port: parseInt(e.target.value) || 5557 }))}
                    className="setting-input"
                    min="1024"
                    max="65535"
                  />
                </div>
              </div>

              <div className="setting-group">
                <h3>Performance</h3>
                <div className="setting-item">
                  <label className="setting-label">Worker Processes</label>
                  <input
                    type="number"
                    value={config.workers}
                    onChange={(e) => setConfig(prev => ({ ...prev, workers: parseInt(e.target.value) || 2 }))}
                    className="setting-input"
                    min="1"
                    max="8"
                  />
                  <p className="setting-description">
                    Number of parallel transcription workers (1-8)
                  </p>
                </div>
              </div>

              <div className="action-buttons">
                <button
                  className="btn-secondary"
                  onClick={testConnection}
                  disabled={testing || saving}
                >
                  {testing ? 'Testing...' : 'Test Connection'}
                </button>
                <button
                  className="btn-primary"
                  onClick={saveConfig}
                  disabled={saving}
                >
                  {saving ? 'Saving...' : 'Save Configuration'}
                </button>
              </div>
            </>
          )}
        </>
      )}

      {installStatus === 'checking' && (
        <div className="loading-message">Checking installation status...</div>
      )}
    </div>
  );
};
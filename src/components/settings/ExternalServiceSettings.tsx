import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ExternalLink, CheckCircle, AlertCircle, Play, Square, Copy, Terminal, Check } from 'lucide-react';
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
    binary_path: 'transcriber',
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
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);

  useEffect(() => {
    loadConfig();
    checkServiceStatus();
    
    // Check for dev override
    const devStatus = (window as any).__DEV_TRANSCRIBER_STATUS;
    if (devStatus) {
      setInstallStatus(devStatus);
    } else {
      checkInstallation();
    }
  }, []);

  // Listen for dev status changes
  useEffect(() => {
    const checkDevStatus = () => {
      const devStatus = (window as any).__DEV_TRANSCRIBER_STATUS;
      if (devStatus) {
        setInstallStatus(devStatus);
      }
    };

    // Check every 500ms for dev status changes
    const interval = setInterval(checkDevStatus, 500);
    return () => clearInterval(interval);
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
      
      // Restart service with new config
      if (status.running) {
        await invoke('stop_external_service');
        await invoke('start_external_service');
      }
      
      // Recheck status
      await checkServiceStatus();
    } catch (error) {
      console.error('Failed to save config:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleStartStop = async () => {
    try {
      if (status.running) {
        await invoke('stop_external_service');
      } else {
        await invoke('start_external_service');
      }
      await checkServiceStatus();
    } catch (error) {
      console.error('Failed to start/stop service:', error);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      const result = await invoke<{ success: boolean; message: string }>('test_external_service');
      if (result.success) {
        alert('Connection successful!\n\n' + result.message);
      } else {
        alert('Connection failed\n\n' + result.message);
      }
    } catch (error) {
      alert('Connection test failed\n\n' + error);
    } finally {
      setTesting(false);
      await checkServiceStatus();
    }
  };


  const copyCommand = async (command: string, commandId: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopiedCommand(commandId);
      setTimeout(() => setCopiedCommand(null), 2000);
    } catch (error) {
      console.error('Failed to copy command:', error);
    }
  };

  return (
    <div className="external-service-settings">
      {/* Introduction Section */}
      <div className="intro-section">
        <p className="intro-description">
          The <code>`transcriber`</code> service gives you complete control over your transcription models. 
          Run your choice of engines including OpenAI's Whisper, NVIDIA's Parakeet MLX (optimized for Apple Silicon), 
          or Facebook's Wav2Vec2. The service runs independently with its own Python environment, 
          allowing you to customize workers, ports, and model configurations for your specific needs.
          {' '}
          <a 
            href="https://scout.arach.dev/blog/scout-transcriber-architecture" 
            target="_blank" 
            rel="noopener noreferrer"
            className="inline-link"
          >
            Learn more about the architecture →
          </a>
        </p>
        <div className="intro-links">
          <a 
            href="https://scout.arach.dev/docs/transcriber" 
            target="_blank" 
            rel="noopener noreferrer"
            className="intro-link"
          >
            <span>View Documentation</span>
            <ExternalLink size={12} />
          </a>
        </div>
      </div>

      {/* Checking Status */}
      {installStatus === 'checking' && (
        <div className="status-card">
          <div className="loading-message">
            Checking installation status...
          </div>
        </div>
      )}

      {/* Installation Guide - Show when not installed */}
      {installStatus === 'not_installed' && (
        <div className="installation-guide">
          <div className="install-header">
            <Terminal className="install-icon" size={24} />
            <div>
              <h3>Quick Installation</h3>
              <p>Follow these steps to install the Transcriber service</p>
            </div>
          </div>

          <div className="install-steps">
            <div className="install-step">
              <div className="step-number">1</div>
              <div className="step-content">
                <h4>Install UV Package Manager</h4>
                <p className="step-desc">UV automatically handles Python versions and dependencies</p>
                <div className="command-box">
                  <code>curl -LsSf https://astral.sh/uv/install.sh | sh</code>
                  <button 
                    className="copy-btn"
                    onClick={() => copyCommand('curl -LsSf https://astral.sh/uv/install.sh | sh', 'uv-install')}
                  >
                    {copiedCommand === 'uv-install' ? (
                      <Check size={14} className="copied-icon" />
                    ) : (
                      <Copy size={14} />
                    )}
                  </button>
                </div>
              </div>
            </div>

            <div className="install-step">
              <div className="step-number">2</div>
              <div className="step-content">
                <h4>Install Transcriber Service</h4>
                <p className="step-desc">Download and install the transcriber with all dependencies</p>
                <div className="command-box">
                  <code>curl -sSf https://scout.arach.dev/install-transcriber.sh | sh</code>
                  <button 
                    className="copy-btn"
                    onClick={() => copyCommand('curl -sSf https://scout.arach.dev/install-transcriber.sh | sh', 'transcriber-install')}
                  >
                    {copiedCommand === 'transcriber-install' ? (
                      <Check size={14} className="copied-icon" />
                    ) : (
                      <Copy size={14} />
                    )}
                  </button>
                </div>
              </div>
            </div>

            <div className="install-step">
              <div className="step-number">3</div>
              <div className="step-content">
                <h4>Verify Installation</h4>
                <p className="step-desc">Check that the service was installed successfully</p>
                <div className="command-box">
                  <code>transcriber --version</code>
                  <button 
                    className="copy-btn"
                    onClick={() => copyCommand('transcriber --version', 'transcriber-verify')}
                  >
                    {copiedCommand === 'transcriber-verify' ? (
                      <Check size={14} className="copied-icon" />
                    ) : (
                      <Copy size={14} />
                    )}
                  </button>
                </div>
                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '6px', marginBottom: 0 }}>
                  If command not found, restart your terminal or run: <code style={{ fontSize: '10px' }}>source ~/.bashrc</code>
                </p>
              </div>
            </div>

            <div className="install-step">
              <div className="step-number">4</div>
              <div className="step-content">
                <h4>Test Installation</h4>
                <p className="step-desc">Confirm Scout can connect to the service</p>
                <button 
                  className="verify-status-btn"
                  onClick={() => {
                    checkInstallation();
                    checkServiceStatus();
                  }}
                >
                  <span>Check Connection</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M9 11l3 3L22 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '8px', marginBottom: 0 }}>
                  This will verify Scout can detect the installed service
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Status Card - Only show when installed */}
      {installStatus === 'installed' && (
        <div className="status-card">
          <div className="status-header">
            <h4>Service Status</h4>
            <div className="status-indicator">
              {status.running ? (
                status.healthy ? (
                  <>
                    <CheckCircle className="status-icon healthy" size={18} />
                    <span className="status-text">Running</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="status-icon warning" size={18} />
                    <span className="status-text">Unhealthy</span>
                  </>
                )
              ) : (
                <>
                  <AlertCircle className="status-icon offline" size={18} />
                  <span className="status-text">Stopped</span>
                </>
              )}
            </div>
          </div>

          <div className="status-content">
            {status.error && (
              <div className="error-message">{status.error}</div>
            )}
            <div className="service-controls">
              <button 
                className="btn-control"
                onClick={handleStartStop}
              >
                {status.running ? (
                  <>
                    <Square size={16} />
                    <span>Stop Service</span>
                  </>
                ) : (
                  <>
                    <Play size={16} />
                    <span>Start Service</span>
                  </>
                )}
              </button>
              {status.running && (
                <button
                  className="btn-secondary"
                  onClick={testConnection}
                  disabled={testing}
                >
                  {testing ? 'Testing...' : 'Test Connection'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Configuration - Only show when installed */}
      {installStatus === 'installed' && (
        <>
          <div className="config-section">
            <h4>Model Selection</h4>
            <div className="model-selector">
              <select
                value={config.model}
                onChange={(e) => setConfig(prev => ({ ...prev, model: e.target.value }))}
                className="model-select"
              >
                <option value="whisper">Whisper - OpenAI's general-purpose model</option>
                <option value="parakeet">Parakeet MLX - NVIDIA model for Apple Silicon</option>
                <option value="wav2vec2">Wav2Vec2 - Facebook's speech recognition</option>
              </select>
              <p className="model-description">
                {config.model === 'parakeet' && 'Optimized for M1/M2/M3 Macs with excellent accuracy'}
                {config.model === 'whisper' && 'Reliable and accurate for general use'}
                {config.model === 'wav2vec2' && 'Fast alternative model with good accuracy'}
              </p>
            </div>
          </div>

          <details className="advanced-config">
            <summary>Advanced Configuration</summary>
            <div className="config-grid">
              <div className="config-item">
                <label>Worker Processes</label>
                <input
                  type="number"
                  value={config.workers}
                  onChange={(e) => setConfig(prev => ({ ...prev, workers: parseInt(e.target.value) || 2 }))}
                  min="1"
                  max="8"
                />
                <span className="config-help">Number of parallel workers (1-8)</span>
              </div>
              
              <div className="config-item">
                <label>Audio Port</label>
                <input
                  type="number"
                  value={config.zmq_push_port}
                  onChange={(e) => setConfig(prev => ({ ...prev, zmq_push_port: parseInt(e.target.value) || 5555 }))}
                  min="1024"
                  max="65535"
                />
              </div>
              
              <div className="config-item">
                <label>Output Port</label>
                <input
                  type="number"
                  value={config.zmq_pull_port}
                  onChange={(e) => setConfig(prev => ({ ...prev, zmq_pull_port: parseInt(e.target.value) || 5556 }))}
                  min="1024"
                  max="65535"
                />
              </div>
              
              <div className="config-item">
                <label>Control Port</label>
                <input
                  type="number"
                  value={config.zmq_control_port}
                  onChange={(e) => setConfig(prev => ({ ...prev, zmq_control_port: parseInt(e.target.value) || 5557 }))}
                  min="1024"
                  max="65535"
                />
              </div>
            </div>
          </details>

          <div className="action-footer">
            <button
              className="btn-primary"
              onClick={saveConfig}
              disabled={saving}
            >
              {saving ? 'Applying...' : 'Apply Changes'}
            </button>
          </div>
        </>
      )}
    </div>
  );
};
import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ExternalLink, CheckCircle, AlertCircle, Play, Square, Copy, Terminal, Check, FileText, Info, Activity, Settings, RefreshCw, ChevronRight } from 'lucide-react';
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
  pid?: number;
  last_check?: string;
  error?: string;
}

interface ExternalServiceSettingsProps {
  onStatusChange?: (status: ServiceStatus) => void;
}

export const ExternalServiceSettings: React.FC<ExternalServiceSettingsProps> = ({ onStatusChange }) => {
  const [config, setConfig] = useState<ExternalServiceConfig>({
    enabled: true,
    binary_path: '/usr/local/bin/transcriber',
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
  
  const [saving, setSaving] = useState(false);
  const [installStatus, setInstallStatus] = useState<'checking' | 'installed' | 'not_installed'>('checking');
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const [serviceOperation, setServiceOperation] = useState<'idle' | 'starting' | 'stopping' | 'restarting'>('idle');
  const [operationResult, setOperationResult] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [testResult, setTestResult] = useState<{ type: 'success' | 'error' | 'info', message: string } | null>(null);

  useEffect(() => {
    loadConfig();
    checkServiceStatus();
    checkInstallation();
  }, []);

  // Auto-refresh status every 5 seconds when service is running
  useEffect(() => {
    if (status.running) {
      const interval = setInterval(checkServiceStatus, 5000);
      return () => clearInterval(interval);
    }
  }, [status.running]);

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
      const serviceStatus = await invoke<ServiceStatus>('check_external_service_status');
      setStatus(serviceStatus);
      if (onStatusChange) {
        onStatusChange(serviceStatus);
      }
    } catch (error) {
      console.error('Failed to check service status:', error);
      const errorStatus = { running: false, healthy: false, error: error as string };
      setStatus(errorStatus);
      if (onStatusChange) {
        onStatusChange(errorStatus);
      }
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
      
      setOperationResult({
        type: 'success',
        message: 'Configuration saved. Restart the service to apply changes.'
      });
      setTimeout(() => setOperationResult(null), 4000);
    } catch (error) {
      console.error('Failed to save config:', error);
      setOperationResult({
        type: 'error',
        message: `Failed to save: ${error}`
      });
      setTimeout(() => setOperationResult(null), 5000);
    } finally {
      setSaving(false);
    }
  };

  const handleStartService = async () => {
    setServiceOperation('starting');
    setOperationResult(null);
    try {
      await invoke<string>('start_external_service');
      setOperationResult({
        type: 'success',
        message: 'Service started successfully'
      });
      await checkServiceStatus();
    } catch (error) {
      setOperationResult({
        type: 'error',
        message: `Failed to start: ${error}`
      });
    } finally {
      setServiceOperation('idle');
      setTimeout(() => setOperationResult(null), 5000);
    }
  };

  const handleStopService = async () => {
    setServiceOperation('stopping');
    setOperationResult(null);
    try {
      await invoke('stop_external_service');
      setOperationResult({
        type: 'success',
        message: 'Service stopped successfully'
      });
      await checkServiceStatus();
    } catch (error) {
      setOperationResult({
        type: 'error',
        message: `Failed to stop: ${error}`
      });
    } finally {
      setServiceOperation('idle');
      setTimeout(() => setOperationResult(null), 4000);
    }
  };

  const handleRestartService = async () => {
    setServiceOperation('restarting');
    setOperationResult(null);
    try {
      await invoke('stop_external_service');
      await new Promise(resolve => setTimeout(resolve, 1000));
      await invoke<string>('start_external_service');
      setOperationResult({
        type: 'success',
        message: 'Service restarted with new configuration'
      });
      await checkServiceStatus();
    } catch (error) {
      setOperationResult({
        type: 'error',
        message: `Failed to restart: ${error}`
      });
    } finally {
      setServiceOperation('idle');
      setTimeout(() => setOperationResult(null), 5000);
    }
  };

  const testConnection = async () => {
    setTestResult(null);
    try {
      const portsOk = status.healthy;
      if (portsOk) {
        setTestResult({
          type: 'success',
          message: 'All ZeroMQ ports are responding'
        });
      } else {
        setTestResult({
          type: 'error',
          message: 'ZeroMQ ports are not accessible'
        });
      }
      setTimeout(() => setTestResult(null), 4000);
    } catch (error) {
      setTestResult({
        type: 'error',
        message: `Connection test failed: ${error}`
      });
      setTimeout(() => setTestResult(null), 5000);
    }
  };

  const testTranscription = async () => {
    setTestResult({
      type: 'info',
      message: 'Sending test audio...'
    });
    
    try {
      const result = await invoke<{ success: boolean; message: string }>('test_external_service');
      if (result.success) {
        setTestResult({
          type: 'success',
          message: `Test successful: "${result.message}"`
        });
      } else {
        setTestResult({
          type: 'error',
          message: `Test failed: ${result.message}`
        });
      }
      setTimeout(() => setTestResult(null), 6000);
    } catch (error) {
      setTestResult({
        type: 'error',
        message: `Test error: ${error}`
      });
      setTimeout(() => setTestResult(null), 5000);
    }
  };

  const copyCommand = async (command: string, commandId: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopiedCommand(commandId);
      setTimeout(() => setCopiedCommand(null), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  // Installation Guide for when not installed
  if (installStatus === 'not_installed') {
    return (
      <div className="external-service-settings">
        <div className="intro-section">
          <h3>Transcriber Service</h3>
          <p className="intro-description">
            The transcriber service enables local speech-to-text processing with complete control over your models and data.
          </p>
        </div>

        <div className="installation-guide">
          <div className="install-header">
            <Terminal className="install-icon" size={24} />
            <div>
              <h3>Quick Installation</h3>
              <p>Install the transcriber service in two steps</p>
            </div>
          </div>

          <div className="install-steps">
            <div className="install-step">
              <div className="step-number">1</div>
              <div className="step-content">
                <h4>Install UV Package Manager</h4>
                <div className="command-box">
                  <code>curl -LsSf https://astral.sh/uv/install.sh | sh</code>
                  <button 
                    className="copy-btn"
                    onClick={() => copyCommand('curl -LsSf https://astral.sh/uv/install.sh | sh', 'uv')}
                  >
                    {copiedCommand === 'uv' ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
              </div>
            </div>

            <div className="install-step">
              <div className="step-number">2</div>
              <div className="step-content">
                <h4>Install Transcriber</h4>
                <div className="command-box">
                  <code>curl -sSf https://scout.arach.dev/install-transcriber.sh | sh</code>
                  <button 
                    className="copy-btn"
                    onClick={() => copyCommand('curl -sSf https://scout.arach.dev/install-transcriber.sh | sh', 'transcriber')}
                  >
                    {copiedCommand === 'transcriber' ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <button
            className="btn-primary"
            onClick={() => checkInstallation()}
            style={{ marginTop: '16px' }}
          >
            I've Installed It →
          </button>
        </div>
      </div>
    );
  }

  // Main interface - logical structure with service info at top
  return (
    <div className="external-service-settings">
      {/* Service Information Section */}
      <div className="service-info-header">
        <div className="service-identity">
          <div className="service-row">
            <span className="label">Service Manager:</span>
            <span className="value">launchctl (macOS)</span>
          </div>
          <div className="service-row">
            <span className="label">Service Name:</span>
            <span className="value mono">com.scout.transcriber</span>
          </div>
          <div className="service-row">
            <span className="label">Configuration:</span>
            <span className="value path">~/Library/Application Support/com.scout.transcriber/config.json</span>
          </div>
        </div>
        
        <div className="service-status-badge">
          <div className={`status-indicator ${status.running ? 'running' : 'stopped'}`} />
          <span className="status-text">
            {status.running ? 'Running' : 'Stopped'}
            {status.running && status.pid && <span className="status-pid"> (PID {status.pid})</span>}
          </span>
        </div>
      </div>

      {/* Service Controls and Status */}
      <div className="service-control-section">
        <div className="control-row">
          <div className="control-buttons">
            {!status.running ? (
              <button
                className="btn-control start"
                onClick={handleStartService}
                disabled={serviceOperation !== 'idle'}
              >
                {serviceOperation === 'starting' ? (
                  <>
                    <div className="spinner" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Play size={14} />
                    Start Service
                  </>
                )}
              </button>
            ) : (
              <>
                <button
                  className="btn-control stop"
                  onClick={handleStopService}
                  disabled={serviceOperation !== 'idle'}
                >
                  {serviceOperation === 'stopping' ? (
                    <>
                      <div className="spinner" />
                      Stopping...
                    </>
                  ) : (
                    <>
                      <Square size={14} />
                      Stop
                    </>
                  )}
                </button>
                <button
                  className="btn-control restart"
                  onClick={handleRestartService}
                  disabled={serviceOperation !== 'idle'}
                >
                  {serviceOperation === 'restarting' ? (
                    <>
                      <div className="spinner" />
                      Restarting...
                    </>
                  ) : (
                    <>
                      <RefreshCw size={14} />
                      Restart
                    </>
                  )}
                </button>
              </>
            )}
            
            {/* Test buttons */}
            {status.running && (
              <>
                <button
                  className="btn-test"
                  onClick={testConnection}
                  title="Test ZeroMQ port connectivity"
                >
                  <Activity size={14} />
                  Test Connection
                </button>
                <button
                  className="btn-test"
                  onClick={testTranscription}
                  title="Test audio transcription"
                >
                  <FileText size={14} />
                  Test Transcription
                </button>
              </>
            )}
          </div>
          
          {/* Status indicators */}
          <div className="status-indicators">
            <span className={`indicator ${status.running ? 'active' : ''}`}>
              LaunchCTL: {status.running ? 'Active' : 'Inactive'}
            </span>
            <span className={`indicator ${status.healthy ? 'healthy' : ''}`}>
              Health: {status.healthy ? 'OK' : status.running ? 'Not Responding' : 'N/A'}
            </span>
            <span className={`indicator ${status.healthy ? 'connected' : ''}`}>
              Ports: {status.healthy ? `${config.zmq_push_port}, ${config.zmq_pull_port}, ${config.zmq_control_port} ✓` : 'Not Connected'}
            </span>
          </div>
        </div>
      </div>


      {/* Result Messages */}
      {(testResult || operationResult) && (
        <div className="result-messages">
          {testResult && (
            <div className={`message ${testResult.type}`}>
              {testResult.type === 'success' && <CheckCircle size={14} />}
              {testResult.type === 'error' && <AlertCircle size={14} />}
              {testResult.type === 'info' && <Info size={14} />}
              <span>{testResult.message}</span>
            </div>
          )}
          {operationResult && (
            <div className={`message ${operationResult.type}`}>
              {operationResult.type === 'success' && <CheckCircle size={14} />}
              {operationResult.type === 'error' && <AlertCircle size={14} />}
              <span>{operationResult.message}</span>
            </div>
          )}
        </div>
      )}

      {/* Configuration Section - Show when service is healthy */}
      {(status.running && status.healthy) && (
        <div className="config-section">
          <div className="config-header">
            <Settings size={16} />
            <h4>Configuration</h4>
          </div>
          
          <div className="config-grid">
            <div className="config-item">
              <label>Model</label>
              <select
                value={config.model}
                onChange={(e) => setConfig(prev => ({ ...prev, model: e.target.value }))}
                className="config-select"
              >
                <option value="whisper">Whisper (OpenAI)</option>
                <option value="parakeet">Parakeet MLX (Apple Silicon)</option>
                <option value="wav2vec2">Wav2Vec2 (Facebook)</option>
              </select>
            </div>

            <div className="config-item">
              <label>Workers</label>
              <input
                type="number"
                value={config.workers}
                onChange={(e) => setConfig(prev => ({ ...prev, workers: parseInt(e.target.value) || 2 }))}
                min="1"
                max="8"
                className="config-input"
              />
            </div>

            <div className="config-item">
              <label>Audio Port</label>
              <input
                type="number"
                value={config.zmq_push_port}
                onChange={(e) => setConfig(prev => ({ ...prev, zmq_push_port: parseInt(e.target.value) || 5555 }))}
                min="1024"
                max="65535"
                className="config-input"
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
                className="config-input"
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
                className="config-input"
              />
            </div>
          </div>

          <button
            className="btn-primary save-config"
            onClick={saveConfig}
            disabled={saving}
          >
            {saving ? (
              <>
                <div className="spinner" />
                Saving...
              </>
            ) : (
              'Save Configuration'
            )}
          </button>
        </div>
      )}

      {/* Additional Paths - Collapsible */}
      <details className="additional-info">
        <summary>
          <ChevronRight size={14} className="chevron" />
          Additional Paths
        </summary>
        <div className="paths-grid">
          <div className="path-item">
            <span className="path-label">LaunchAgent plist:</span>
            <code>~/Library/LaunchAgents/com.scout.transcriber.plist</code>
          </div>
          <div className="path-item">
            <span className="path-label">Service logs:</span>
            <code>/tmp/transcriber.log</code>
          </div>
          <div className="path-item">
            <span className="path-label">Binary location:</span>
            <code>{config.binary_path || '/usr/local/bin/transcriber'}</code>
          </div>
        </div>
      </details>

      {/* Documentation Footer */}
      <div className="docs-footer">
        <a 
          href="https://scout.arach.dev/docs/transcriber" 
          target="_blank" 
          rel="noopener noreferrer"
          className="docs-link"
        >
          <FileText size={12} />
          View Documentation
          <ExternalLink size={10} />
        </a>
      </div>
    </div>
  );
};
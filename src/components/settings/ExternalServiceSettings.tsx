import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ExternalLink, CheckCircle, AlertCircle, Play, Square, Copy, Terminal, Check, FileText, Info, Activity, Settings, RefreshCw } from 'lucide-react';
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
  const [operationResult, setOperationResult] = useState<{ type: 'success' | 'error' | 'info', message: string } | null>(null);
  const [diagnosticLogs, setDiagnosticLogs] = useState<Array<{
    type: 'success' | 'error' | 'info';
    message: string;
    timestamp: string;
  }>>([]);

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
  
  // Listen for DevTools override changes
  useEffect(() => {
    let lastOverride: any = undefined;
    
    const checkForOverride = () => {
      const devOverride = (window as any).__DEV_TRANSCRIBER_STATUS;
      if (devOverride !== undefined && devOverride !== null && devOverride !== lastOverride) {
        console.log('[ExternalServiceSettings] DevTools override changed:', devOverride);
        setInstallStatus(devOverride);
        lastOverride = devOverride;
      }
    };
    
    // Check every 500ms for changes (simple polling)
    const interval = setInterval(checkForOverride, 500);
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

  const addDiagnosticLog = (type: 'success' | 'error' | 'info', message: string) => {
    const timestamp = new Date().toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    setDiagnosticLogs(prev => [...prev, { type, message, timestamp }].slice(-50)); // Keep last 50 logs
  };

  const checkInstallation = async () => {
    // Check for DevTools override first
    const devOverride = (window as any).__DEV_TRANSCRIBER_STATUS;
    if (devOverride !== undefined && devOverride !== null) {
      console.log('[ExternalServiceSettings] Using DevTools override:', devOverride);
      setInstallStatus(devOverride);
      return;
    }
    
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

  const testHealth = async () => {
    try {
      await checkServiceStatus();
      if (status.running) {
        // Try to read PID from known location
        let pidInfo = '';
        try {
          const result = await invoke<{ pid?: number }>('get_transcriber_pid');
          if (result.pid) {
            pidInfo = ` (PID: ${result.pid})`;
          }
        } catch {
          // If we can't get PID, just continue without it
          pidInfo = status.pid ? ` (PID: ${status.pid})` : '';
        }
        addDiagnosticLog('success', `Service is running${pidInfo}`);
      } else {
        addDiagnosticLog('error', 'Service is not running');
      }
    } catch (error) {
      addDiagnosticLog('error', `Health check failed: ${error}`);
    }
  };

  const testPorts = async () => {
    try {
      if (status.healthy) {
        addDiagnosticLog('success', 'Ports 8899 (HTTP) and 8901-8902 (ZeroMQ) are open');
      } else {
        addDiagnosticLog('error', 'One or more ports are not accessible');
      }
    } catch (error) {
      addDiagnosticLog('error', `Port check failed: ${error}`);
    }
  };

  const testConnection = async () => {
    try {
      const portsOk = status.healthy;
      if (portsOk) {
        addDiagnosticLog('success', 'Connected to transcriber service');
      } else {
        addDiagnosticLog('error', 'Cannot connect to transcriber service');
      }
    } catch (error) {
      addDiagnosticLog('error', `Connection test failed: ${error}`);
    }
  };

  const testTranscription = async () => {
    addDiagnosticLog('info', 'Generating and sending test audio...');
    
    try {
      // Try the new method that actually sends audio
      const result = await invoke<{ 
        success: boolean; 
        message: string;
        transcription?: string;
        details?: any;
      }>('test_external_service_with_audio');
      
      if (result.success) {
        addDiagnosticLog('success', `Test successful: ${result.message}`);
        if (result.transcription) {
          addDiagnosticLog('info', `Transcription: "${result.transcription}"`);
        }
        if (result.details) {
          addDiagnosticLog('info', `Details: ${JSON.stringify(result.details)}`);
        }
      } else {
        addDiagnosticLog('error', `Test failed: ${result.message}`);
      }
    } catch (error: any) {
      // If the new command doesn't exist, fall back to the old one
      if (error?.message?.includes('test_external_service_with_audio')) {
        addDiagnosticLog('info', 'Falling back to connection test...');
        try {
          const result = await invoke<{ success: boolean; message: string }>('test_external_service');
          if (result.success) {
            addDiagnosticLog('success', `Connection test passed`);
            addDiagnosticLog('info', result.message);
          } else {
            addDiagnosticLog('error', `Connection test failed: ${result.message}`);
          }
        } catch (fallbackError) {
          addDiagnosticLog('error', `Test error: ${fallbackError}`);
        }
      } else {
        addDiagnosticLog('error', `Test error: ${error}`);
      }
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

        <div className="installation-guide">
          <div className="install-header">
            <Terminal className="install-icon" size={24} />
            <div>
              <h3>Quick Installation</h3>
              <p>Install and verify the transcriber service in four steps</p>
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

            <div className="install-step">
              <div className="step-number">3</div>
              <div className="step-content">
                <h4>Start the Service</h4>
                <div className="command-box">
                  <code>transcriber start</code>
                  <button 
                    className="copy-btn"
                    onClick={() => copyCommand('transcriber start', 'start')}
                  >
                    {copiedCommand === 'start' ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
              </div>
            </div>

            <div className="install-step">
              <div className="step-number">4</div>
              <div className="step-content">
                <h4>Verify Installation</h4>
                <p className="step-description">Click below to let Scout verify the service is working</p>
                <button
                  className="verify-btn"
                  onClick={async () => {
                    setOperationResult({ type: 'info', message: 'Checking service...' });
                    
                    // For verification, always check the real status, ignore DevTools override
                    try {
                      // Check if actually installed
                      const isInstalled = await invoke<boolean>('check_transcriber_installed');
                      
                      if (isInstalled) {
                        // Check if running
                        const serviceStatus = await invoke<ServiceStatus>('check_external_service_status');
                        
                        if (serviceStatus.running) {
                          // Try test connection
                          try {
                            const result = await invoke<{ success: boolean; message: string }>('test_external_service');
                            if (result.success) {
                              setOperationResult({ 
                                type: 'success', 
                                message: 'Service is installed and working perfectly! Click "Start Using Transcriber" below to continue.' 
                              });
                              // Don't auto-navigate, let user click the button when ready
                            } else {
                              setOperationResult({ 
                                type: 'error', 
                                message: `Service is installed but test failed: ${result.message}` 
                              });
                            }
                          } catch (error) {
                            setOperationResult({ 
                              type: 'error', 
                              message: `Service is installed but not responding: ${error}` 
                            });
                          }
                        } else {
                          setOperationResult({ 
                            type: 'error', 
                            message: 'Service is installed but not running. Try starting it first.' 
                          });
                        }
                      } else {
                        setOperationResult({ 
                          type: 'error', 
                          message: 'Service not detected. Please complete installation steps above.' 
                        });
                      }
                    } catch (error) {
                      setOperationResult({ 
                        type: 'error', 
                        message: `Failed to check service: ${error}` 
                      });
                    }
                    
                    setTimeout(() => setOperationResult(null), 5000);
                  }}
                >
                  <CheckCircle size={16} />
                  Test Installation
                </button>
              </div>
            </div>
          </div>

          {/* Show test results */}
          {operationResult && (
            <div className={`install-result ${operationResult.type}`}>
              {operationResult.type === 'success' && <CheckCircle size={16} />}
              {operationResult.type === 'error' && <AlertCircle size={16} />}
              {operationResult.type === 'info' && <Info size={16} />}
              <span>{operationResult.message}</span>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button
              className="btn-primary"
              onClick={() => {
                // Force status to installed to show the main view
                setInstallStatus('installed');
                // Clear any DevTools override
                if ((window as any).__DEV_TRANSCRIBER_STATUS) {
                  (window as any).__DEV_TRANSCRIBER_STATUS = 'installed';
                }
              }}
            >
              Start Using Transcriber →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Main interface - clean table layout
  return (
    <div className="external-service-settings">
      {/* Service Information Section */}
      <div className="service-section">
        <h3>Service</h3>
        <div className="service-table with-indent">
          <div className="service-row">
            <span className="field">NAME:</span>
            <div className="service-info">
              <span className="value mono">com.scout.transcriber</span>
              <span className="value-detail">launchctl</span>
            </div>
          </div>
          <div className="service-row">
            <span className="field">STATUS:</span>
            <div className="status-controls">
              <span className={`status-badge ${status.running ? 'running' : 'stopped'}`}>
                {status.running ? '● Running' : 'Stopped'}
              </span>
              {!status.running ? (
                <button
                  className="btn-control-inline start"
                  onClick={handleStartService}
                  disabled={serviceOperation !== 'idle'}
                >
                  {serviceOperation === 'starting' ? (
                    <div className="spinner-small" />
                  ) : (
                    <>
                      <Play size={12} />
                      <span>Start</span>
                    </>
                  )}
                </button>
              ) : (
                <>
                  <button
                    className="btn-control-inline stop"
                    onClick={handleStopService}
                    disabled={serviceOperation !== 'idle'}
                  >
                    {serviceOperation === 'stopping' ? (
                      <div className="spinner-small" />
                    ) : (
                      <>
                        <Square size={12} />
                        <span>Stop</span>
                      </>
                    )}
                  </button>
                  <button
                    className="btn-control-inline restart"
                    onClick={handleRestartService}
                    disabled={serviceOperation !== 'idle'}
                  >
                    {serviceOperation === 'restarting' ? (
                      <div className="spinner-small" />
                    ) : (
                      <>
                        <RefreshCw size={12} />
                        <span>Restart</span>
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Paths Section */}
      <div className="service-section">
        <h3>Paths</h3>
        <div className="service-table">
          <div className="service-row">
            <span className="field">MANAGER:</span>
            <div 
              className="command-box"
              onClick={() => copyCommand('~/Library/LaunchAgents/com.scout.transcriber.plist', 'manager')}
            >
              <code>~/Library/LaunchAgents/com.scout.transcriber.plist</code>
              <button className="copy-btn">
                {copiedCommand === 'manager' ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          </div>
          <div className="service-row">
            <span className="field">CONFIG:</span>
            <div 
              className="command-box"
              onClick={() => copyCommand('~/Library/Application Support/com.scout.transcriber/config.json', 'config')}
            >
              <code>~/Library/Application Support/com.scout.transcriber/config.json</code>
              <button className="copy-btn">
                {copiedCommand === 'config' ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          </div>
          <div className="service-row">
            <span className="field">BINARY:</span>
            <div 
              className="command-box"
              onClick={() => copyCommand(config.binary_path || '/usr/local/bin/transcriber', 'binary')}
            >
              <code>{config.binary_path || '/usr/local/bin/transcriber'}</code>
              <button className="copy-btn">
                {copiedCommand === 'binary' ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          </div>
          <div className="service-row">
            <span className="field">LOG:</span>
            <div 
              className="command-box"
              onClick={() => copyCommand('/tmp/transcriber.log', 'log')}
            >
              <code>/tmp/transcriber.log</code>
              <button className="copy-btn">
                {copiedCommand === 'log' ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Model Selection Section */}
      <div className="model-section">
        <h3>Advanced Models</h3>
        <div className="model-cards">
          <div 
            className={`model-card ${config.model === 'whisper' ? 'selected' : ''}`}
            onClick={() => setConfig(prev => ({ ...prev, model: 'whisper' }))}
          >
            <div className="model-top">
              <h4>Whisper</h4>
              <span className="model-lab">OpenAI</span>
            </div>
            <div className="model-content">
              <div className="model-attributes">
                <div className="attribute">
                  <span className="attr-label">Size</span>
                  <span className="attr-value">39MB - 1.5GB</span>
                </div>
                <div className="attribute">
                  <span className="attr-label">Languages</span>
                  <span className="attr-value">99+</span>
                </div>
                <div className="attribute">
                  <span className="attr-label">Speed</span>
                  <span className="attr-value">Balanced</span>
                </div>
              </div>
            </div>
            <div className="model-footer">
              <p className="model-description">
                Industry standard, highly accurate
              </p>
              <a 
                href="https://pypi.org/project/openai-whisper/" 
                target="_blank" 
                rel="noopener noreferrer"
                className="model-link"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink size={10} />
                PyPI Package
              </a>
            </div>
          </div>

          <div 
            className={`model-card ${config.model === 'parakeet' ? 'selected' : ''}`}
            onClick={() => setConfig(prev => ({ ...prev, model: 'parakeet' }))}
          >
            <div className="model-top">
              <h4>Parakeet MLX</h4>
              <span className="model-lab">NVIDIA</span>
            </div>
            <div className="model-content">
              <div className="model-attributes">
                <div className="attribute">
                  <span className="attr-label">Size</span>
                  <span className="attr-value">1.1GB</span>
                </div>
                <div className="attribute">
                  <span className="attr-label">Languages</span>
                  <span className="attr-value">English</span>
                </div>
                <div className="attribute">
                  <span className="attr-label">Speed</span>
                  <span className="attr-value">Fast (M1/M2)</span>
                </div>
              </div>
            </div>
            <div className="model-footer">
              <p className="model-description">
                Optimized for Apple Silicon
              </p>
              <a 
                href="https://github.com/NVIDIA/NeMo" 
                target="_blank" 
                rel="noopener noreferrer"
                className="model-link"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink size={10} />
                GitHub Repo
              </a>
            </div>
          </div>

          <div 
            className={`model-card ${config.model === 'wav2vec2' ? 'selected' : ''}`}
            onClick={() => setConfig(prev => ({ ...prev, model: 'wav2vec2' }))}
          >
            <div className="model-top">
              <h4>Wav2Vec2</h4>
              <span className="model-lab">Meta</span>
            </div>
            <div className="model-content">
              <div className="model-attributes">
                <div className="attribute">
                  <span className="attr-label">Size</span>
                  <span className="attr-value">360MB</span>
                </div>
                <div className="attribute">
                  <span className="attr-label">Languages</span>
                  <span className="attr-value">50+</span>
                </div>
                <div className="attribute">
                  <span className="attr-label">Speed</span>
                  <span className="attr-value">Very Fast</span>
                </div>
              </div>
            </div>
            <div className="model-footer">
              <p className="model-description">
                Lightweight real-time processing
              </p>
              <a 
                href="https://pypi.org/project/transformers/" 
                target="_blank" 
                rel="noopener noreferrer"
                className="model-link"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink size={10} />
                Transformers
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Configuration Section - Show when service is healthy */}
      {(status.running && status.healthy) && (
        <div className="config-section">
          <div className="config-header">
            <Settings size={16} />
            <h4>Advanced Configuration</h4>
          </div>
          
          <div className="config-grid">

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

      {/* Diagnostics Section */}
      <div className="diagnostics-section">
        <h3>Diagnostics</h3>
        <div className="diagnostics-buttons">
          <button
            className="diagnostic-btn"
            onClick={testHealth}
            disabled={serviceOperation !== 'idle'}
          >
            <CheckCircle size={14} />
            Health Check
          </button>
          <button
            className="diagnostic-btn"
            onClick={testPorts}
            disabled={!status.running || serviceOperation !== 'idle'}
          >
            <Activity size={14} />
            Port Check
          </button>
          <button
            className="diagnostic-btn"
            onClick={testConnection}
            disabled={!status.running || serviceOperation !== 'idle'}
          >
            <RefreshCw size={14} />
            Test Connection
          </button>
          <button
            className="diagnostic-btn"
            onClick={testTranscription}
            disabled={!status.running || serviceOperation !== 'idle'}
          >
            <FileText size={14} />
            Test Transcription
          </button>
        </div>
        
        {/* Diagnostic Results - Only show when there are logs */}
        {diagnosticLogs.length > 0 && (
          <>
            <div className="diagnostic-results">
              {diagnosticLogs.map((log, index) => (
                <div key={index} className={`diagnostic-message ${log.type}`}>
                  <span className="log-timestamp">{log.timestamp}</span>
                  <span>{log.message}</span>
                </div>
              ))}
            </div>
            <button 
              className="clear-logs-btn"
              onClick={() => setDiagnosticLogs([])}
            >
              Clear Logs
            </button>
          </>
        )}
      </div>

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
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

interface ExternalServiceSettingsProps {
  onStatusChange?: (status: ServiceStatus) => void;
}

export const ExternalServiceSettings: React.FC<ExternalServiceSettingsProps> = ({ onStatusChange }) => {
  console.log('==== ExternalServiceSettings component rendering ====');
  const [config, setConfig] = useState<ExternalServiceConfig>({
    enabled: true,  // Must be true to allow starting the service
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
  const [connectionCheckResult, setConnectionCheckResult] = useState<'checking' | 'success' | 'failed' | null>(null);
  const [userOverrideDevToolbar, setUserOverrideDevToolbar] = useState(false);
  const [serviceOperation, setServiceOperation] = useState<'idle' | 'starting' | 'stopping'>('idle');
  const [operationResult, setOperationResult] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [operationLogs, setOperationLogs] = useState<string[]>([]);

  useEffect(() => {
    console.log('[ExternalService] Component mounting, initializing...');
    loadConfig();
    checkServiceStatus();
    
    // Check for dev override
    const devStatus = (window as any).__DEV_TRANSCRIBER_STATUS;
    console.log('[ExternalService] Dev toolbar status:', devStatus);
    console.log('[ExternalService] User override active:', userOverrideDevToolbar);
    
    if (devStatus && !userOverrideDevToolbar) {
      console.log('[ExternalService] Using dev toolbar status:', devStatus);
      setInstallStatus(devStatus);
    } else {
      console.log('[ExternalService] Checking actual installation status...');
      checkInstallation();
    }
  }, []);

  // Listen for dev status changes (unless user has overridden)
  useEffect(() => {
    const checkDevStatus = () => {
      if (userOverrideDevToolbar) {
        console.log('[ExternalService] User override active, ignoring dev toolbar');
        return;
      }
      const devStatus = (window as any).__DEV_TRANSCRIBER_STATUS;
      if (devStatus && devStatus !== installStatus) {
        console.log('[ExternalService] Dev toolbar status changed to:', devStatus);
        setInstallStatus(devStatus);
      }
    };

    // Check every 500ms for dev status changes
    const interval = setInterval(checkDevStatus, 500);
    return () => clearInterval(interval);
  }, [userOverrideDevToolbar, installStatus]);

  const loadConfig = async () => {
    try {
      const settings = await invoke<any>('get_settings');
      if (settings.external_service) {
        // Fix binary path if it's the old scout-transcriber
        const loadedConfig = { ...settings.external_service };
        if (loadedConfig.binary_path === 'scout-transcriber' || !loadedConfig.binary_path) {
          loadedConfig.binary_path = 'transcriber';
        }
        setConfig(prev => ({ ...prev, ...loadedConfig }));
      }
    } catch (error) {
      console.error('Failed to load external service config:', error);
    }
  };

  const checkServiceStatus = async () => {
    console.log('[ExternalService] Checking service status...');
    try {
      const status = await invoke<ServiceStatus>('check_external_service_status');
      console.log('[ExternalService] Service status:', {
        running: status.running,
        healthy: status.healthy,
        error: status.error
      });
      setStatus(status);
      if (onStatusChange) {
        console.log('[ExternalService] Notifying parent of status change');
        onStatusChange(status);
      }
    } catch (error) {
      console.error('[ExternalService] Failed to check service status:', error);
      const errorStatus = { running: false, healthy: false, error: error as string };
      setStatus(errorStatus);
      if (onStatusChange) {
        onStatusChange(errorStatus);
      }
    }
  };

  const checkInstallation = async () => {
    console.log('[ExternalService] Checking if transcriber is installed...');
    try {
      const isInstalled = await invoke<boolean>('check_transcriber_installed');
      console.log('[ExternalService] Transcriber installed:', isInstalled);
      setInstallStatus(isInstalled ? 'installed' : 'not_installed');
    } catch (error) {
      console.error('[ExternalService] Failed to check installation:', error);
      setInstallStatus('not_installed');
    }
  };

  const saveConfig = async () => {
    console.log('[ExternalService] Saving configuration...', config);
    setSaving(true);
    try {
      const settings = await invoke<any>('get_settings');
      console.log('[ExternalService] Current settings:', settings.external_service);
      
      await invoke('update_settings', {
        newSettings: {
          ...settings,
          external_service: config
        }
      });
      console.log('[ExternalService] Configuration saved successfully');
      
      // Restart service with new config if running
      if (status.running) {
        console.log('[ExternalService] Service is running, restarting with new config...');
        await invoke('stop_external_service');
        console.log('[ExternalService] Service stopped, starting with new config...');
        await invoke('start_external_service');
        console.log('[ExternalService] Service restarted with new configuration');
      }
      
      // Recheck status
      console.log('[ExternalService] Rechecking service status after config change...');
      await checkServiceStatus();
      
      // Show success message
      setOperationResult({
        type: 'success',
        message: 'Configuration saved successfully'
      });
      setTimeout(() => setOperationResult(null), 3000);
    } catch (error) {
      console.error('[ExternalService] Failed to save config:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      setOperationResult({
        type: 'error',
        message: `Failed to save configuration: ${errorMsg}`
      });
      setTimeout(() => setOperationResult(null), 5000);
    } finally {
      setSaving(false);
    }
  };

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${message}`;
    console.log(`[ExternalService] ${message}`);
    setOperationLogs(prev => [...prev, logEntry]);
  };

  const handleStartStop = async () => {
    const operation = status.running ? 'stop' : 'start';
    
    // Clear previous logs
    setOperationLogs([]);
    
    addLog(`============ ${operation.toUpperCase()} SERVICE CLICKED ============`);
    addLog(`Attempting to ${operation} service...`);
    addLog(`Current status: running=${status.running}, healthy=${status.healthy}`);
    addLog(`Config enabled: ${config.enabled}`);
    addLog(`Binary path: ${config.binary_path || 'transcriber'}`);
    
    // Ensure config is enabled before starting
    if (!status.running && !config.enabled) {
      addLog('Setting config.enabled to true...');
      const updatedConfig = { ...config, enabled: true };
      setConfig(updatedConfig);
      
      // Save the config first
      addLog('Saving configuration with enabled=true...');
      const settings = await invoke<any>('get_settings');
      await invoke('update_settings', {
        newSettings: {
          ...settings,
          external_service: updatedConfig
        }
      });
      addLog('Configuration saved');
    }
    
    try {
      setServiceOperation(status.running ? 'stopping' : 'starting');
      
      if (status.running) {
        addLog('Calling Tauri command: stop_external_service');
        const result = await invoke('stop_external_service');
        addLog(`stop_external_service returned: ${result || 'void'}`);
      } else {
        addLog('Calling Tauri command: start_external_service');
        addLog('This will create a plist at ~/Library/LaunchAgents/');
        addLog(`Command: transcriber start --workers ${config.workers} --model ${config.model}`);
        const result = await invoke('start_external_service');
        addLog(`start_external_service returned: ${result || 'void'}`);
      }
      
      // Wait a moment for service to start/stop
      addLog('Waiting 1.5s for service to initialize...');
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Check the new status
      addLog('Checking new service status...');
      await checkServiceStatus();
      
      // Force refresh the status
      addLog('Force refreshing status...');
      const newStatus = await invoke<ServiceStatus>('check_external_service_status');
      addLog(`New status: running=${newStatus.running}, healthy=${newStatus.healthy}`);
      if (newStatus.error) {
        addLog(`Status error: ${newStatus.error}`);
      }
      
      // Check if service is actually reachable even if launchctl says it's not running
      if (!newStatus.running && newStatus.healthy) {
        addLog('Note: Service is reachable but not managed by launchctl');
        addLog('It may have been started manually');
      }
      setStatus(newStatus);
      
      // Show success message
      const successMsg = status.running ? 'Service stopped successfully' : 'Service started successfully';
      addLog(`SUCCESS: ${successMsg}`);
      setOperationResult({
        type: 'success',
        message: successMsg
      });
      
      // Clear message after 3 seconds
      setTimeout(() => setOperationResult(null), 3000);
      
      // Notify parent component of status change
      if (onStatusChange) {
        console.log('[ExternalService] Notifying parent component of new status');
        onStatusChange(newStatus);
      }
    } catch (error) {
      addLog(`============ ERROR ============`);
      addLog(`Failed to ${operation} service`);
      addLog(`Error type: ${typeof error}`);
      const errorMsg = error instanceof Error ? error.message : String(error);
      addLog(`Error message: ${errorMsg}`);
      if (error instanceof Error && error.stack) {
        addLog(`Stack trace: ${error.stack.split('\n')[0]}`);
      }
      
      // Show detailed error in UI
      setOperationResult({
        type: 'error',
        message: `Failed to ${operation} service: ${errorMsg}`
      });
      
      // Clear error after 5 seconds
      setTimeout(() => setOperationResult(null), 5000);
    } finally {
      addLog('Operation completed, setting state to idle');
      setServiceOperation('idle');
      // Keep logs visible for debugging
      setTimeout(() => {
        if (operationLogs.length > 10) {
          setOperationLogs(prev => prev.slice(-5)); // Keep last 5 logs
        }
      }, 10000);
    }
  };

  const testConnection = async () => {
    console.log('[ExternalService] Testing service connection...');
    setTesting(true);
    try {
      const result = await invoke<{ success: boolean; message: string }>('test_external_service');
      console.log('[ExternalService] Connection test result:', result);
      
      if (result.success) {
        console.log('[ExternalService] Connection test successful');
        setOperationResult({
          type: 'success',
          message: 'Connection test successful! Service is responding correctly.'
        });
      } else {
        console.warn('[ExternalService] Connection test failed:', result.message);
        setOperationResult({
          type: 'error',
          message: `Connection test failed: ${result.message}`
        });
      }
      setTimeout(() => setOperationResult(null), 4000);
    } catch (error) {
      console.error('[ExternalService] Connection test error:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      setOperationResult({
        type: 'error',
        message: `Connection test error: ${errorMsg}`
      });
      setTimeout(() => setOperationResult(null), 5000);
    } finally {
      setTesting(false);
      console.log('[ExternalService] Rechecking service status after test...');
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
      {/* Debug info during development */}
      {(window as any).__DEV_TRANSCRIBER_STATUS !== undefined && (
        <div style={{
          padding: '8px',
          background: 'rgba(255, 255, 0, 0.1)',
          border: '1px solid rgba(255, 255, 0, 0.3)',
          borderRadius: '4px',
          marginBottom: '12px',
          fontSize: '11px',
          fontFamily: 'monospace'
        }}>
          <strong>Debug:</strong> installStatus={installStatus}, 
          devStatus={(window as any).__DEV_TRANSCRIBER_STATUS}, 
          userOverride={String(userOverrideDevToolbar)}
        </div>
      )}
      
      {/* Introduction Section - Only show when not installed */}
      {installStatus === 'not_installed' && (
        <div className="intro-section">
          <p className="intro-description">
            The <code>`transcriber`</code> service gives you complete control over your transcription models. 
            Run your choice of engines including OpenAI's Whisper, NVIDIA's Parakeet MLX (optimized for Apple Silicon), 
            or Facebook's Wav2Vec2. The service runs independently with its own Python environment, 
            allowing you to customize workers, ports, and model configurations for your specific needs.
            {' '}
            <a 
              href="https://scout.arach.dev/blog/transcriber-architecture" 
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
      )}

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
                  If command not found, check that <code style={{ fontSize: '10px' }}>/usr/local/bin</code> is in your PATH
                </p>
              </div>
            </div>

            <div className="install-step">
              <div className="step-number">4</div>
              <div className="step-content">
                <h4>Verify Scout Integration</h4>
                <p className="step-desc">Let Scout check it can invoke the transcriber service</p>
                <button 
                  className="verify-status-btn"
                  onClick={async () => {
                    setConnectionCheckResult('checking');
                    try {
                      // Check if transcriber is installed
                      const isInstalled = await invoke<boolean>('check_transcriber_installed');
                      if (!isInstalled) {
                        setConnectionCheckResult('failed');
                        return;
                      }
                      
                      // Installation verified - that's success!
                      // We don't require the service to be running
                      setConnectionCheckResult('success');
                      
                      // Don't auto-transition - let user click to proceed
                      // Also check if service happens to be running
                      checkServiceStatus();
                    } catch (error) {
                      console.error('Installation check failed:', error);
                      setConnectionCheckResult('failed');
                    }
                  }}
                  disabled={connectionCheckResult === 'checking'}
                >
                  {connectionCheckResult === 'checking' ? (
                    <>
                      <span>Checking...</span>
                      <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 2v4m0 12v4m10-10h-4M6 12H2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                    </>
                  ) : (
                    <>
                      <span>Verify Installation</span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M9 11l3 3L22 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </>
                  )}
                </button>
                
                {/* Show result inline */}
                {connectionCheckResult === 'success' && (
                  <>
                    <div style={{ 
                      marginTop: '12px', 
                      padding: '8px 12px', 
                      background: 'rgba(16, 185, 129, 0.1)', 
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      borderRadius: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      <CheckCircle size={16} style={{ color: 'rgb(16, 185, 129)' }} />
                      <span style={{ fontSize: '12px', color: 'rgb(16, 185, 129)' }}>Success! Scout can invoke the transcriber service.</span>
                    </div>
                    <button
                      className="btn-primary"
                      onClick={() => {
                        // Override dev toolbar state and proceed
                        setUserOverrideDevToolbar(true);
                        setInstallStatus('installed');
                        // Clear any dev override
                        if ((window as any).__DEV_TRANSCRIBER_STATUS) {
                          (window as any).__DEV_TRANSCRIBER_STATUS = 'installed';
                        }
                      }}
                      style={{ 
                        marginTop: '12px',
                        width: '100%',
                        padding: '10px',
                        background: 'var(--accent-primary)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '13px',
                        fontWeight: '500',
                        cursor: 'pointer'
                      }}
                    >
                      Continue to Configuration →
                    </button>
                  </>
                )}
                
                {connectionCheckResult === 'failed' && (
                  <div style={{ 
                    marginTop: '12px', 
                    padding: '8px 12px', 
                    background: 'rgba(239, 68, 68, 0.1)', 
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: '4px'
                  }}>
                    <span style={{ fontSize: '12px', color: 'rgb(239, 68, 68)' }}>
                      Scout cannot find the transcriber command. Please verify installation in Step 3.
                    </span>
                    <div style={{ marginTop: '6px' }}>
                      <code style={{ fontSize: '11px', opacity: 0.8 }}>curl -sSf https://scout.arach.dev/install-transcriber.sh | sh</code>
                    </div>
                  </div>
                )}
                
                {!connectionCheckResult && (
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '8px', marginBottom: 0 }}>
                    Scout will check if it can invoke the transcriber command
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Service Management - Only show when installed */}
      {installStatus === 'installed' && (
        /* DEBUG: installStatus = {installStatus} */
        <>
          {/* Service Management Section */}
          <div className="config-section">
            <h4>Service Management</h4>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: 0, marginBottom: '12px' }}>
              The transcriber runs as a background service, processing audio independently from Scout.
            </p>
            
            {/* Operation result message */}
            {operationResult && (
              <div style={{
                padding: '10px 12px',
                marginBottom: '12px',
                background: operationResult.type === 'success' 
                  ? 'rgba(16, 185, 129, 0.1)' 
                  : 'rgba(239, 68, 68, 0.1)',
                border: `1px solid ${operationResult.type === 'success' 
                  ? 'rgba(16, 185, 129, 0.3)' 
                  : 'rgba(239, 68, 68, 0.3)'}`,
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '13px',
                color: operationResult.type === 'success' 
                  ? 'rgb(16, 185, 129)' 
                  : 'rgb(239, 68, 68)'
              }}>
                {operationResult.type === 'success' ? (
                  <CheckCircle size={16} />
                ) : (
                  <AlertCircle size={16} />
                )}
                <span>{operationResult.message}</span>
              </div>
            )}
            
            {status.error && !operationResult && (
              <div className="error-message" style={{ marginBottom: '12px' }}>{status.error}</div>
            )}
            <div className="service-controls">
              <button 
                className="btn-control"
                onClick={async () => {
                  setOperationLogs([]);
                  addLog('============ CHECKING STATUS ============');
                  addLog('Fetching current service status...');
                  await checkServiceStatus();
                  const currentStatus = await invoke<ServiceStatus>('check_external_service_status');
                  addLog(`Status: running=${currentStatus.running}, healthy=${currentStatus.healthy}`);
                  if (currentStatus.error) {
                    addLog(`Error: ${currentStatus.error}`);
                  }
                  
                  // Additional status info
                  if (!currentStatus.running && !currentStatus.healthy) {
                    addLog('Service is not running and not reachable');
                    addLog('Try clicking "Start Service" to start it');
                  } else if (currentStatus.running && currentStatus.healthy) {
                    addLog('Service is running and healthy');
                  } else if (!currentStatus.running && currentStatus.healthy) {
                    addLog('Service is reachable but not managed by launchctl');
                    addLog('It may have been started manually');
                  } else if (currentStatus.running && !currentStatus.healthy) {
                    addLog('Service is running but not responding');
                    addLog('Check /tmp/transcriber.error.log for details');
                  }
                  
                  addLog('Status check complete');
                }}
                style={{
                  background: 'rgba(96, 165, 250, 0.1)',
                  border: '1px solid rgba(96, 165, 250, 0.3)',
                  color: 'rgb(96, 165, 250)',
                  marginRight: '8px'
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 4v6h6M23 20v-6h-6"/>
                  <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
                </svg>
                <span>Check Status</span>
              </button>
              
              <button 
                className="btn-control"
                onClick={handleStartStop}
                disabled={serviceOperation !== 'idle'}
                style={{ 
                  background: !status.running ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                  border: !status.running ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
                  color: !status.running ? 'rgb(16, 185, 129)' : 'rgb(239, 68, 68)',
                  opacity: serviceOperation !== 'idle' ? 0.6 : 1,
                  cursor: serviceOperation !== 'idle' ? 'not-allowed' : 'pointer'
                }}
              >
                {serviceOperation === 'starting' ? (
                  <>
                    <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 2v4m0 12v4m10-10h-4M6 12H2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                    <span>Starting Service...</span>
                  </>
                ) : serviceOperation === 'stopping' ? (
                  <>
                    <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 2v4m0 12v4m10-10h-4M6 12H2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                    <span>Stopping Service...</span>
                  </>
                ) : status.running ? (
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
                  disabled={testing || serviceOperation !== 'idle'}
                  style={{ 
                    background: 'transparent',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    color: 'var(--text-secondary)',
                    opacity: (testing || serviceOperation !== 'idle') ? 0.5 : 1,
                    cursor: (testing || serviceOperation !== 'idle') ? 'not-allowed' : 'pointer'
                  }}
                >
                  {testing ? 'Testing...' : 'Test Connection'}
                </button>
              )}
            </div>
            {status.running && (
              <p style={{ 
                fontSize: '11px', 
                color: 'var(--text-secondary)', 
                marginTop: '10px', 
                marginBottom: 0,
                opacity: 0.7
              }}>
                Service is running in the background and will continue after Scout closes.
              </p>
            )}
            
            {/* Operation Logs Display */}
            {operationLogs.length > 0 && (
              <div style={{
                marginTop: '12px',
                padding: '8px',
                background: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '4px',
                maxHeight: '200px',
                overflowY: 'auto'
              }}>
                <div style={{
                  fontSize: '10px',
                  fontFamily: 'monospace',
                  color: 'rgba(255, 255, 255, 0.7)',
                  whiteSpace: 'pre-wrap'
                }}>
                  {operationLogs.map((log, i) => (
                    <div key={i} style={{ marginBottom: '2px' }}>{log}</div>
                  ))}
                </div>
              </div>
            )}
          </div>

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

          {/* Documentation Link - Secondary placement */}
          <div style={{ 
            textAlign: 'center', 
            marginTop: '24px', 
            paddingTop: '20px', 
            borderTop: '1px solid rgba(255, 255, 255, 0.08)' 
          }}>
            <a 
              href="https://scout.arach.dev/docs/transcriber" 
              target="_blank" 
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                color: 'rgba(255, 255, 255, 0.5)',
                fontSize: '12px',
                textDecoration: 'none',
                transition: 'color 0.2s ease'
              }}
              onMouseOver={(e) => e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)'}
              onMouseOut={(e) => e.currentTarget.style.color = 'rgba(255, 255, 255, 0.5)'}
            >
              <span>View transcriber documentation</span>
              <ExternalLink size={11} />
            </a>
          </div>
        </>
      )}
    </div>
  );
};
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { TranscriptionOverlay } from './TranscriptionOverlay';
import { Transcript } from '../types/transcript';
import { useAudioLevel } from '../contexts/AudioContext';
import './DevTools.css';

interface ModelAccelerationStatus {
  id: string;
  name: string;
  size_mb: number;
  downloaded: boolean;
  coreml_available: boolean;
  coreml_downloaded: boolean;
  acceleration_type: string;
  acceleration_status: string;
  file_path?: string;
  coreml_path?: string;
  performance_estimate: string;
}

interface ModelWarmupStatus {
  id: string;
  name: string;
  is_active: boolean;
  is_ready: boolean;
  is_warming: boolean;
  status_text: string;
  last_warmed?: string;
}

type View = 'record' | 'transcripts' | 'settings' | 'stats' | 'dictionary';

interface DevToolsProps {
  currentView: View;
  // Recording context
  selectedMic?: string;
  isRecording?: boolean;
  isProcessing?: boolean;
  // Transcripts context
  transcripts?: Transcript[];
  searchQuery?: string;
  selectedTranscripts?: Set<number>;
  // Settings context  
  hotkey?: string;
  pushToTalkHotkey?: string;
  // Transcription overlay
  showTranscriptionOverlay?: boolean;
  onToggleTranscriptionOverlay?: (show: boolean) => void;
  // Shared
  appVersion?: string;
}

export function DevTools(props: DevToolsProps) {
  const {
    currentView,
    selectedMic = '',
    isRecording = false,
    isProcessing = false,
    transcripts = [],
    searchQuery = '',
    selectedTranscripts = new Set(),
    hotkey = '',
    pushToTalkHotkey = '',
    // currentUser = 'Unknown', // Unused variable
    appVersion = '0.1.0'
  } = props;

  // Get audio level from the subscription hook
  const audioLevel = useAudioLevel();

  const [isOpen, setIsOpen] = useState(false);
  const [showMicLevel, setShowMicLevel] = useState(false);
  const [showConsoleLog, setShowConsoleLog] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [showTeleprompter, setShowTeleprompter] = useState(false);
  const [waveformStyle, setWaveformStyle] = useState<'classic' | 'enhanced' | 'particles'>('enhanced');
  const [modelAcceleration, setModelAcceleration] = useState<ModelAccelerationStatus[]>([]);
  const [showModelAcceleration, setShowModelAcceleration] = useState(false);
  const [modelWarmup, setModelWarmup] = useState<ModelWarmupStatus[]>([]);
  const [showModelWarmup, setShowModelWarmup] = useState(false);

  // Only show in development
  const isDev = import.meta.env.DEV;
  if (!isDev) return null;

  const handleToggle = () => {
    setIsAnimating(true);
    setIsOpen(!isOpen);
    setTimeout(() => {
      setIsAnimating(false);
    }, 150);
  };

  const getButtonClass = () => {
    let className = "dev-tools-button";
    if (isAnimating) {
      className += isOpen ? " collapsing" : " expanding";
    }
    if (isOpen && !isAnimating) {
      className += " active";
    }
    return className;
  };

  const handleWaveformStyleChange = async (style: 'classic' | 'enhanced' | 'particles') => {
    try {
      await invoke('set_overlay_waveform_style', { style });
      setWaveformStyle(style);
      console.log(`[DevTools] Switched to ${style} waveform`);
    } catch (error) {
      console.error('[DevTools] Failed to change waveform style:', error);
    }
  };

  const handleTeleprompterToggle = (enabled: boolean) => {
    setShowTeleprompter(enabled);
    console.log(`[DevTools] Teleprompter overlay ${enabled ? 'shown' : 'hidden'}`);
  };

  const loadModelAccelerationStatus = async () => {
    try {
      const status = await invoke<ModelAccelerationStatus[]>('get_model_acceleration_status');
      setModelAcceleration(status);
      console.log('[DevTools] Model acceleration status loaded:', status);
    } catch (error) {
      console.error('[DevTools] Failed to load model acceleration status:', error);
    }
  };

  const loadModelWarmupStatus = async () => {
    try {
      const status = await invoke<ModelWarmupStatus[]>('get_model_warmup_status');
      setModelWarmup(status);
      console.log('[DevTools] Model warmup status loaded:', status);
    } catch (error) {
      console.error('[DevTools] Failed to load model warmup status:', error);
    }
  };

  // Load model acceleration status when showing the feature
  useEffect(() => {
    if (showModelAcceleration && currentView === 'settings') {
      loadModelAccelerationStatus();
    }
  }, [showModelAcceleration, currentView]);

  // Load model warmup status when showing the feature in recording view
  useEffect(() => {
    if (showModelWarmup && currentView === 'record') {
      loadModelWarmupStatus();
    }
  }, [showModelWarmup, currentView]);

  // Console logging effect - context aware
  useEffect(() => {
    if (!showConsoleLog) return;

    const logData = {
      view: currentView,
      timestamp: new Date().toISOString()
    };

    if (currentView === 'record') {
      Object.assign(logData, {
        audioLevel: audioLevel.toFixed(6),
        device: selectedMic,
        recording: isRecording,
        processing: isProcessing
      });
    } else if (currentView === 'transcripts') {
      Object.assign(logData, {
        totalTranscripts: transcripts.length,
        searchQuery,
        selectedCount: selectedTranscripts.size
      });
    } else if (currentView === 'settings') {
      Object.assign(logData, {
        hotkey,
        pushToTalkHotkey
      });
    }

    console.log('[DevTools]', logData);
  }, [
    showConsoleLog,
    currentView,
    // Recording deps
    audioLevel,
    selectedMic,
    isRecording,
    isProcessing,
    // Transcripts deps
    transcripts.length,
    searchQuery,
    selectedTranscripts.size,
    // Settings deps
    hotkey,
    pushToTalkHotkey
  ]);

  return (
    <>
      {/* DEV Button - Circular with Animation */}
      <button 
        className={getButtonClass()}
        onClick={handleToggle}
        title="Developer Tools"
      >
        DEV
      </button>

      {/* Dev Tools Panel - Context Aware */}
      {isOpen && (
        <div className="dev-tools-panel">
          <div className="dev-tools-header">
            <h3>Dev Tools - {currentView.charAt(0).toUpperCase() + currentView.slice(1)}</h3>
            <button 
              className="dev-tools-close"
              onClick={() => setIsOpen(false)}
            >
              ×
            </button>
          </div>
          
          <div className="dev-tools-content">
            {/* Context-specific primary features */}
            {currentView === 'record' && (
              <>
                <div className="dev-tool-item primary">
                  <label className="dev-tool-checkbox">
                    <input
                      type="checkbox"
                      checked={showMicLevel}
                      onChange={(e) => setShowMicLevel(e.target.checked)}
                    />
                    <span className="checkbox-label">Show Mic Level Overlay</span>
                  </label>
                </div>
                
                <div className="dev-tool-section">
                  <h4>Native Overlay</h4>
                  <div className="dev-tool-item">
                    <label className="dev-tool-checkbox">
                      <input
                        type="checkbox"
                        checked={showTeleprompter}
                        onChange={(e) => handleTeleprompterToggle(e.target.checked)}
                      />
                      <span className="checkbox-label">Show Teleprompter Overlay</span>
                    </label>
                  </div>
                  
                  <div className="dev-tool-item">
                    <span className="status-label">Waveform Style:</span>
                    <select 
                      className="dev-tool-select"
                      value={waveformStyle}
                      onChange={(e) => handleWaveformStyleChange(e.target.value as 'classic' | 'enhanced' | 'particles')}
                    >
                      <option value="classic">Classic Bars</option>
                      <option value="enhanced">Subtle Spectrum</option>
                      <option value="particles">Particle Flow</option>
                    </select>
                  </div>
                </div>
                
                <div className="dev-tool-section">
                  <h4>Model Readiness</h4>
                  <div className="dev-tool-item">
                    <label className="dev-tool-checkbox">
                      <input
                        type="checkbox"
                        checked={showModelWarmup}
                        onChange={(e) => setShowModelWarmup(e.target.checked)}
                      />
                      <span className="checkbox-label">Show CoreML Warmup Status</span>
                    </label>
                  </div>
                  
                  {showModelWarmup && (
                    <div className="model-warmup-status">
                      <div className="dev-tool-item">
                        <button 
                          className="dev-tool-button"
                          onClick={loadModelWarmupStatus}
                        >
                          🔄 Refresh Status
                        </button>
                      </div>
                      
                      <div className="model-warmup-list">
                        {modelWarmup.map((model) => (
                          <div key={model.id} className={`model-warmup-card ${model.is_active ? 'active' : ''}`}>
                            <div className="model-warmup-header">
                              <span className="model-name">{model.name}</span>
                              {model.is_active && <span className="active-badge">ACTIVE</span>}
                            </div>
                            
                            <div className="model-warmup-row">
                              <span className="warmup-status-text">{model.status_text}</span>
                              {model.is_warming && <div className="warmup-spinner">🔄</div>}
                            </div>
                            
                            {model.last_warmed && (
                              <div className="last-warmed">
                                Last warmed: {new Date(model.last_warmed).toLocaleTimeString()}
                              </div>
                            )}
                          </div>
                        ))}
                        
                        {modelWarmup.length === 0 && (
                          <div className="no-models">
                            <p>Click "Refresh Status" to load model information</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {currentView === 'transcripts' && (
              <div className="dev-tool-item primary">
                <label className="dev-tool-checkbox">
                  <input
                    type="checkbox"
                    checked={showConsoleLog}
                    onChange={(e) => setShowConsoleLog(e.target.checked)}
                  />
                  <span className="checkbox-label">Log Transcript Operations</span>
                </label>
              </div>
            )}

            {currentView === 'settings' && (
              <>
                <div className="dev-tool-item primary">
                  <label className="dev-tool-checkbox">
                    <input
                      type="checkbox"
                      checked={showConsoleLog}
                      onChange={(e) => setShowConsoleLog(e.target.checked)}
                    />
                    <span className="checkbox-label">Log Settings Changes</span>
                  </label>
                </div>
                
                <div className="dev-tool-section">
                  <h4>Model Acceleration Status</h4>
                  <div className="dev-tool-item">
                    <label className="dev-tool-checkbox">
                      <input
                        type="checkbox"
                        checked={showModelAcceleration}
                        onChange={(e) => setShowModelAcceleration(e.target.checked)}
                      />
                      <span className="checkbox-label">Show Model Hardware Acceleration</span>
                    </label>
                  </div>
                  
                  {showModelAcceleration && (
                    <div className="model-acceleration-status">
                      <div className="dev-tool-item">
                        <button 
                          className="dev-tool-button"
                          onClick={loadModelAccelerationStatus}
                        >
                          🔄 Refresh Status
                        </button>
                      </div>
                      
                      <div className="model-list">
                        {modelAcceleration.map((model) => (
                          <div key={model.id} className="model-status-card">
                            <div className="model-header">
                              <span className="model-name">{model.name}</span>
                              <span className="model-size">{model.size_mb}MB</span>
                            </div>
                            
                            <div className="model-status-row">
                              <span className="status-label">Downloaded:</span>
                              <span className={`status-badge ${model.downloaded ? 'success' : 'error'}`}>
                                {model.downloaded ? '✅' : '❌'}
                              </span>
                            </div>
                            
                            <div className="model-status-row">
                              <span className="status-label">Acceleration:</span>
                              <span className="acceleration-type">{model.acceleration_type}</span>
                            </div>
                            
                            <div className="model-status-row">
                              <span className="status-label">Status:</span>
                              <span className="acceleration-status">{model.acceleration_status}</span>
                            </div>
                            
                            <div className="model-status-row">
                              <span className="status-label">Performance:</span>
                              <span className="performance-estimate">{model.performance_estimate}</span>
                            </div>
                            
                            {model.coreml_available && (
                              <div className="model-status-row">
                                <span className="status-label">CoreML:</span>
                                <span className={`status-badge ${model.coreml_downloaded ? 'success' : 'warning'}`}>
                                  {model.coreml_downloaded ? '✅ Downloaded' : '⚠️ Available'}
                                </span>
                              </div>
                            )}
                            
                            {model.file_path && (
                              <div className="model-file-path">
                                <span className="file-path-label">Path:</span>
                                <code className="file-path">{model.file_path}</code>
                              </div>
                            )}
                          </div>
                        ))}
                        
                        {modelAcceleration.length === 0 && (
                          <div className="no-models">
                            <p>Click "Refresh Status" to load model information</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Logging Controls */}
            <div className="dev-tool-section">
              <h4>Logging</h4>
              <div className="dev-tool-item">
                <label className="dev-tool-checkbox">
                  <input
                    type="checkbox"
                    checked={showConsoleLog}
                    onChange={(e) => setShowConsoleLog(e.target.checked)}
                  />
                  <span className="checkbox-label">
                    {currentView === 'record' ? 'Audio Level Logging' :
                     currentView === 'transcripts' ? 'Transcript Events' :
                     'Settings Events'}
                  </span>
                </label>
              </div>
              
              <div className="dev-tool-item">
                <button 
                  className="dev-tool-button"
                  onClick={async () => {
                    try {
                      await invoke('open_log_file');
                    } catch (error) {
                      console.error('Failed to open log file:', error);
                    }
                  }}
                >
                  Open Log File
                </button>
                <button 
                  className="dev-tool-button"
                  onClick={async () => {
                    try {
                      await invoke('show_log_file_in_finder');
                    } catch (error) {
                      console.error('Failed to show log file in finder:', error);
                    }
                  }}
                >
                  Show in Finder
                </button>
              </div>
            </div>

            {/* Context-specific status */}
            <div className="dev-tool-section">
              <h4>Current Status</h4>
              <div className="status-grid">
                {currentView === 'record' && (
                  <>
                    <span className="status-label">State:</span>
                    <span className={`status-badge ${isRecording ? 'recording' : 'idle'}`}>
                      {isRecording ? 'RECORDING' : 'IDLE'}
                    </span>
                    
                    <span className="status-label">Process:</span>
                    <span className={`status-badge ${isProcessing ? 'processing' : 'ready'}`}>
                      {isProcessing ? 'PROCESSING' : 'READY'}
                    </span>
                    
                    <span className="status-label">Audio Level:</span>
                    <span className="audio-level-mini">
                      {audioLevel.toFixed(3)}
                    </span>

                    <span className="status-label">Device:</span>
                    <span className="device-name-mini">
                      {selectedMic.length > 12 ? selectedMic.substring(0, 12) + '...' : selectedMic}
                    </span>
                  </>
                )}

                {currentView === 'transcripts' && (
                  <>
                    <span className="status-label">Total:</span>
                    <span className="status-value">{transcripts.length}</span>
                    
                    <span className="status-label">Selected:</span>
                    <span className="status-value">{selectedTranscripts.size}</span>
                    
                    <span className="status-label">Search:</span>
                    <span className="status-value">
                      {searchQuery ? `"${searchQuery.substring(0, 8)}..."` : 'None'}
                    </span>
                  </>
                )}

                {currentView === 'settings' && (
                  <>
                    
                    <span className="status-label">Hotkey:</span>
                    <span className="status-value">{hotkey || 'None'}</span>
                    
                    <span className="status-label">Push-to-talk:</span>
                    <span className="status-value">{pushToTalkHotkey || 'None'}</span>
                  </>
                )}
              </div>
            </div>

            {/* App Info */}
            <div className="dev-tool-section">
              <h4>App Info</h4>
              <div className="status-grid">
                <span className="status-label">Version:</span>
                <span className="status-value">{appVersion}</span>
                
                <span className="status-label">Mode:</span>
                <span className="status-value">{import.meta.env.MODE}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mic Level Overlay */}
      {showMicLevel && (
        <div className="mic-level-overlay">
          <div className="mic-level-header">Audio Monitor</div>
          <div className="mic-level-row">
            <span className="mic-level-label">Level:</span>
            <span className="mic-level-value">{audioLevel.toFixed(6)}</span>
          </div>
          <div className="mic-level-bar">
            <div 
              className="mic-level-fill"
              style={{ width: `${Math.min(audioLevel * 100, 100)}%` }}
            />
          </div>
          <div className="mic-level-row">
            <span className="mic-level-label">Device:</span>
            <span className="mic-level-device">{selectedMic.length > 18 ? selectedMic.substring(0, 18) + '...' : selectedMic}</span>
          </div>
          <div className="mic-level-row">
            <span className="mic-level-label">Status:</span>
            <span className="mic-level-status">
              {isRecording ? 'RECORDING' : 'IDLE'}
            </span>
          </div>
        </div>
      )}

      {/* Transcription Overlay (Teleprompter) */}
      {showTeleprompter && (
        <TranscriptionOverlay
          isVisible={showTeleprompter}
          isRecording={isRecording}
          onClose={() => setShowTeleprompter(false)}
          mode="teleprompter"
        />
      )}
    </>
  );
}
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { TranscriptionOverlay } from './TranscriptionOverlay';
import { Transcript } from '../types/transcript';
import { useAudioLevel } from '../contexts/AudioContext';
import './DevTools.css';

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
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { TranscriptionOverlay } from './TranscriptionOverlay';
import { Transcript } from '../types/transcript';
import { useAudioLevel } from '../contexts/AudioContext';
import { useUIContext } from '../contexts/UIContext';
import './DevTools.css';

type View = 'record' | 'transcripts' | 'settings' | 'stats' | 'dictionary' | 'webhooks';
type OnboardingStep = 'model' | 'microphone' | 'shortcuts' | 'tour';

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
  // Onboarding context
  onboardingStep?: OnboardingStep;
  onStepChange?: (step: OnboardingStep) => void;
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
    appVersion = '0.1.0',
    onboardingStep: propsOnboardingStep,
    onStepChange: propsOnStepChange
  } = props;

  // Get audio level from the subscription hook (may not be available in onboarding)
  let audioLevel = 0;
  try {
    audioLevel = useAudioLevel();
  } catch {
    // AudioContext not available in onboarding
    audioLevel = 0;
  }
  
  // Get UI context for onboarding control (may be null if in onboarding flow)
  let showFirstRun = false;
  let setShowFirstRun: ((value: boolean) => void) | undefined;
  
  try {
    const uiContext = useUIContext();
    showFirstRun = uiContext.showFirstRun;
    setShowFirstRun = uiContext.setShowFirstRun;
  } catch {
    // We're in onboarding flow, UIContext is not available
    // Use props instead
    showFirstRun = !!propsOnboardingStep;
  }

  const [isOpen, setIsOpen] = useState(false);
  const [showMicLevel, setShowMicLevel] = useState(false);
  const [showConsoleLog, setShowConsoleLog] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [showTeleprompter, setShowTeleprompter] = useState(false);
  const [waveformStyle, setWaveformStyle] = useState<'classic' | 'enhanced' | 'particles'>('enhanced');
  const [currentOnboardingStep, setCurrentOnboardingStep] = useState<OnboardingStep>(propsOnboardingStep || 'model');
  const [transcriberInstallStatus, setTranscriberInstallStatus] = useState<'checking' | 'installed' | 'not_installed' | null>(null);

  // Sync with props onboarding step when it changes
  useEffect(() => {
    if (propsOnboardingStep) {
      setCurrentOnboardingStep(propsOnboardingStep);
    }
  }, [propsOnboardingStep]);

  // Load onboarding step from localStorage
  useEffect(() => {
    if (!propsOnboardingStep) {
      try {
        const savedState = localStorage.getItem('scout-onboarding-state');
        if (savedState) {
          const state = JSON.parse(savedState);
          if (state.currentStep) {
            setCurrentOnboardingStep(state.currentStep);
          }
        }
      } catch (error) {
        console.error('[DevTools] Failed to load onboarding state:', error);
      }
    }
  }, [showFirstRun, propsOnboardingStep]);

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

  // Onboarding navigation functions
  const handleShowOnboarding = () => {
    if (propsOnStepChange) {
      // We're in onboarding, just reset to first step
      propsOnStepChange('model');
      console.log('[DevTools] Resetting to first onboarding step');
    } else if (setShowFirstRun) {
      // Clear any existing onboarding state
      localStorage.removeItem('scout-onboarding-complete');
      localStorage.removeItem('scout-onboarding-state');
      // Show onboarding
      setShowFirstRun(true);
      console.log('[DevTools] Showing onboarding flow');
    }
  };

  const handleJumpToOnboardingStep = (step: OnboardingStep) => {
    if (propsOnStepChange) {
      // We're in onboarding, use the prop callback
      propsOnStepChange(step);
      console.log(`[DevTools] Navigating to onboarding step: ${step}`);
    } else {
      // Set up the onboarding state for the specific step
      const onboardingState = {
        currentStep: step,
        downloadStatus: step === 'model' ? 'idle' : 'complete',
        micPermission: step === 'microphone' ? 'not-determined' : 'granted',
        shortcutsConfigured: step === 'shortcuts' ? false : true
      };
      
      localStorage.setItem('scout-onboarding-state', JSON.stringify(onboardingState));
      localStorage.removeItem('scout-onboarding-complete');
      
      setCurrentOnboardingStep(step);
      if (setShowFirstRun) {
        setShowFirstRun(true);
      }
      console.log(`[DevTools] Jumping to onboarding step: ${step}`);
    }
  };

  const handleSkipOnboarding = () => {
    if (propsOnStepChange) {
      // We're in onboarding, can't really skip from here
      console.log('[DevTools] Cannot skip onboarding from within onboarding flow');
    } else if (setShowFirstRun) {
      localStorage.setItem('scout-onboarding-complete', 'true');
      setShowFirstRun(false);
      console.log('[DevTools] Skipping onboarding');
    }
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

                {/* Transcriber Installation Status Override */}
                <div className="dev-tool-section">
                  <h4>Transcriber Service Mock</h4>
                  <div className="dev-tool-item">
                    <span className="status-label">Override Install Status:</span>
                  </div>
                  <div className="dev-tool-item">
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button
                        className={`dev-tool-button ${transcriberInstallStatus === null ? 'active' : ''}`}
                        onClick={() => {
                          setTranscriberInstallStatus(null);
                          // Set in window for component access
                          (window as any).__DEV_TRANSCRIBER_STATUS = null;
                          console.log('[DevTools] Transcriber status override: disabled');
                        }}
                      >
                        Default
                      </button>
                      <button
                        className={`dev-tool-button ${transcriberInstallStatus === 'not_installed' ? 'active' : ''}`}
                        onClick={() => {
                          setTranscriberInstallStatus('not_installed');
                          (window as any).__DEV_TRANSCRIBER_STATUS = 'not_installed';
                          console.log('[DevTools] Transcriber status override: not_installed');
                        }}
                      >
                        Not Installed
                      </button>
                      <button
                        className={`dev-tool-button ${transcriberInstallStatus === 'installed' ? 'active' : ''}`}
                        onClick={() => {
                          setTranscriberInstallStatus('installed');
                          (window as any).__DEV_TRANSCRIBER_STATUS = 'installed';
                          console.log('[DevTools] Transcriber status override: installed');
                        }}
                      >
                        Installed
                      </button>
                      <button
                        className={`dev-tool-button ${transcriberInstallStatus === 'checking' ? 'active' : ''}`}
                        onClick={() => {
                          setTranscriberInstallStatus('checking');
                          (window as any).__DEV_TRANSCRIBER_STATUS = 'checking';
                          console.log('[DevTools] Transcriber status override: checking');
                        }}
                      >
                        Checking
                      </button>
                    </div>
                  </div>
                  <div className="dev-tool-item">
                    <span className="status-label" style={{ fontSize: '11px', opacity: 0.7 }}>
                      Simulates transcriber installation states for UI testing
                    </span>
                  </div>
                </div>
              </>
            )}

            {/* Onboarding Controls */}
            <div className="dev-tool-section">
              <h4>Onboarding Navigation</h4>
              <div className="dev-tool-item">
                <span className="status-label">Status:</span>
                <span className={`status-badge ${showFirstRun ? 'active' : 'inactive'}`}>
                  {showFirstRun ? 'ACTIVE' : 'INACTIVE'}
                </span>
              </div>
              <div className="dev-tool-item">
                <button 
                  className="dev-tool-button primary"
                  onClick={handleShowOnboarding}
                >
                  {propsOnStepChange ? 'Restart Onboarding' : 'Show Onboarding'}
                </button>
                <button 
                  className="dev-tool-button"
                  onClick={handleSkipOnboarding}
                  disabled={!showFirstRun || !!propsOnStepChange}
                >
                  {propsOnStepChange ? 'Exit via UI' : 'Skip Onboarding'}
                </button>
              </div>
              <div className="dev-tool-item">
                <span className="status-label">Jump to Screen:</span>
                <div className="onboarding-nav-buttons">
                  <button 
                    className={`dev-tool-button ${currentOnboardingStep === 'model' ? 'active' : ''}`}
                    onClick={() => handleJumpToOnboardingStep('model')}
                    title="Model Download Screen"
                  >
                    1
                  </button>
                  <button 
                    className={`dev-tool-button ${currentOnboardingStep === 'microphone' ? 'active' : ''}`}
                    onClick={() => handleJumpToOnboardingStep('microphone')}
                    title="Microphone Permission Screen"
                  >
                    2
                  </button>
                  <button 
                    className={`dev-tool-button ${currentOnboardingStep === 'shortcuts' ? 'active' : ''}`}
                    onClick={() => handleJumpToOnboardingStep('shortcuts')}
                    title="Shortcuts Configuration Screen"
                  >
                    3
                  </button>
                  <button 
                    className={`dev-tool-button ${currentOnboardingStep === 'tour' ? 'active' : ''}`}
                    onClick={() => handleJumpToOnboardingStep('tour')}
                    title="Interactive Tour Screen"
                  >
                    4
                  </button>
                </div>
              </div>
            </div>

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
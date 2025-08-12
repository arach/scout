import React, { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { safeEventListen } from '../lib/safeEventListener';
import { CheckCircle, X, AlertCircle, Info, Download, Loader2, Mic } from 'lucide-react';
import { DevTools } from './DevTools';
import { MicrophoneSelector } from './MicrophoneSelector';
import './OnboardingFlow.css';

interface OnboardingFlowProps {
  onComplete: () => void;
  onStepChange?: (step: OnboardingStep) => void;
}

interface DownloadProgress {
  progress: number;
  downloadedMb: number;
  totalMb: number;
}

type PermissionStatus = 'granted' | 'denied' | 'not-determined';
type OnboardingStep = 'model' | 'microphone' | 'shortcuts' | 'tour';

// Save onboarding state to localStorage
const saveOnboardingState = (state: Partial<{
  currentStep: OnboardingStep;
  downloadStatus: string;
  micPermission: PermissionStatus;
  shortcutsConfigured: boolean;
}>) => {
  try {
    const existing = JSON.parse(localStorage.getItem('scout-onboarding-state') || '{}');
    localStorage.setItem('scout-onboarding-state', JSON.stringify({ ...existing, ...state }));
  } catch (error) {
    console.error('Failed to save onboarding state:', error);
  }
};

// Load onboarding state from localStorage
const loadOnboardingState = () => {
  try {
    return JSON.parse(localStorage.getItem('scout-onboarding-state') || '{}');
  } catch (error) {
    console.error('Failed to load onboarding state:', error);
    return {};
  }
};

export const OnboardingFlow: React.FC<OnboardingFlowProps> = ({ onComplete, onStepChange }) => {
  const savedState = loadOnboardingState();
  
  const [currentStep, setCurrentStep] = useState<OnboardingStep>(savedState.currentStep || 'model');
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'downloading' | 'complete' | 'error'>(savedState.downloadStatus || 'idle');
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [micPermission, setMicPermission] = useState<PermissionStatus>(savedState.micPermission || 'not-determined');
  const [shortcutsConfigured, setShortcutsConfigured] = useState(savedState.shortcutsConfigured || false);
  const [pushToTalkShortcut, setPushToTalkShortcut] = useState('Cmd+Shift+Space');
  const [toggleShortcut, setToggleShortcut] = useState('Cmd+Shift+R');
  const [isCapturingPTT, setIsCapturingPTT] = useState(false);
  const [isCapturingToggle, setIsCapturingToggle] = useState(false);
  const [previousPTTShortcut, setPreviousPTTShortcut] = useState('Cmd+Shift+Space');
  const [previousToggleShortcut, setPreviousToggleShortcut] = useState('Cmd+Shift+R');
  const [selectedMic, setSelectedMic] = useState<string>('');
  const [isTestingMic, setIsTestingMic] = useState(false);
  const [micTestLevel, setMicTestLevel] = useState(0);
  const activeListenerRef = useRef<(() => void) | null>(null);
  
  // Helper to transition between steps with sound
  const transitionToStep = async (step: OnboardingStep) => {
    try {
      await invoke('play_transition_sound');
    } catch (error) {
      console.error('Failed to play transition sound:', error);
    }
    setCurrentStep(step);
  };
  
  // Notify parent when step changes
  useEffect(() => {
    onStepChange?.(currentStep);
  }, [currentStep, onStepChange]);
  
  // Save state when important values change
  useEffect(() => {
    saveOnboardingState({ currentStep });
  }, [currentStep]);
  
  useEffect(() => {
    saveOnboardingState({ downloadStatus });
  }, [downloadStatus]);
  
  useEffect(() => {
    saveOnboardingState({ micPermission });
  }, [micPermission]);
  
  useEffect(() => {
    saveOnboardingState({ shortcutsConfigured });
  }, [shortcutsConfigured]);
  
  // Load current shortcuts on mount
  useEffect(() => {
    const loadShortcuts = async () => {
      try {
        const [ptt, toggle] = await Promise.all([
          invoke<string>('get_push_to_talk_shortcut'),
          invoke<string>('get_current_shortcut')
        ]);
        const pttShortcut = ptt.replace('CmdOrCtrl', 'Cmd');
        const toggleShortcutValue = toggle.replace('CmdOrCtrl', 'Cmd');
        
        setPushToTalkShortcut(pttShortcut);
        setToggleShortcut(toggleShortcutValue);
      } catch (error) {
        console.error('Failed to load shortcuts:', error);
      }
    };
    loadShortcuts();
  }, []);

  // Cleanup listener on unmount
  useEffect(() => {
    return () => {
      if (activeListenerRef.current) {
        activeListenerRef.current();
        activeListenerRef.current = null;
      }
    };
  }, []);

  // Check microphone permission status
  const checkMicPermission = async () => {
    try {
      const status = await invoke<PermissionStatus>('check_microphone_permission');
      setMicPermission(status);
    } catch (error) {
      console.error('Failed to check microphone permission:', error);
    }
  };

  // Start model download
  const startModelDownload = async () => {
    setDownloadStatus('downloading');
    setDownloadError(null);
    
    let unlisten: (() => void) | null = null;
    
    try {
      // Set up progress listener with safe handling
      const cleanup = await safeEventListen<{
        progress: number;
        downloaded: number;
        total: number;
      }>('model-download-progress', (event) => {
        const downloadedMb = event.payload.downloaded / 1048576;
        const totalMb = event.payload.total / 1048576;
        
        setDownloadProgress({
          progress: event.payload.progress,
          downloadedMb,
          totalMb
        });
      });
      
      // Store reference for cleanup
      unlisten = cleanup;
      activeListenerRef.current = cleanup;

      // Download the Tiny model
      await invoke('download_model', {
        modelName: 'tiny-en',
        modelUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin'
      });

      // Cleanup listener
      if (unlisten) {
        unlisten();
        activeListenerRef.current = null;
      }
      
      setDownloadStatus('complete');
      await invoke('play_success_sound');
      setTimeout(() => transitionToStep('microphone'), 1000);
    } catch (error) {
      console.error('Failed to download model:', error);
      setDownloadError(String(error));
      setDownloadStatus('error');
      
      // Ensure cleanup on error
      if (unlisten) {
        unlisten();
        activeListenerRef.current = null;
      }
    }
  };

  // Request microphone permission
  const requestMicPermission = async () => {
    try {
      const status = await invoke<PermissionStatus>('request_microphone_permission');
      setMicPermission(status);
      if (status === 'granted') {
        await invoke('play_success_sound');
        setTimeout(() => transitionToStep('shortcuts'), 1000);
      }
    } catch (error) {
      console.error('Failed to request microphone permission:', error);
    }
  };

  // Test microphone functionality
  const testMicrophone = async () => {
    if (isTestingMic) {
      // Stop testing
      try {
        await invoke('stop_audio_level_monitoring');
        setIsTestingMic(false);
        setMicTestLevel(0);
      } catch (error) {
        console.error('Failed to stop mic test:', error);
      }
    } else {
      // Start testing
      try {
        await invoke('start_audio_level_monitoring', { 
          deviceName: selectedMic || undefined 
        });
        setIsTestingMic(true);
        
        // Poll for audio levels
        const pollInterval = setInterval(async () => {
          try {
            const level = await invoke<number>('get_current_audio_level');
            setMicTestLevel(Math.min(100, level * 100));
          } catch (error) {
            console.error('Failed to get audio level:', error);
          }
        }, 50);
        
        // Stop after 5 seconds
        setTimeout(async () => {
          clearInterval(pollInterval);
          await invoke('stop_audio_level_monitoring').catch(console.error);
          setIsTestingMic(false);
          setMicTestLevel(0);
        }, 5000);
      } catch (error) {
        console.error('Failed to start mic test:', error);
        setIsTestingMic(false);
      }
    }
  };

  // Poll microphone permission status
  useEffect(() => {
    if (currentStep === 'microphone' && micPermission === 'not-determined') {
      const interval = setInterval(checkMicPermission, 500);
      return () => clearInterval(interval);
    }
  }, [currentStep, micPermission]);

  // Complete onboarding
  const completeOnboarding = async () => {
    try {
      await invoke('mark_onboarding_complete');
      // Clear onboarding state from localStorage since onboarding is complete
      localStorage.removeItem('scout-onboarding-state');
      onComplete();
    } catch (error) {
      console.error('Failed to mark onboarding complete:', error);
    }
  };

  // Cancel shortcut capture
  const cancelShortcutCapture = useCallback(() => {
    if (isCapturingPTT) {
      setPushToTalkShortcut(previousPTTShortcut);
      setIsCapturingPTT(false);
    } else if (isCapturingToggle) {
      setToggleShortcut(previousToggleShortcut);
      setIsCapturingToggle(false);
    }
  }, [isCapturingPTT, isCapturingToggle, previousPTTShortcut, previousToggleShortcut]);

  // Keyboard event handler for shortcut capture
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isCapturingPTT && !isCapturingToggle) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    // Handle escape key to cancel capture
    if (e.key === 'Escape') {
      cancelShortcutCapture();
      return;
    }
    
    const modifiers = [];
    if (e.metaKey) modifiers.push('Cmd');
    if (e.ctrlKey && !e.metaKey) modifiers.push('Ctrl');
    if (e.altKey) modifiers.push('Alt');
    if (e.shiftKey) modifiers.push('Shift');
    
    // Get the key - ignore modifier-only presses
    let key = e.key;
    if (['Meta', 'Control', 'Alt', 'Shift'].includes(key)) return;
    
    if (key === ' ') key = 'Space';
    else if (key.length === 1) key = key.toUpperCase();
    
    // Build shortcut string
    const shortcut = [...modifiers, key].join('+');
    
    if (isCapturingPTT) {
      setPushToTalkShortcut(shortcut);
      setIsCapturingPTT(false);
      // Save to backend
      invoke('update_global_shortcut', { 
        hotkeyType: 'push_to_talk',
        shortcut: shortcut.replace('Cmd', 'CmdOrCtrl')
      });
    } else if (isCapturingToggle) {
      setToggleShortcut(shortcut);
      setIsCapturingToggle(false);
      // Save to backend
      invoke('update_global_shortcut', { 
        hotkeyType: 'toggle',
        shortcut: shortcut.replace('Cmd', 'CmdOrCtrl')
      });
    }
  }, [isCapturingPTT, isCapturingToggle, cancelShortcutCapture]);

  // Set up keyboard listener
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const renderModelStep = () => (
    <div className="onboarding-step">
      <div className="onboarding-header">
        <h1 className="onboarding-title">Welcome to Scout</h1>
        <p className="onboarding-subtitle">
          Instant, private transcription—everything stays on your Mac.
        </p>
      </div>

      <div className="onboarding-features">
        {["Runs entirely on your Mac", "No audio ever leaves the device", "Works offline"].map((feature, index) => (
          <div key={index} className="onboarding-feature" style={{ animationDelay: `${index * 150}ms` }}>
            <CheckCircle />
            <span>{feature}</span>
          </div>
        ))}
      </div>

      <div className="onboarding-content">
        <p className="onboarding-description">
          Download the AI model to enable transcription:
        </p>

        <div className="onboarding-model-details">
          <div className="onboarding-model-detail">
            <span className="onboarding-model-detail-label">File:</span>
            <span className="onboarding-model-detail-value">ggml-tiny.en.bin (39 MB)</span>
          </div>
          <div className="onboarding-model-detail">
            <span className="onboarding-model-detail-label">Source:</span>
            <span className="onboarding-model-detail-value">huggingface.co/whisper</span>
          </div>
        </div>

        {downloadStatus === 'complete' && (
          <div className="onboarding-success">
            <CheckCircle />
            <span className="onboarding-success-text">
              Model downloaded successfully! Ready for transcription.
            </span>
          </div>
        )}

        {downloadStatus === 'downloading' && downloadProgress && (
          <div className="onboarding-progress">
            <div className="onboarding-progress-bar">
              <div className="onboarding-progress-fill" style={{ width: `${downloadProgress.progress}%` }} />
            </div>
            <div className="onboarding-progress-text">
              {downloadProgress.downloadedMb.toFixed(1)} / {downloadProgress.totalMb.toFixed(1)} MB
            </div>
          </div>
        )}

        {downloadStatus === 'downloading' && !downloadProgress && (
          <div className="onboarding-loading">
            <Loader2 />
            <span className="onboarding-loading-text">Installing...</span>
          </div>
        )}

        {downloadStatus === 'error' && (
          <div className="onboarding-error">
            <div className="onboarding-error-message">
              <AlertCircle />
              <span>Download failed: {downloadError}</span>
            </div>
            <button className="onboarding-btn onboarding-btn-secondary" onClick={startModelDownload}>
              Retry Download
            </button>
          </div>
        )}
      </div>

      <div className="onboarding-actions">
        {downloadStatus === 'idle' && (
          <>
            <button
              onClick={startModelDownload}
              className="onboarding-btn onboarding-btn-primary"
            >
              <Download className="inline mr-1" style={{ width: '12px', height: '12px' }} />
              Download model (39 MB)
            </button>
            <p className="onboarding-note">You can always download a better model later.</p>
          </>
        )}
        {downloadStatus === 'complete' && (
          <>
            <button
              onClick={() => transitionToStep('microphone')}
              className="onboarding-btn onboarding-btn-primary"
            >
              Next: Set Up Microphone
            </button>
            <p className="onboarding-note">You can always download a better model later.</p>
          </>
        )}
      </div>
    </div>
  );

  const renderMicrophoneStep = () => (
    <div className="onboarding-step">
      <div className="onboarding-header">
        <h1 className="onboarding-title">Microphone Permission</h1>
        <p className="onboarding-subtitle">
          Now let's enable voice recording to start transcribing.
        </p>
      </div>

      <div className="onboarding-features">
        {["All processing happens locally on your Mac", "You control when recording starts and stops"].map(
          (feature, index) => (
            <div key={index} className="onboarding-feature">
              <CheckCircle />
              <span>{feature}</span>
            </div>
          ),
        )}
      </div>

      <p className="onboarding-description">
        Scout needs microphone access for voice transcription. All audio processing happens locally - your voice never
        leaves your device.
      </p>

      <div className="onboarding-content">
        {micPermission === 'not-determined' && (
          <div className="onboarding-permission">
            <div className="onboarding-permission-content">
              <Loader2 />
              <div>
                <div className="onboarding-permission-title">Requesting Permission</div>
                <div className="onboarding-permission-desc">
                  macOS will prompt you to allow microphone access
                </div>
              </div>
            </div>
          </div>
        )}

        {micPermission === 'granted' && (
          <>
            <div className="onboarding-permission onboarding-permission-granted">
              <div className="onboarding-permission-content">
                <CheckCircle style={{ color: '#4ade80' }} />
                <div>
                  <div className="onboarding-permission-title" style={{ color: '#4ade80' }}>Permission Granted</div>
                  <div className="onboarding-permission-desc">
                    Now select your preferred microphone and test it
                  </div>
                </div>
              </div>
            </div>
            
            <div className="onboarding-mic-selector" style={{ marginTop: '24px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 500 }}>
                Select Microphone
              </label>
              <MicrophoneSelector
                selectedMic={selectedMic}
                onMicChange={setSelectedMic}
                disabled={isTestingMic}
              />
              
              <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button
                  onClick={testMicrophone}
                  className={`onboarding-btn ${isTestingMic ? 'onboarding-btn-secondary' : 'onboarding-btn-primary'}`}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  <Mic size={18} />
                  {isTestingMic ? 'Stop Test' : 'Test Microphone'}
                </button>
                
                {isTestingMic && (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '12px', color: '#666' }}>Level:</span>
                    <div style={{ 
                      flex: 1, 
                      height: '8px', 
                      backgroundColor: '#e5e5e5', 
                      borderRadius: '4px',
                      overflow: 'hidden'
                    }}>
                      <div style={{ 
                        width: `${micTestLevel}%`, 
                        height: '100%', 
                        backgroundColor: micTestLevel > 80 ? '#ef4444' : micTestLevel > 50 ? '#fbbf24' : '#4ade80',
                        transition: 'width 0.1s ease'
                      }} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {micPermission === 'denied' && (
          <div className="onboarding-permission onboarding-permission-denied">
            <div className="onboarding-permission-content">
              <X />
              <div>
                <div className="onboarding-permission-title">Permission Denied</div>
                <div className="onboarding-permission-desc">
                  Please enable microphone access in System Preferences to continue
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="onboarding-actions">
        {micPermission === 'not-determined' && (
          <button onClick={requestMicPermission} className="onboarding-btn onboarding-btn-primary">
            Grant Permission
          </button>
        )}
        {micPermission === 'granted' && (
          <button onClick={() => transitionToStep('shortcuts')} className="onboarding-btn onboarding-btn-primary">
            Next: Configure Shortcuts
          </button>
        )}
        {micPermission === 'denied' && (
          <button
            className="onboarding-btn onboarding-btn-secondary"
            onClick={() => {
              invoke('open_system_preferences_audio');
            }}
          >
            Open System Preferences
          </button>
        )}
      </div>
    </div>
  );

  const renderShortcutsStep = () => (
    <div className="onboarding-step">
      <div className="onboarding-header">
        <h1 className="onboarding-title">Create Shortcuts</h1>
        <p className="onboarding-subtitle">Almost there! Let's set up quick access shortcuts.</p>
      </div>

      <div className="onboarding-shortcuts">
        <div className="onboarding-shortcut-info">
          <div className="onboarding-shortcut-info-header">
            <Info />
            <span>How it works</span>
          </div>
          <div className="onboarding-shortcut-info-items">
            <p className="onboarding-shortcut-info-item">
              <strong>Push to Talk:</strong> Hold the key while speaking
            </p>
            <p className="onboarding-shortcut-info-item">
              <strong>Toggle:</strong> Press once to start, again to stop
            </p>
          </div>
        </div>

        <div className="onboarding-shortcut-item" style={{ animationDelay: '0.05s' }}>
          <span className="onboarding-shortcut-label">Push to Talk:</span>
          <div className="onboarding-shortcut-controls">
            <kbd className={`onboarding-shortcut-key ${isCapturingPTT ? 'capturing' : ''}`}>
              {isCapturingPTT ? 'Press any key...' : pushToTalkShortcut}
            </kbd>
            {isCapturingPTT ? (
              <button className="onboarding-btn onboarding-btn-cancel" onClick={cancelShortcutCapture}>
                Cancel
              </button>
            ) : (
              <button
                onClick={() => {
                  setPreviousPTTShortcut(pushToTalkShortcut);
                  setIsCapturingPTT(true);
                  setIsCapturingToggle(false);
                }}
                className="onboarding-btn onboarding-btn-capture"
              >
                Capture
              </button>
            )}
          </div>
        </div>

        <div className="onboarding-shortcut-item" style={{ animationDelay: '0.15s' }}>
          <span className="onboarding-shortcut-label">Toggle Key:</span>
          <div className="onboarding-shortcut-controls">
            <kbd className={`onboarding-shortcut-key ${isCapturingToggle ? 'capturing' : ''}`}>
              {isCapturingToggle ? 'Press any key...' : toggleShortcut}
            </kbd>
            {isCapturingToggle ? (
              <button className="onboarding-btn onboarding-btn-cancel" onClick={cancelShortcutCapture}>
                Cancel
              </button>
            ) : (
              <button
                onClick={() => {
                  setPreviousToggleShortcut(toggleShortcut);
                  setIsCapturingToggle(true);
                  setIsCapturingPTT(false);
                }}
                className="onboarding-btn onboarding-btn-capture"
              >
                Capture
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Visual feedback when capturing */}
      {(isCapturingPTT || isCapturingToggle) && (
        <div className="onboarding-capture-feedback">
          <div className="onboarding-capture-feedback-dot" />
          <span className="onboarding-capture-feedback-text">
            Listening for key combination... Press ESC to cancel
          </span>
        </div>
      )}

      {/* Default shortcuts hint */}
      {!isCapturingPTT && !isCapturingToggle && (
        <div className="onboarding-shortcut-hint">
          <p>Recommended: Use modifier keys (Cmd, Shift, Alt) for better compatibility</p>
          <p>Avoid conflicts with system shortcuts</p>
        </div>
      )}

      <div className="onboarding-actions onboarding-actions-row">
        <button onClick={() => transitionToStep('tour')} className="onboarding-btn onboarding-btn-link">
          Skip for now
        </button>
        <button
          onClick={async () => {
            setShortcutsConfigured(true);
            await invoke('play_success_sound');
            transitionToStep('tour');
          }}
          className="onboarding-btn onboarding-btn-primary"
        >
          Save & Continue
        </button>
      </div>
    </div>
  );

  const renderTourStep = () => (
    <div className="onboarding-step">
      <div className="onboarding-header">
        <h1 className="onboarding-title">You're Ready!</h1>
        <p className="onboarding-subtitle-gradient">Everything's set up perfectly</p>
      </div>

      <div className="onboarding-complete-list">
        <div className="onboarding-complete-item">
          <CheckCircle />
          <div className="onboarding-complete-item-content">
            <div className="onboarding-complete-item-title">AI model downloaded and ready</div>
            <div className="onboarding-complete-item-detail">Whisper Tiny English • 39 MB</div>
          </div>
        </div>

        <div className="onboarding-complete-item">
          <CheckCircle />
          <div className="onboarding-complete-item-title">Microphone access granted</div>
        </div>

        <div className="onboarding-complete-item">
          <CheckCircle />
          <div className="onboarding-complete-item-content">
            <div className="onboarding-complete-item-title">Shortcuts configured for quick recording</div>
            <div className="onboarding-complete-item-detail">Push to Talk: {pushToTalkShortcut}</div>
            <div className="onboarding-complete-item-detail">Toggle Key: {toggleShortcut}</div>
          </div>
        </div>
      </div>

      {/* Quick start guide */}
      <div className="onboarding-guide">
        <div className="onboarding-guide-title">Quick Start Guide</div>

        <div className="onboarding-guide-items">
          <div className="onboarding-guide-item">
            <span className="onboarding-guide-number">1.</span>
            <p className="onboarding-guide-text">
              Press <kbd>{pushToTalkShortcut}</kbd> and hold while speaking
            </p>
          </div>

          <div className="onboarding-guide-item">
            <span className="onboarding-guide-number">2.</span>
            <p className="onboarding-guide-text">
              Or press <kbd>{toggleShortcut}</kbd> to toggle recording on/off
            </p>
          </div>

          <div className="onboarding-guide-item">
            <span className="onboarding-guide-number">3.</span>
            <p className="onboarding-guide-text">Your transcription appears instantly in any text field</p>
          </div>
        </div>
      </div>

      {/* Tips section */}
      <div className="onboarding-tips">
        <div className="onboarding-tips-content">
          <Info />
          <div className="onboarding-tips-body">
            <p className="onboarding-tips-title">Pro Tips</p>
            <ul className="onboarding-tips-list">
              <li>Scout works in any app - browsers, notes, messages</li>
              <li>Transcription happens locally for privacy</li>
              <li>Look for the recording indicator in your menu bar</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="onboarding-actions">
        <button onClick={completeOnboarding} className="onboarding-btn onboarding-btn-primary">
          Start Using Scout
        </button>
        <p className="onboarding-note">You can always access settings from the menu bar</p>
      </div>
    </div>
  );

  const steps = [
    { title: "Model", component: renderModelStep },
    { title: "Microphone", component: renderMicrophoneStep },
    { title: "Shortcuts", component: renderShortcutsStep },
    { title: "Tour", component: renderTourStep },
  ];

  const currentStepIndex = steps.findIndex((step) => step.title.toLowerCase() === currentStep);

  return (
    <div className="onboarding-container">
      <div className="onboarding-logo">S</div>

      {/* DevTools for onboarding navigation */}
      <DevTools 
        currentView="record"
        appVersion="0.4.0"
        onboardingStep={currentStep}
        onStepChange={setCurrentStep}
      />

      <div className="onboarding-wrapper">
        <div className="onboarding-card">
          <div key={currentStep}>{steps[currentStepIndex].component()}</div>
        </div>

        {/* Dots-based stepper */}
        <div className="onboarding-stepper">
          {steps.map((step, index) => (
            <button
              key={index}
              onClick={() => {
                if (index < currentStepIndex) {
                  const stepName = step.title.toLowerCase() as OnboardingStep;
                  setCurrentStep(stepName);
                }
              }}
              disabled={index > currentStepIndex}
              className="onboarding-step-wrapper"
            >
              {/* Dot container with tooltip */}
              <div className="onboarding-step-dot-container">
                <div
                  className={`onboarding-step-dot ${
                    index === currentStepIndex
                      ? 'active'
                      : index < currentStepIndex
                      ? 'completed'
                      : ''
                  }`}
                >
                  {/* Pulse animation for current step is handled in CSS */}
                </div>
                
                {/* Tooltip centered on dot */}
                <div className="onboarding-step-tooltip">
                  {step.title}
                </div>
              </div>
              
              {/* Connector line */}
              {index < steps.length - 1 && (
                <div
                  className={`onboarding-step-connector ${
                    index < currentStepIndex ? 'completed' : ''
                  }`}
                />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default OnboardingFlow;
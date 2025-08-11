import React, { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { safeEventListen } from '../lib/safeEventListener';
import { CheckCircle, X, AlertCircle, Info, Download, Loader2 } from 'lucide-react';
import { DevTools } from './DevTools';
import './OnboardingFlowNew.css';

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
  const activeListenerRef = useRef<(() => void) | null>(null);
  
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
      setTimeout(() => setCurrentStep('microphone'), 1000);
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
        setTimeout(() => setCurrentStep('shortcuts'), 1000);
      }
    } catch (error) {
      console.error('Failed to request microphone permission:', error);
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
    <div className="onboarding-new-step">
      <div className="onboarding-new-header">
        <h1 className="onboarding-new-title">Welcome to Scout</h1>
        <p className="onboarding-new-subtitle">
          Instant, private transcription—everything stays on your Mac.
        </p>
      </div>

      <div className="onboarding-new-features">
        {["Runs entirely on your Mac", "No audio ever leaves the device", "Works offline"].map((feature, index) => (
          <div key={index} className="onboarding-new-feature" style={{ animationDelay: `${index * 150}ms` }}>
            <CheckCircle />
            <span>{feature}</span>
          </div>
        ))}
      </div>

      <div className="onboarding-new-content">
        <p className="onboarding-new-description">
          Download the AI model to enable transcription:
        </p>

        <div className="onboarding-new-model-details">
          <div className="onboarding-new-model-detail">
            <span className="onboarding-new-model-detail-label">File:</span>
            <span className="onboarding-new-model-detail-value">ggml-tiny.en.bin (39 MB)</span>
          </div>
          <div className="onboarding-new-model-detail">
            <span className="onboarding-new-model-detail-label">Source:</span>
            <span className="onboarding-new-model-detail-value">huggingface.co/whisper</span>
          </div>
        </div>

        {downloadStatus === 'complete' && (
          <div className="onboarding-new-success">
            <CheckCircle />
            <span className="onboarding-new-success-text">
              Model downloaded successfully! Ready for transcription.
            </span>
          </div>
        )}

        {downloadStatus === 'downloading' && downloadProgress && (
          <div className="onboarding-new-progress">
            <div className="onboarding-new-progress-bar">
              <div className="onboarding-new-progress-fill" style={{ width: `${downloadProgress.progress}%` }} />
            </div>
            <div className="onboarding-new-progress-text">
              {downloadProgress.downloadedMb.toFixed(1)} / {downloadProgress.totalMb.toFixed(1)} MB
            </div>
          </div>
        )}

        {downloadStatus === 'downloading' && !downloadProgress && (
          <div className="onboarding-new-loading">
            <Loader2 />
            <span className="onboarding-new-loading-text">Installing...</span>
          </div>
        )}

        {downloadStatus === 'error' && (
          <div className="onboarding-new-error">
            <div className="onboarding-new-error-message">
              <AlertCircle />
              <span>Download failed: {downloadError}</span>
            </div>
            <button className="onboarding-new-btn onboarding-new-btn-secondary" onClick={startModelDownload}>
              Retry Download
            </button>
          </div>
        )}
      </div>

      <div className="onboarding-new-actions">
        {downloadStatus === 'idle' && (
          <>
            <button
              onClick={startModelDownload}
              className="onboarding-new-btn onboarding-new-btn-primary"
            >
              <Download className="inline mr-1" style={{ width: '12px', height: '12px' }} />
              Download model (39 MB)
            </button>
            <p className="onboarding-new-note">You can always download a better model later.</p>
          </>
        )}
        {downloadStatus === 'complete' && (
          <>
            <button
              onClick={() => setCurrentStep('microphone')}
              className="onboarding-new-btn onboarding-new-btn-primary"
            >
              Next: Set Up Microphone
            </button>
            <p className="onboarding-new-note">You can always download a better model later.</p>
          </>
        )}
      </div>
    </div>
  );

  const renderMicrophoneStep = () => (
    <div className="onboarding-new-step">
      <div className="onboarding-new-header">
        <h1 className="onboarding-new-title">Microphone Permission</h1>
        <p className="onboarding-new-subtitle">
          Now let's enable voice recording to start transcribing.
        </p>
      </div>

      <div className="onboarding-new-features">
        {["All processing happens locally on your Mac", "You control when recording starts and stops"].map(
          (feature, index) => (
            <div key={index} className="onboarding-new-feature">
              <CheckCircle />
              <span>{feature}</span>
            </div>
          ),
        )}
      </div>

      <p className="onboarding-new-description">
        Scout needs microphone access for voice transcription. All audio processing happens locally - your voice never
        leaves your device.
      </p>

      <div className="onboarding-new-content">
        {micPermission === 'not-determined' && (
          <div className="onboarding-new-permission">
            <div className="onboarding-new-permission-content">
              <Loader2 />
              <div>
                <div className="onboarding-new-permission-title">Requesting Permission</div>
                <div className="onboarding-new-permission-desc">
                  macOS will prompt you to allow microphone access
                </div>
              </div>
            </div>
          </div>
        )}

        {micPermission === 'granted' && (
          <div className="onboarding-new-permission onboarding-new-permission-granted">
            <div className="onboarding-new-permission-content">
              <CheckCircle />
              <div>
                <div className="onboarding-new-permission-title">Permission Granted</div>
                <div className="onboarding-new-permission-desc">
                  Scout can now access your microphone for transcription
                </div>
              </div>
            </div>
          </div>
        )}

        {micPermission === 'denied' && (
          <div className="onboarding-new-permission onboarding-new-permission-denied">
            <div className="onboarding-new-permission-content">
              <X />
              <div>
                <div className="onboarding-new-permission-title">Permission Denied</div>
                <div className="onboarding-new-permission-desc">
                  Please enable microphone access in System Preferences to continue
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="onboarding-new-actions">
        {micPermission === 'not-determined' && (
          <button onClick={requestMicPermission} className="onboarding-new-btn onboarding-new-btn-primary">
            Grant Permission
          </button>
        )}
        {micPermission === 'granted' && (
          <button onClick={() => setCurrentStep('shortcuts')} className="onboarding-new-btn onboarding-new-btn-primary">
            Next: Configure Shortcuts
          </button>
        )}
        {micPermission === 'denied' && (
          <button
            className="onboarding-new-btn onboarding-new-btn-secondary"
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
    <div className="onboarding-new-step">
      <div className="onboarding-new-header">
        <h1 className="onboarding-new-title">Create Shortcuts</h1>
        <p className="onboarding-new-subtitle">Almost there! Let's set up quick access shortcuts.</p>
      </div>

      <div className="onboarding-new-shortcuts">
        <div className="onboarding-new-shortcut-info">
          <div className="onboarding-new-shortcut-info-header">
            <Info />
            <span>How it works</span>
          </div>
          <div className="onboarding-new-shortcut-info-items">
            <p className="onboarding-new-shortcut-info-item">
              <strong>Push to Talk:</strong> Hold the key while speaking
            </p>
            <p className="onboarding-new-shortcut-info-item">
              <strong>Toggle:</strong> Press once to start, again to stop
            </p>
          </div>
        </div>

        <div className="onboarding-new-shortcut-item">
          <span className="onboarding-new-shortcut-label">Push to Talk:</span>
          <div className="onboarding-new-shortcut-controls">
            <kbd className={`onboarding-new-shortcut-key ${isCapturingPTT ? 'capturing' : ''}`}>
              {isCapturingPTT ? 'Press any key...' : pushToTalkShortcut}
            </kbd>
            {isCapturingPTT ? (
              <button className="onboarding-new-btn onboarding-new-btn-cancel" onClick={cancelShortcutCapture}>
                Cancel
              </button>
            ) : (
              <button
                onClick={() => {
                  setPreviousPTTShortcut(pushToTalkShortcut);
                  setIsCapturingPTT(true);
                  setIsCapturingToggle(false);
                }}
                className="onboarding-new-btn onboarding-new-btn-capture"
              >
                Capture
              </button>
            )}
          </div>
        </div>

        <div className="onboarding-new-shortcut-item">
          <span className="onboarding-new-shortcut-label">Toggle Key:</span>
          <div className="onboarding-new-shortcut-controls">
            <kbd className={`onboarding-new-shortcut-key ${isCapturingToggle ? 'capturing' : ''}`}>
              {isCapturingToggle ? 'Press any key...' : toggleShortcut}
            </kbd>
            {isCapturingToggle ? (
              <button className="onboarding-new-btn onboarding-new-btn-cancel" onClick={cancelShortcutCapture}>
                Cancel
              </button>
            ) : (
              <button
                onClick={() => {
                  setPreviousToggleShortcut(toggleShortcut);
                  setIsCapturingToggle(true);
                  setIsCapturingPTT(false);
                }}
                className="onboarding-new-btn onboarding-new-btn-capture"
              >
                Capture
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Visual feedback when capturing */}
      {(isCapturingPTT || isCapturingToggle) && (
        <div className="onboarding-new-capture-feedback">
          <div className="onboarding-new-capture-feedback-dot" />
          <span className="onboarding-new-capture-feedback-text">
            Listening for key combination... Press ESC to cancel
          </span>
        </div>
      )}

      {/* Default shortcuts hint */}
      {!isCapturingPTT && !isCapturingToggle && (
        <div className="onboarding-new-shortcut-hint">
          <p>Recommended: Use modifier keys (Cmd, Shift, Alt) for better compatibility</p>
          <p>Avoid conflicts with system shortcuts</p>
        </div>
      )}

      <div className="onboarding-new-actions onboarding-new-actions-row">
        <button onClick={() => setCurrentStep('tour')} className="onboarding-new-btn onboarding-new-btn-link">
          Skip for now
        </button>
        <button
          onClick={() => {
            setShortcutsConfigured(true);
            setCurrentStep('tour');
          }}
          className="onboarding-new-btn onboarding-new-btn-primary"
        >
          Save & Continue
        </button>
      </div>
    </div>
  );

  const renderTourStep = () => (
    <div className="onboarding-new-step">
      <div className="onboarding-new-header">
        <h1 className="onboarding-new-title">You're Ready!</h1>
        <p className="onboarding-new-subtitle-gradient">Everything's set up perfectly</p>
      </div>

      <div className="onboarding-new-complete-list">
        <div className="onboarding-new-complete-item">
          <CheckCircle />
          <div className="onboarding-new-complete-item-content">
            <div className="onboarding-new-complete-item-title">AI model downloaded and ready</div>
            <div className="onboarding-new-complete-item-detail">Whisper Tiny English • 39 MB</div>
          </div>
        </div>

        <div className="onboarding-new-complete-item">
          <CheckCircle />
          <div className="onboarding-new-complete-item-title">Microphone access granted</div>
        </div>

        <div className="onboarding-new-complete-item">
          <CheckCircle />
          <div className="onboarding-new-complete-item-content">
            <div className="onboarding-new-complete-item-title">Shortcuts configured for quick recording</div>
            <div className="onboarding-new-complete-item-detail">Push to Talk: {pushToTalkShortcut}</div>
            <div className="onboarding-new-complete-item-detail">Toggle Key: {toggleShortcut}</div>
          </div>
        </div>
      </div>

      {/* Quick start guide */}
      <div className="onboarding-new-guide">
        <div className="onboarding-new-guide-title">Quick Start Guide</div>

        <div className="onboarding-new-guide-items">
          <div className="onboarding-new-guide-item">
            <span className="onboarding-new-guide-number">1.</span>
            <p className="onboarding-new-guide-text">
              Press <kbd>{pushToTalkShortcut}</kbd> and hold while speaking
            </p>
          </div>

          <div className="onboarding-new-guide-item">
            <span className="onboarding-new-guide-number">2.</span>
            <p className="onboarding-new-guide-text">
              Or press <kbd>{toggleShortcut}</kbd> to toggle recording on/off
            </p>
          </div>

          <div className="onboarding-new-guide-item">
            <span className="onboarding-new-guide-number">3.</span>
            <p className="onboarding-new-guide-text">Your transcription appears instantly in any text field</p>
          </div>
        </div>
      </div>

      {/* Tips section */}
      <div className="onboarding-new-tips">
        <div className="onboarding-new-tips-content">
          <Info />
          <div className="onboarding-new-tips-body">
            <p className="onboarding-new-tips-title">Pro Tips</p>
            <ul className="onboarding-new-tips-list">
              <li>Scout works in any app - browsers, notes, messages</li>
              <li>Transcription happens locally for privacy</li>
              <li>Look for the recording indicator in your menu bar</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="onboarding-new-actions">
        <button onClick={completeOnboarding} className="onboarding-new-btn onboarding-new-btn-primary">
          Start Using Scout
        </button>
        <p className="onboarding-new-note">You can always access settings from the menu bar</p>
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
    <div className="onboarding-new-container">
      <div className="onboarding-new-logo">S</div>

      {/* DevTools for onboarding navigation */}
      <DevTools 
        currentView="record"
        appVersion="0.4.0"
        onboardingStep={currentStep}
        onStepChange={setCurrentStep}
      />

      <div className="onboarding-new-wrapper">
        <div className="onboarding-new-card">
          <div key={currentStep}>{steps[currentStepIndex].component()}</div>
        </div>

        {/* Dots-based stepper */}
        <div className="onboarding-new-stepper">
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
              className="onboarding-new-step-wrapper"
            >
              {/* Dot container with tooltip */}
              <div className="onboarding-new-step-dot-container">
                <div
                  className={`onboarding-new-step-dot ${
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
                <div className="onboarding-new-step-tooltip">
                  {step.title}
                </div>
              </div>
              
              {/* Connector line */}
              {index < steps.length - 1 && (
                <div
                  className={`onboarding-new-step-connector ${
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
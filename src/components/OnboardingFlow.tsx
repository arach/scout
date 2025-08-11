import React, { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { safeEventListen } from '../lib/safeEventListener';
import { Check, X, AlertCircle, Info } from 'lucide-react';
import soundwaveImage from '../assets/soundwave.png';
import { Tooltip } from './Tooltip';
import { DevTools } from './DevTools';
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
        
        // Shortcuts loaded from backend are considered captured
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
      setCurrentStep('microphone');
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
      // Don't reset pttCaptured state - keep previous capture status
    } else if (isCapturingToggle) {
      setToggleShortcut(previousToggleShortcut);
      setIsCapturingToggle(false);
      // Don't reset toggleCaptured state - keep previous capture status
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
    <>
      <div className="step-header">
        <h1 className="step-title">Welcome to Scout</h1>
        <p className="step-subtitle subtitle">Instant, private transcription—everything stays on your Mac.</p>
      </div>
      
      <div className="step-features">
        <div className="step-feature">
          <Check size={16} /> Runs entirely on your Mac
        </div>
        <div className="step-feature">
          <Check size={16} /> No audio ever leaves the device
        </div>
        <div className="step-feature">
          <Check size={16} /> Works offline
        </div>
      </div>
      
      <div className="step-content">
        <p className="step-description subtitle">
          Download the AI model to enable transcription:
        </p>
        
        <div className="model-download-details">
          <div className="model-detail-item">
            <strong>File:</strong> ggml-tiny.en.bin (39 MB)
          </div>
          <div className="model-detail-item">
            <strong>Source:</strong> 
            <code>https://huggingface.co/ggerganov/whisper.cpp</code>
            <a href="https://huggingface.co/ggerganov/whisper.cpp" target="_blank" rel="noopener noreferrer" className="model-source-link" title="View on Hugging Face">
              ↗
            </a>
          </div>
        </div>

        {downloadStatus === 'complete' && (
          <div className="model-download-success">
            <div className="model-success-icon">
              <Check size={20} />
            </div>
            <div className="model-success-text">
              Model downloaded successfully! Ready for transcription.
            </div>
          </div>
        )}

        {downloadStatus === 'downloading' && downloadProgress && (
          <div className="model-download-progress">
            <div className="model-progress-bar">
              <div 
                className="model-progress-fill"
                style={{ width: `${downloadProgress.progress}%` }}
              />
            </div>
            <div className="model-progress-text">
              {downloadProgress.downloadedMb.toFixed(1)} / {downloadProgress.totalMb.toFixed(1)} MB
            </div>
          </div>
        )}

        {downloadStatus === 'downloading' && !downloadProgress && (
          <div className="model-download-initiating">
            <div className="loading-spinner" />
            <div className="model-progress-text">Installing...</div>
          </div>
        )}

        {downloadStatus === 'error' && (
          <div className="model-error-state">
            <AlertCircle size={20} />
            <p>Download failed: {downloadError}</p>
            <button className="btn-secondary" onClick={startModelDownload}>
              Retry Download
            </button>
          </div>
        )}
      </div>
      
      <div className="step-actions">
        {downloadStatus === 'idle' && (
          <>
            <button className="btn-primary" onClick={startModelDownload}>
              Download model (39 MB)
            </button>
            <div className="model-upgrade-note">
              You can always download a better model later.
            </div>
          </>
        )}
        {downloadStatus === 'complete' && (
          <>
            <button className="btn-primary" onClick={() => setCurrentStep('microphone')}>
              Continue
            </button>
            <div className="model-upgrade-note">
              You can always download a better model later.
            </div>
          </>
        )}
      </div>
    </>
  );

  const renderMicrophoneStep = () => (
    <>
      <div className="step-header">
        <h1 className="step-title">Microphone Permission</h1>
        <p className="step-subtitle subtitle">Enable voice recording for local transcription.</p>
      </div>
      
      <div className="step-features">
        <div className="step-feature">
          <Check size={16} /> All processing happens locally on your Mac
        </div>
        <div className="step-feature">
          <Check size={16} /> You control when recording starts and stops
        </div>
      </div>
      
      <div className="step-content">
        <p className="step-description subtitle">
          Scout needs microphone access for voice transcription. All audio processing happens locally - your voice never leaves your device.
        </p>
        
        <div className="permission-status-card">
          {micPermission === 'not-determined' && (
            <div className="permission-status-item permission-waiting">
              <div className="permission-status-icon">
                <div className="loading-spinner" />
              </div>
              <div className="permission-status-content">
                <div className="permission-status-title">Requesting Permission</div>
                <div className="permission-status-description">macOS will prompt you to allow microphone access</div>
              </div>
            </div>
          )}
          {micPermission === 'granted' && (
            <div className="permission-status-item permission-granted">
              <div className="permission-status-icon">
                <Check size={20} />
              </div>
              <div className="permission-status-content">
                <div className="permission-status-title">Permission Granted</div>
                <div className="permission-status-description">Scout can now access your microphone for transcription</div>
              </div>
            </div>
          )}
          {micPermission === 'denied' && (
            <div className="permission-status-item permission-denied">
              <div className="permission-status-icon">
                <X size={20} />
              </div>
              <div className="permission-status-content">
                <div className="permission-status-title">Permission Denied</div>
                <div className="permission-status-description">Please enable microphone access in System Preferences to continue</div>
              </div>
            </div>
          )}
        </div>
      </div>
      
      <div className="step-actions">
        {micPermission === 'not-determined' && (
          <button className="btn-primary" onClick={requestMicPermission}>
            Grant Permission
          </button>
        )}
        {micPermission === 'granted' && (
          <button className="btn-primary" onClick={() => setCurrentStep('shortcuts')}>
            Continue
          </button>
        )}
        {micPermission === 'denied' && (
          <button className="btn-secondary" onClick={() => {
            invoke('open_system_preferences_audio');
          }}>
            Open System Preferences
          </button>
        )}
      </div>
    </>
  );

  const renderShortcutsStep = () => (
    <>
      <div className="step-header shortcuts-step-header">
        <h1 className="step-title">Create Shortcuts</h1>
        <p className="step-subtitle subtitle">Set up keyboard shortcuts for quick voice recording.</p>
      </div>
      
      <div className="step-content">
        <div className="shortcuts-config">
          <div className="shortcut-item">
            <label>Push to Talk:</label>
            <kbd className={isCapturingPTT ? 'shortcut-capturing' : ''}>
              {isCapturingPTT ? 'Press any key...' : pushToTalkShortcut}
            </kbd>
            <div className="shortcut-actions">
              {isCapturingPTT ? (
                <button 
                  className="btn-cancel"
                  onClick={cancelShortcutCapture}
                >
                  Cancel
                </button>
              ) : (
                <button 
                  className="btn-capture"
                  onClick={() => {
                    setPreviousPTTShortcut(pushToTalkShortcut);
                    setIsCapturingPTT(true);
                    setIsCapturingToggle(false);
                  }}
                >
                  Capture
                </button>
              )}
            </div>
          </div>
          <div className="shortcut-item">
            <label>Toggle Key:</label>
            <kbd className={isCapturingToggle ? 'shortcut-capturing' : ''}>
              {isCapturingToggle ? 'Press any key...' : toggleShortcut}
            </kbd>
            <div className="shortcut-actions">
              {isCapturingToggle ? (
                <button 
                  className="btn-cancel"
                  onClick={cancelShortcutCapture}
                >
                  Cancel
                </button>
              ) : (
                <button 
                  className="btn-capture"
                  onClick={() => {
                    setPreviousToggleShortcut(toggleShortcut);
                    setIsCapturingToggle(true);
                    setIsCapturingPTT(false);
                  }}
                >
                  Capture
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="step-actions">
        <button className="btn-link" onClick={() => setCurrentStep('tour')}>
          Skip for now
        </button>
        <button 
          className="btn-primary" 
          onClick={() => {
            setShortcutsConfigured(true);
            setCurrentStep('tour');
          }}
          disabled={!pushToTalkShortcut || !toggleShortcut}
        >
          Continue
        </button>
      </div>
    </>
  );

  const renderTourStep = () => {
    const canFinish = downloadStatus === 'complete';
    
    return (
      <>
        <div className="step-header">
          <h1 className="step-title">You're Ready!</h1>
          <p className="step-subtitle subtitle">Scout is configured and ready for voice transcription.</p>
        </div>
        
        <div className="step-features">
          <div className="step-feature completion-feature-with-subitems">
            AI model downloaded and ready
            <div className="completion-feature-checkmark">✓</div>
            
          </div>
          <div className="completion-feature-subitems">
              <div className="completion-subitem model-subitem">
                <div className="completion-subitem-model">Whisper Tiny English • 39 MB</div>
              </div>
            </div>
          <div className="step-feature">
            Microphone access granted
            <div className="completion-feature-checkmark">✓</div>
          </div>
          <div className="step-feature completion-feature-with-subitems">
            Shortcuts configured for quick recording
            <div className="completion-feature-checkmark">✓</div>
            
          </div>
          <div className="completion-feature-subitems">
              <div className="completion-subitem">
                <span className="completion-subitem-label">Push to Talk:</span>
                <div className="completion-subitem-field">{pushToTalkShortcut}</div>
              </div>
              <div className="completion-subitem">
                <span className="completion-subitem-label">Toggle Key:</span>
                <div className="completion-subitem-field">{toggleShortcut}</div>
              </div>
            </div>
        </div>
        
        <div className="step-content">
          <div className="onboarding-final-tips-container">
            <div className="onboarding-final-tip-item onboarding-final-tip-cta">
              <Info size={16} className="tip-icon" />
              Try your shortcuts now to get started!
            </div>
          </div>
        </div>

        <div className="step-actions">
          <button 
            className="btn-primary" 
            onClick={completeOnboarding}
            disabled={!canFinish}
          >
            {canFinish ? 'Finish Setup' : 'Waiting for download...'}
          </button>
        </div>
      </>
    );
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 'model': return renderModelStep();
      case 'microphone': return renderMicrophoneStep();
      case 'shortcuts': return renderShortcutsStep();
      case 'tour': return renderTourStep();
    }
  };

  return (
    <div className="onboarding-overlay">
      {/* Background image */}
      <div className="onboarding-background">
        <img 
          src={soundwaveImage} 
          alt="Voice visualization in glass dome"
          className="onboarding-soundwave-image"
        />
      </div>

      {/* DevTools for onboarding navigation */}
      <DevTools 
        currentView="record"
        appVersion="0.4.0"
        onboardingStep={currentStep}
        onStepChange={setCurrentStep}
      />

      {/* Content container */}
      <div className="onboarding-content-container">
        {/* Wrapper to center glass card while allowing indicators positioning */}
        <div className="onboarding-glass-wrapper">
          <div className="onboarding-step-indicators">
          <Tooltip content="Download AI model" placement="right">
            <button 
              className={`step-indicator ${currentStep === 'model' ? 'indicator-active' : 'indicator-completed'}`} 
              onClick={() => setCurrentStep('model')}
              disabled={false}
            >
              {currentStep !== 'model' ? <Check size={14} /> : '1'}
            </button>
          </Tooltip>
          <div className={`step-indicator-connector ${downloadStatus === 'complete' ? 'connector-completed' : ''}`} />
          <Tooltip content="Grant microphone permission" placement="right">
            <button 
              className={`step-indicator ${currentStep === 'microphone' ? 'indicator-active' : ''} ${downloadStatus === 'complete' ? (currentStep === 'microphone' ? 'indicator-active' : 'indicator-completed') : ''}`} 
              onClick={() => downloadStatus === 'complete' && setCurrentStep('microphone')}
              disabled={downloadStatus !== 'complete'}
            >
              {downloadStatus === 'complete' && currentStep !== 'microphone' ? <Check size={14} /> : 
               currentStep === 'microphone' ? '2' : '2'}
            </button>
          </Tooltip>
          <div className={`step-indicator-connector ${micPermission === 'granted' ? 'connector-completed' : ''}`} />
          <Tooltip content="Configure keyboard shortcuts" placement="right">
            <button 
              className={`step-indicator ${currentStep === 'shortcuts' ? 'indicator-active' : ''} ${micPermission === 'granted' ? (currentStep === 'shortcuts' ? 'indicator-active' : 'indicator-completed') : ''}`} 
              onClick={() => micPermission === 'granted' && setCurrentStep('shortcuts')}
              disabled={micPermission !== 'granted'}
            >
              {micPermission === 'granted' && currentStep !== 'shortcuts' ? <Check size={14} /> : 
               currentStep === 'shortcuts' ? '3' : '3'}
            </button>
          </Tooltip>
          <div className={`step-indicator-connector ${shortcutsConfigured || currentStep === 'tour' ? 'connector-completed' : ''}`} />
          <Tooltip content="Learn tips and shortcuts" placement="right">
            <button 
              className={`step-indicator ${currentStep === 'tour' ? 'indicator-active' : ''} ${shortcutsConfigured || currentStep === 'tour' ? (currentStep === 'tour' ? 'indicator-active' : 'indicator-completed') : ''}`} 
              onClick={() => (shortcutsConfigured || currentStep === 'tour') && setCurrentStep('tour')}
              disabled={!shortcutsConfigured && currentStep !== 'tour'}
            >
              {(shortcutsConfigured || currentStep === 'tour') && currentStep !== 'tour' ? <Check size={14} /> : 
               currentStep === 'tour' ? '4' : '4'}
            </button>
          </Tooltip>
        </div>
        
          <div className="onboarding-glass-card">
            {renderStepContent()}
          </div>
        </div>
      </div>
    </div>
  );
};
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { safeEventListen } from '../lib/safeEventListener';
import { Download, Mic, Keyboard, Sparkles, Check, X, AlertCircle } from 'lucide-react';
import soundwaveImage from '../assets/soundwave.png';
import './OnboardingFlow.css';

interface OnboardingFlowProps {
  onComplete: () => void;
}

interface DownloadProgress {
  progress: number;
  downloadedMb: number;
  totalMb: number;
}

type PermissionStatus = 'granted' | 'denied' | 'not-determined';
type OnboardingStep = 'model' | 'microphone' | 'shortcuts' | 'tour';

export const OnboardingFlow: React.FC<OnboardingFlowProps> = ({ onComplete }) => {
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('model');
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'downloading' | 'complete' | 'error'>('idle');
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [micPermission, setMicPermission] = useState<PermissionStatus>('not-determined');
  const [shortcutsConfigured, setShortcutsConfigured] = useState(false);
  const [pushToTalkShortcut, setPushToTalkShortcut] = useState('Cmd+Shift+Space');
  const [toggleShortcut, setToggleShortcut] = useState('Cmd+Shift+R');
  const [isCapturingPTT, setIsCapturingPTT] = useState(false);
  const [isCapturingToggle, setIsCapturingToggle] = useState(false);
  const activeListenerRef = useRef<(() => void) | null>(null);
  
  // Load current shortcuts on mount
  useEffect(() => {
    const loadShortcuts = async () => {
      try {
        const [ptt, toggle] = await Promise.all([
          invoke<string>('get_push_to_talk_shortcut'),
          invoke<string>('get_current_shortcut')
        ]);
        setPushToTalkShortcut(ptt.replace('CmdOrCtrl', 'Cmd'));
        setToggleShortcut(toggle.replace('CmdOrCtrl', 'Cmd'));
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
      
      // Remove auto-advance to let user see the granted state and manually continue
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
      onComplete();
    } catch (error) {
      console.error('Failed to mark onboarding complete:', error);
    }
  };

  const renderModelStep = () => (
    <div className="onboarding-step welcome-step">
      <div className="welcome-visual">
        <img 
          src={soundwaveImage} 
          alt="Voice visualization in glass dome"
          className="soundwave-hero"
        />
      </div>
      <div className="welcome-content">
          <div className="model-info">
            <h1 className="welcome-title">Welcome to Scout</h1>
            <p className="welcome-subtitle">Private. Local. Lightning-fast transcription.</p>
            
            <div className="info-features">
              <div className="feature">
                <Check /> All processing happens locally on your Mac
              </div>
              <div className="feature">
                <Check /> Your audio never leaves your device
              </div>
              <div className="feature">
                <Check /> No internet connection required
              </div>
            </div>
            
            <p className="step-description">Let's start by downloading your first lightweight AI model to power your transcriptions:</p>
            
            <div className="model-details">
              <div className="info-item">
                <strong>File:</strong> ggml-tiny.en.bin (39 MB)
              </div>
              <div className="info-item">
                <strong>Source:</strong> <code>https://huggingface.co/ggerganov/whisper.cpp</code>
              </div>
            </div>

            {downloadStatus === 'idle' && (
              <button className="btn-primary welcome-cta" onClick={startModelDownload}>
                Download & Continue
              </button>
            )}
            {downloadStatus === 'complete' && (
              <button className="btn-primary welcome-cta" disabled>
                ✓ Model Downloaded
              </button>
            )}
          </div>

          {downloadStatus === 'downloading' && (
            <div className="download-status">
              {downloadProgress ? (
                <>
                  <div className="progress-bar">
                    <div 
                      className="progress-fill"
                      style={{ width: `${downloadProgress.progress}%` }}
                    />
                  </div>
                  <div className="progress-text">
                    {downloadProgress.downloadedMb.toFixed(1)} / {downloadProgress.totalMb.toFixed(1)} MB
                  </div>
                </>
              ) : (
                <div className="download-initiating">
                  <div className="spinner" />
                  <div className="progress-text">Initiating download...</div>
                </div>
              )}
            </div>
          )}

          {downloadStatus === 'error' && (
            <div className="error-state">
              <AlertCircle size={20} />
              <p>Download failed: {downloadError}</p>
              <button className="btn-primary" onClick={startModelDownload}>
                Retry Download
              </button>
            </div>
          )}
      </div>
    </div>
  );

  const renderMicrophoneStep = () => (
    <div className="onboarding-step welcome-step">
      <div className="welcome-visual">
        <img 
          src={soundwaveImage} 
          alt="Voice visualization in glass dome"
          className="soundwave-hero"
        />
      </div>
      <div className="welcome-content">
        <div className="model-info">
          <h1 className="welcome-title">Microphone Permission</h1>
          <p className="welcome-subtitle">Enable voice recording for local transcription.</p>
          
          <div className="info-features">
            <div className="feature">
              <Check /> All processing happens locally on your Mac
            </div>
            <div className="feature">
              <Check /> You control when recording starts and stops
            </div>
          </div>
          
          <p className="step-description">Scout needs microphone access for voice transcription. All audio processing happens locally - your voice never leaves your device.</p>
          
          <div className="permission-status-card">
            {micPermission === 'not-determined' && (
              <div className="status-item status-waiting">
                <div className="status-icon">
                  <div className="spinner" />
                </div>
                <div className="status-content">
                  <div className="status-title">Requesting Permission</div>
                  <div className="status-description">macOS will prompt you to allow microphone access</div>
                </div>
              </div>
            )}
            {micPermission === 'granted' && (
              <div className="status-item status-granted">
                <div className="status-icon">
                  <Check size={24} />
                </div>
                <div className="status-content">
                  <div className="status-title">Permission Granted</div>
                  <div className="status-description">Scout can now access your microphone for transcription</div>
                </div>
              </div>
            )}
            {micPermission === 'denied' && (
              <div className="status-item status-denied">
                <div className="status-icon">
                  <X size={24} />
                </div>
                <div className="status-content">
                  <div className="status-title">Permission Denied</div>
                  <div className="status-description">Please enable microphone access in System Preferences to continue</div>
                </div>
              </div>
            )}
          </div>

          {micPermission === 'not-determined' && (
            <button className="btn-primary welcome-cta" onClick={requestMicPermission}>
              Grant Permission
            </button>
          )}
          {micPermission === 'granted' && (
            <button className="btn-primary welcome-cta" onClick={() => setCurrentStep('shortcuts')}>
              Continue
            </button>
          )}
          {micPermission === 'denied' && (
            <button className="btn-secondary welcome-cta" onClick={() => {
              // TODO: Open system preferences
              invoke('open_system_preferences_audio');
            }}>
              Open System Preferences
            </button>
          )}
        </div>
      </div>
    </div>
  );

  // Keyboard event handler for shortcut capture
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isCapturingPTT && !isCapturingToggle) return;
    
    e.preventDefault();
    e.stopPropagation();
    
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
  }, [isCapturingPTT, isCapturingToggle]);

  // Set up keyboard listener
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const renderShortcutsStep = () => (
    <div className="onboarding-step welcome-step">
      <div className="welcome-visual">
        <img 
          src={soundwaveImage} 
          alt="Voice visualization in glass dome"
          className="soundwave-hero"
        />
      </div>
      <div className="welcome-content">
        <div className="model-info">
          <h1 className="welcome-title">Create Shortcuts</h1>
          <p className="welcome-subtitle">Set up keyboard shortcuts for quick voice recording.</p>
          
          <div className="shortcuts-config">
            <div className="shortcut-item">
              <label>Push-to-Talk:</label>
              <kbd className={isCapturingPTT ? 'capturing' : ''}>
                {isCapturingPTT ? 'Press any key...' : pushToTalkShortcut}
              </kbd>
              <button 
                className="btn-text"
                onClick={() => {
                  setIsCapturingPTT(true);
                  setIsCapturingToggle(false);
                }}
              >
                Change
              </button>
            </div>
            <div className="shortcut-item">
              <label>Toggle Recording:</label>
              <kbd className={isCapturingToggle ? 'capturing' : ''}>
                {isCapturingToggle ? 'Press any key...' : toggleShortcut}
              </kbd>
              <button 
                className="btn-text"
                onClick={() => {
                  setIsCapturingToggle(true);
                  setIsCapturingPTT(false);
                }}
              >
                Change
              </button>
            </div>
          </div>

          <div className="step-actions">
            <button className="btn-link skip-link" onClick={() => setCurrentStep('tour')}>
              Skip for now
            </button>
            <button className="btn-primary welcome-cta" onClick={() => {
              setShortcutsConfigured(true);
              setCurrentStep('tour');
            }}>
              Continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderTourStep = () => {
    const canFinish = downloadStatus === 'complete';
    
    return (
      <div className="onboarding-step welcome-step">
        <div className="welcome-visual">
          <img 
            src={soundwaveImage} 
            alt="Voice visualization in glass dome"
            className="soundwave-hero"
          />
        </div>
        <div className="welcome-content">
          <div className="model-info">
            <h1 className="welcome-title">You're Ready!</h1>
            <p className="welcome-subtitle">Scout is configured and ready for voice transcription.</p>
            
            <div className="info-features">
              <div className="feature">
                <Check /> AI model downloaded and ready
              </div>
              <div className="feature">
                <Check /> Microphone access granted
              </div>
              <div className="feature">
                <Check /> Shortcuts configured for quick recording
              </div>
            </div>
            
            <div className="quick-reference">
              <div className="reference-item">
                <span className="reference-label">Push-to-Talk:</span>
                <kbd className="reference-shortcut">{pushToTalkShortcut}</kbd>
              </div>
              <div className="reference-item">
                <span className="reference-label">Toggle Recording:</span>
                <kbd className="reference-shortcut">{toggleShortcut}</kbd>
              </div>
            </div>

            <div className="download-status-final">
              {downloadStatus === 'complete' ? (
                <div className="status-complete">
                  <Check size={16} />
                  Model downloaded successfully!
                </div>
              ) : (
                <div className="status-downloading">
                  <div className="spinner-small" />
                  Downloading model... {downloadProgress?.progress.toFixed(0)}% complete
                </div>
              )}
            </div>

            <button 
              className="btn-primary welcome-cta" 
              onClick={completeOnboarding}
              disabled={!canFinish}
            >
              {canFinish ? 'Finish Setup' : 'Waiting for download...'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Download progress indicator (shown on all steps except first)
  const renderProgressIndicator = () => {
    if (currentStep === 'model' || downloadStatus !== 'downloading') return null;
    
    return (
      <div className="global-download-progress">
        <div className="mini-progress-bar">
          <div 
            className="mini-progress-fill"
            style={{ width: `${downloadProgress?.progress || 0}%` }}
          />
        </div>
        <span className="mini-progress-text">
          Downloading model... {downloadProgress?.progress.toFixed(0)}%
        </span>
      </div>
    );
  };

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-container">
        {renderProgressIndicator()}
        
        <div className="onboarding-content">
          {currentStep === 'model' && renderModelStep()}
          {currentStep === 'microphone' && renderMicrophoneStep()}
          {currentStep === 'shortcuts' && renderShortcutsStep()}
          {currentStep === 'tour' && renderTourStep()}
        </div>
        
        <div className="step-indicators">
          <button 
            className={`indicator ${currentStep === 'model' ? 'active' : 'completed'}`} 
            onClick={() => setCurrentStep('model')}
            disabled={false}
          >
            {currentStep !== 'model' ? <Check size={12} /> : null}
          </button>
          <div className={`indicator-connector ${downloadStatus === 'complete' ? 'completed' : ''}`} />
          <button 
            className={`indicator ${currentStep === 'microphone' ? 'active' : ''} ${downloadStatus === 'complete' ? (currentStep === 'microphone' ? 'active' : 'completed') : ''}`} 
            onClick={() => downloadStatus === 'complete' && setCurrentStep('microphone')}
            disabled={downloadStatus !== 'complete'}
          >
            {downloadStatus === 'complete' && currentStep !== 'microphone' ? <Check size={12} /> : null}
          </button>
          <div className={`indicator-connector ${micPermission === 'granted' ? 'completed' : ''}`} />
          <button 
            className={`indicator ${currentStep === 'shortcuts' ? 'active' : ''} ${micPermission === 'granted' ? (currentStep === 'shortcuts' ? 'active' : 'completed') : ''}`} 
            onClick={() => micPermission === 'granted' && setCurrentStep('shortcuts')}
            disabled={micPermission !== 'granted'}
          >
            {micPermission === 'granted' && currentStep !== 'shortcuts' ? <Check size={12} /> : null}
          </button>
          <div className={`indicator-connector ${shortcutsConfigured || currentStep === 'tour' ? 'completed' : ''}`} />
          <button 
            className={`indicator ${currentStep === 'tour' ? 'active' : ''} ${shortcutsConfigured || currentStep === 'tour' ? (currentStep === 'tour' ? 'active' : 'completed') : ''}`} 
            onClick={() => (shortcutsConfigured || currentStep === 'tour') && setCurrentStep('tour')}
            disabled={!shortcutsConfigured && currentStep !== 'tour'}
          >
            {(shortcutsConfigured || currentStep === 'tour') && currentStep !== 'tour' ? <Check size={12} /> : null}
          </button>
        </div>
      </div>
    </div>
  );
};
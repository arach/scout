import React, { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { safeEventListen } from '../lib/safeEventListener';
import { Download, Mic, Keyboard, Sparkles, Check, X, AlertCircle } from 'lucide-react';
import soundwaveImage from '../assets/soundwave.png';
import './OnboardingFlowNew.css';

interface OnboardingFlowNewProps {
  onComplete: () => void;
}

interface DownloadProgress {
  progress: number;
  downloadedMb: number;
  totalMb: number;
}

type PermissionStatus = 'granted' | 'denied' | 'not-determined';
type OnboardingStep = 'model' | 'microphone' | 'shortcuts' | 'tour';

export const OnboardingFlowNew: React.FC<OnboardingFlowNewProps> = ({ onComplete }) => {
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

  const renderModelStep = () => (
    <>
      <div className="new-step-header">
        <h1 className="new-step-title">Welcome to Scout</h1>
        <p className="new-step-subtitle">Private. Local. Lightning-fast transcription.</p>
      </div>
      
      <div className="new-step-features">
        <div className="new-feature">
          <Check size={16} /> All processing happens locally on your Mac
        </div>
        <div className="new-feature">
          <Check size={16} /> Your audio never leaves your device
        </div>
        <div className="new-feature">
          <Check size={16} /> No internet connection required
        </div>
      </div>
      
      <div className="new-step-content">
        <p className="new-step-description">
          Let's start by downloading your first lightweight AI model to power your transcriptions:
        </p>
        
        <div className="new-model-details">
          <div className="new-detail-item">
            <strong>File:</strong> ggml-tiny.en.bin (39 MB)
          </div>
          <div className="new-detail-item">
            <strong>Source:</strong> <code>https://huggingface.co/ggerganov/whisper.cpp</code>
          </div>
        </div>

        {downloadStatus === 'downloading' && downloadProgress && (
          <div className="new-download-progress">
            <div className="new-progress-bar">
              <div 
                className="new-progress-fill"
                style={{ width: `${downloadProgress.progress}%` }}
              />
            </div>
            <div className="new-progress-text">
              {downloadProgress.downloadedMb.toFixed(1)} / {downloadProgress.totalMb.toFixed(1)} MB
            </div>
          </div>
        )}

        {downloadStatus === 'downloading' && !downloadProgress && (
          <div className="new-download-initiating">
            <div className="new-spinner" />
            <div className="new-progress-text">Initiating download...</div>
          </div>
        )}

        {downloadStatus === 'error' && (
          <div className="new-error-state">
            <AlertCircle size={20} />
            <p>Download failed: {downloadError}</p>
            <button className="new-btn-secondary" onClick={startModelDownload}>
              Retry Download
            </button>
          </div>
        )}
      </div>
      
      <div className="new-step-actions">
        {downloadStatus === 'idle' && (
          <button className="new-btn-primary" onClick={startModelDownload}>
            Download & Continue
          </button>
        )}
        {downloadStatus === 'complete' && (
          <button className="new-btn-primary" disabled>
            ✓ Model Downloaded
          </button>
        )}
      </div>
    </>
  );

  const renderMicrophoneStep = () => (
    <>
      <div className="new-step-header">
        <h1 className="new-step-title">Microphone Permission</h1>
        <p className="new-step-subtitle">Enable voice recording for local transcription.</p>
      </div>
      
      <div className="new-step-features">
        <div className="new-feature">
          <Check size={16} /> All processing happens locally on your Mac
        </div>
        <div className="new-feature">
          <Check size={16} /> You control when recording starts and stops
        </div>
      </div>
      
      <div className="new-step-content">
        <p className="new-step-description">
          Scout needs microphone access for voice transcription. All audio processing happens locally - your voice never leaves your device.
        </p>
        
        <div className="new-permission-card">
          {micPermission === 'not-determined' && (
            <div className="new-status-item new-status-waiting">
              <div className="new-status-icon">
                <div className="new-spinner" />
              </div>
              <div className="new-status-content">
                <div className="new-status-title">Requesting Permission</div>
                <div className="new-status-description">macOS will prompt you to allow microphone access</div>
              </div>
            </div>
          )}
          {micPermission === 'granted' && (
            <div className="new-status-item new-status-granted">
              <div className="new-status-icon">
                <Check size={20} />
              </div>
              <div className="new-status-content">
                <div className="new-status-title">Permission Granted</div>
                <div className="new-status-description">Scout can now access your microphone for transcription</div>
              </div>
            </div>
          )}
          {micPermission === 'denied' && (
            <div className="new-status-item new-status-denied">
              <div className="new-status-icon">
                <X size={20} />
              </div>
              <div className="new-status-content">
                <div className="new-status-title">Permission Denied</div>
                <div className="new-status-description">Please enable microphone access in System Preferences to continue</div>
              </div>
            </div>
          )}
        </div>
      </div>
      
      <div className="new-step-actions">
        {micPermission === 'not-determined' && (
          <button className="new-btn-primary" onClick={requestMicPermission}>
            Grant Permission
          </button>
        )}
        {micPermission === 'granted' && (
          <button className="new-btn-primary" onClick={() => setCurrentStep('shortcuts')}>
            Continue
          </button>
        )}
        {micPermission === 'denied' && (
          <button className="new-btn-secondary" onClick={() => {
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
      <div className="new-step-header">
        <h1 className="new-step-title">Create Shortcuts</h1>
        <p className="new-step-subtitle">Set up keyboard shortcuts for quick voice recording.</p>
      </div>
      
      <div className="new-step-content">
        <div className="new-shortcuts-config">
          <div className="new-shortcut-item">
            <label>Push-to-Talk:</label>
            <kbd className={isCapturingPTT ? 'new-capturing' : ''}>
              {isCapturingPTT ? 'Press any key...' : pushToTalkShortcut}
            </kbd>
            <button 
              className="new-btn-text"
              onClick={() => {
                setIsCapturingPTT(true);
                setIsCapturingToggle(false);
              }}
            >
              Change
            </button>
          </div>
          <div className="new-shortcut-item">
            <label>Toggle Recording:</label>
            <kbd className={isCapturingToggle ? 'new-capturing' : ''}>
              {isCapturingToggle ? 'Press any key...' : toggleShortcut}
            </kbd>
            <button 
              className="new-btn-text"
              onClick={() => {
                setIsCapturingToggle(true);
                setIsCapturingPTT(false);
              }}
            >
              Change
            </button>
          </div>
        </div>
      </div>

      <div className="new-step-actions">
        <button className="new-btn-link" onClick={() => setCurrentStep('tour')}>
          Skip for now
        </button>
        <button className="new-btn-primary" onClick={() => {
          setShortcutsConfigured(true);
          setCurrentStep('tour');
        }}>
          Continue
        </button>
      </div>
    </>
  );

  const renderTourStep = () => {
    const canFinish = downloadStatus === 'complete';
    
    return (
      <>
        <div className="new-step-header">
          <h1 className="new-step-title">You're Ready!</h1>
          <p className="new-step-subtitle">Scout is configured and ready for voice transcription.</p>
        </div>
        
        <div className="new-step-features">
          <div className="new-feature">
            <Check size={16} /> AI model downloaded and ready
          </div>
          <div className="new-feature">
            <Check size={16} /> Microphone access granted
          </div>
          <div className="new-feature">
            <Check size={16} /> Shortcuts configured for quick recording
          </div>
        </div>
        
        <div className="new-step-content">
          <div className="new-quick-reference">
            <div className="new-reference-item">
              <span className="new-reference-label">Push-to-Talk:</span>
              <kbd className="new-reference-shortcut">{pushToTalkShortcut}</kbd>
            </div>
            <div className="new-reference-item">
              <span className="new-reference-label">Toggle Recording:</span>
              <kbd className="new-reference-shortcut">{toggleShortcut}</kbd>
            </div>
          </div>

          <div className="new-download-status-final">
            {downloadStatus === 'complete' ? (
              <div className="new-status-complete">
                <Check size={16} />
                Model downloaded successfully!
              </div>
            ) : (
              <div className="new-status-downloading">
                <div className="new-spinner-small" />
                Downloading model... {downloadProgress?.progress.toFixed(0)}% complete
              </div>
            )}
          </div>
        </div>

        <div className="new-step-actions">
          <button 
            className="new-btn-primary" 
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
    <div className="new-onboarding-overlay">
      {/* Background image */}
      <div className="new-background-image">
        <img 
          src={soundwaveImage} 
          alt="Voice visualization in glass dome"
          className="new-soundwave-hero"
        />
      </div>

      {/* Content container */}
      <div className="new-content-container">
        <div className="new-glass-card">
          {renderStepContent()}
        </div>
        
        {/* Step indicators with numbers */}
        <div className="new-step-indicators">
          <button 
            className={`new-indicator ${currentStep === 'model' ? 'new-active' : 'new-completed'}`} 
            onClick={() => setCurrentStep('model')}
            disabled={false}
          >
            {currentStep !== 'model' ? <Check size={14} /> : '1'}
          </button>
          <div className={`new-indicator-connector ${downloadStatus === 'complete' ? 'new-completed' : ''}`} />
          <button 
            className={`new-indicator ${currentStep === 'microphone' ? 'new-active' : ''} ${downloadStatus === 'complete' ? (currentStep === 'microphone' ? 'new-active' : 'new-completed') : ''}`} 
            onClick={() => downloadStatus === 'complete' && setCurrentStep('microphone')}
            disabled={downloadStatus !== 'complete'}
          >
            {downloadStatus === 'complete' && currentStep !== 'microphone' ? <Check size={14} /> : 
             currentStep === 'microphone' ? '2' : '2'}
          </button>
          <div className={`new-indicator-connector ${micPermission === 'granted' ? 'new-completed' : ''}`} />
          <button 
            className={`new-indicator ${currentStep === 'shortcuts' ? 'new-active' : ''} ${micPermission === 'granted' ? (currentStep === 'shortcuts' ? 'new-active' : 'new-completed') : ''}`} 
            onClick={() => micPermission === 'granted' && setCurrentStep('shortcuts')}
            disabled={micPermission !== 'granted'}
          >
            {micPermission === 'granted' && currentStep !== 'shortcuts' ? <Check size={14} /> : 
             currentStep === 'shortcuts' ? '3' : '3'}
          </button>
          <div className={`new-indicator-connector ${shortcutsConfigured || currentStep === 'tour' ? 'new-completed' : ''}`} />
          <button 
            className={`new-indicator ${currentStep === 'tour' ? 'new-active' : ''} ${shortcutsConfigured || currentStep === 'tour' ? (currentStep === 'tour' ? 'new-active' : 'new-completed') : ''}`} 
            onClick={() => (shortcutsConfigured || currentStep === 'tour') && setCurrentStep('tour')}
            disabled={!shortcutsConfigured && currentStep !== 'tour'}
          >
            {(shortcutsConfigured || currentStep === 'tour') && currentStep !== 'tour' ? <Check size={14} /> : 
             currentStep === 'tour' ? '4' : '4'}
          </button>
        </div>
      </div>
    </div>
  );
};
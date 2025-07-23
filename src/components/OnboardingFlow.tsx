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
      
      if (status === 'granted') {
        // Auto-advance after a short delay
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
          </div>

          {downloadStatus === 'downloading' && downloadProgress && (
            <div className="download-status">
              <div className="progress-bar">
                <div 
                  className="progress-fill"
                  style={{ width: `${downloadProgress.progress}%` }}
                />
              </div>
              <div className="progress-text">
                {downloadProgress.downloadedMb.toFixed(1)} / {downloadProgress.totalMb.toFixed(1)} MB
              </div>
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
    <div className="onboarding-step">
      <div className="step-icon">
        <Mic size={48} />
      </div>
      <h2>Scout needs microphone access</h2>
      <p>To transcribe your speech, Scout needs permission to use your microphone.</p>
      
      <div className="permission-status">
        {micPermission === 'not-determined' && (
          <div className="status-waiting">
            <div className="spinner" />
            Waiting for permission...
          </div>
        )}
        {micPermission === 'granted' && (
          <div className="status-granted">
            <Check size={20} />
            Permission granted!
          </div>
        )}
        {micPermission === 'denied' && (
          <div className="status-denied">
            <X size={20} />
            Permission denied - Scout won't work without microphone access
          </div>
        )}
      </div>

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
          // TODO: Open system preferences
          invoke('open_system_preferences_audio');
        }}>
          Open System Preferences
        </button>
      )}
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
    
    // Get the key
    let key = e.key;
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
    <div className="onboarding-step">
      <div className="step-icon">
        <Keyboard size={48} />
      </div>
      <h2>Set up your recording shortcuts</h2>
      
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

      <div className="shortcut-hint">
        <p>💡 Hold the push-to-talk key while speaking for instant transcription</p>
      </div>

      <div className="step-actions">
        <button className="btn-secondary" onClick={() => setCurrentStep('tour')}>
          Skip for now
        </button>
        <button className="btn-primary" onClick={() => {
          setShortcutsConfigured(true);
          setCurrentStep('tour');
        }}>
          Continue
        </button>
      </div>
    </div>
  );

  const renderTourStep = () => {
    const canFinish = downloadStatus === 'complete';
    
    return (
      <div className="onboarding-step">
        <div className="step-icon">
          <Sparkles size={48} />
        </div>
        <h2>You're almost ready!</h2>
        
        <div className="tour-content">
          <div className="tour-item">
            <h3>Push-to-Talk</h3>
            <p>Hold <kbd>{pushToTalkShortcut}</kbd> while speaking for instant transcription</p>
          </div>
          <div className="tour-item">
            <h3>Toggle Mode</h3>
            <p>Press <kbd>{toggleShortcut}</kbd> to start/stop longer recordings</p>
          </div>
          <div className="tour-item">
            <h3>Transcription Area</h3>
            <p>Your text appears here in real-time as you speak</p>
          </div>
          <div className="tour-item">
            <h3>Search & Export</h3>
            <p>Find past transcriptions and export them in various formats</p>
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
          className="btn-primary" 
          onClick={completeOnboarding}
          disabled={!canFinish}
        >
          {canFinish ? 'Finish Setup' : 'Waiting for download...'}
        </button>
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
          <div className={`indicator ${currentStep === 'model' ? 'active' : ''}`} />
          <div className={`indicator ${currentStep === 'microphone' ? 'active' : ''}`} />
          <div className={`indicator ${currentStep === 'shortcuts' ? 'active' : ''}`} />
          <div className={`indicator ${currentStep === 'tour' ? 'active' : ''}`} />
        </div>
      </div>
    </div>
  );
};
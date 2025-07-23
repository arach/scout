import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { safeEventListen } from '../lib/safeEventListener';
import './FirstRunSetup.css';

interface FirstRunSetupProps {
  onComplete: () => void;
}

interface DownloadProgress {
  url: string;
  downloaded: number;
  total: number;
  progress: number;
}

export const FirstRunSetup: React.FC<FirstRunSetupProps> = ({ onComplete }) => {
  const [stage, setStage] = useState<'downloading-tiny' | 'downloading-base' | 'complete'>('downloading-tiny');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    startSetup();
  }, []);

  const startSetup = async () => {
    try {
      // Get models directory
      const modelsDir = await invoke<string>('get_models_dir');
      
      // Set up progress listener
      const unlisten = await safeEventListen<DownloadProgress>('download-progress', (event) => {
        setProgress(event.payload.progress);
      });

      // Download tiny model first
      setStage('downloading-tiny');
      const tinyUrl = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin';
      const tinyPath = `${modelsDir}/ggml-tiny.en.bin`;
      
      await invoke('download_file', {
        url: tinyUrl,
        destPath: tinyPath
      });

      // Set tiny as active model
      await invoke('set_active_model', { modelId: 'tiny.en' });

      // Download base model in background
      setStage('downloading-base');
      setProgress(0);
      
      const baseUrl = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin';
      const basePath = `${modelsDir}/ggml-base.en.bin`;
      
      await invoke('download_file', {
        url: baseUrl,
        destPath: basePath
      });

      // Cleanup
      unlisten();
      
      setStage('complete');
      setTimeout(onComplete, 1000);
    } catch (err) {
      console.error('Setup error:', err);
      setError(err?.toString() || 'Setup failed');
    }
  };

  const getStatusMessage = () => {
    switch (stage) {
      case 'downloading-tiny':
        return 'Downloading essential model (39 MB)...';
      case 'downloading-base':
        return 'Downloading enhanced model (142 MB)...';
      case 'complete':
        return 'Setup complete!';
      default:
        return 'Setting up...';
    }
  };

  if (error) {
    return (
      <div className="first-run-setup">
        <div className="setup-content">
          <h2>Setup Error</h2>
          <p className="error-message">{error}</p>
          <button onClick={startSetup} className="retry-button">
            Retry Setup
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="first-run-setup">
      <div className="setup-content">
        <h2>Welcome to Scout</h2>
        <p className="setup-subtitle">Downloading essential models for voice transcription...</p>
        
        <div className="setup-status">
          <p className="status-message">{getStatusMessage()}</p>
          
          <div className="progress-container">
            <div className="progress-bar">
              <div 
                className="progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="progress-text">{Math.round(progress)}%</span>
          </div>
        </div>

        {stage === 'downloading-base' && (
          <p className="setup-note">
            You can start using Scout now. We're downloading an enhanced model in the background.
          </p>
        )}
      </div>
    </div>
  );
};
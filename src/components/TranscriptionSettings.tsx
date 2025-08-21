import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Zap, Layers } from 'lucide-react';
import { ModelManager } from './ModelManager';
import { ExternalServiceSettings } from './settings/ExternalServiceSettings';
import './TranscriptionSettings.css';

export enum TranscriptionMode {
  Internal = 'internal',
  External = 'external'
}


export const TranscriptionSettings: React.FC = () => {
  const [mode, setMode] = useState<TranscriptionMode>(TranscriptionMode.Internal);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const settings = await invoke<any>('get_settings');
      if (settings.transcription_mode) {
        setMode(settings.transcription_mode as TranscriptionMode);
      }
    } catch (error) {
      console.error('Failed to load transcription config:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleModeChange = async (newMode: TranscriptionMode) => {
    setMode(newMode);
    try {
      const settings = await invoke<any>('get_settings');
      await invoke('update_settings', {
        newSettings: {
          ...settings,
          transcription_mode: newMode
        }
      });
    } catch (error) {
      console.error('Failed to update transcription mode:', error);
    }
  };

  if (loading) {
    return <div className="transcription-settings loading">Loading...</div>;
  }

  return (
    <div className="transcription-settings">
      <div className="transcription-mode-selector">
        <h2 className="settings-section-title">Transcription Mode</h2>
        <div className="mode-tabs">
          <div 
            className={`mode-indicator ${mode === TranscriptionMode.External ? 'right' : ''}`}
          />
          <button
            className={`mode-tab ${mode === TranscriptionMode.Internal ? 'active' : ''}`}
            onClick={() => handleModeChange(TranscriptionMode.Internal)}
          >
            <Zap className="mode-icon" size={16} />
            <span className="mode-label">Integrated</span>
            <span className="mode-desc">Whisper models powered by Hugging Face</span>
          </button>
          <button
            className={`mode-tab ${mode === TranscriptionMode.External ? 'active' : ''}`}
            onClick={() => handleModeChange(TranscriptionMode.External)}
          >
            <Layers className="mode-icon" size={16} />
            <span className="mode-label">Advanced</span>
            <span className="mode-desc">Standalone service with multiple engines</span>
          </button>
        </div>
      </div>

      <div className="transcription-content">
        <div style={{ display: mode === TranscriptionMode.Internal ? 'block' : 'none' }}>
          <h2 className="settings-section-title">Whisper Models</h2>
          <ModelManager />
        </div>
        <div style={{ display: mode === TranscriptionMode.External ? 'block' : 'none' }}>
          <h2 className="settings-section-title">Advanced Transcription Service</h2>
          <ExternalServiceSettings />
        </div>
      </div>
    </div>
  );
};
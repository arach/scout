import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
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
          <button
            className={`mode-tab ${mode === TranscriptionMode.Internal ? 'active' : ''}`}
            onClick={() => handleModeChange(TranscriptionMode.Internal)}
          >
            <span className="mode-icon">🏠</span>
            <span className="mode-label">Built-in</span>
            <span className="mode-desc">Use Scout's built-in Whisper models</span>
          </button>
          <button
            className={`mode-tab ${mode === TranscriptionMode.External ? 'active' : ''}`}
            onClick={() => handleModeChange(TranscriptionMode.External)}
          >
            <span className="mode-icon">🚀</span>
            <span className="mode-label">External Service</span>
            <span className="mode-desc">Use Scout Transcriber for advanced models</span>
          </button>
        </div>
      </div>

      <div className="transcription-content">
        {mode === TranscriptionMode.Internal ? (
          <>
            <h2 className="settings-section-title">Whisper Models</h2>
            <ModelManager />
          </>
        ) : (
          <>
            <h2 className="settings-section-title">External Service Configuration</h2>
            <ExternalServiceSettings />
          </>
        )}
      </div>
    </div>
  );
};
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


interface ServiceStatus {
  running: boolean;
  healthy: boolean;
}

export const TranscriptionSettings: React.FC = () => {
  const [mode, setMode] = useState<TranscriptionMode>(TranscriptionMode.Internal);
  const [loading, setLoading] = useState(true);
  const [, setServiceStatus] = useState<ServiceStatus | null>(null);

  useEffect(() => {
    loadConfig();
    if (mode === TranscriptionMode.External) {
      checkServiceStatus();
    }
  }, []);

  useEffect(() => {
    if (mode === TranscriptionMode.External) {
      checkServiceStatus();
      const interval = setInterval(checkServiceStatus, 5000);
      return () => clearInterval(interval);
    }
  }, [mode]);

  const loadConfig = async () => {
    try {
      const settings = await invoke<any>('get_settings');
      // Load from transcription_mode field, or check external_service.enabled as fallback
      if (settings.transcription_mode) {
        setMode(settings.transcription_mode as TranscriptionMode);
      } else if (settings.external_service?.enabled) {
        // If no explicit mode but external service is enabled, set to External
        setMode(TranscriptionMode.External);
      } else {
        // Default to Internal
        setMode(TranscriptionMode.Internal);
      }
    } catch (error) {
      console.error('Failed to load transcription config:', error);
    } finally {
      setLoading(false);
    }
  };

  const checkServiceStatus = async () => {
    try {
      const status = await invoke<ServiceStatus>('check_external_service_status');
      setServiceStatus(status);
    } catch (error) {
      console.error('Failed to check service status:', error);
      setServiceStatus({ running: false, healthy: false });
    }
  };

  const handleModeChange = async (newMode: TranscriptionMode) => {
    setMode(newMode);
    try {
      const settings = await invoke<any>('get_settings');
      // Update both the transcription_mode and external_service.enabled
      const updatedSettings = {
        ...settings,
        transcription_mode: newMode,
        external_service: {
          ...settings.external_service,
          enabled: newMode === TranscriptionMode.External
        }
      };
      await invoke('update_settings', {
        settings: updatedSettings
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
          <h2 className="settings-section-title">Transcriber Settings</h2>
          <ExternalServiceSettings onStatusChange={setServiceStatus} />
        </div>
      </div>
    </div>
  );
};
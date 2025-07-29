import React, { memo, useState, useEffect } from 'react';
import { useSettings } from '../../contexts/SettingsContext';
import { Dropdown } from '../Dropdown';
import { invoke } from '@tauri-apps/api/core';
import './SoundSettings.css';

export const SoundSettings = memo(function SoundSettings() {
  const { state, actions } = useSettings();
  const { sound } = state;
  const [availableSounds, setAvailableSounds] = useState<string[]>([]);
  const [isPreviewingSound, setIsPreviewingSound] = useState(false);

  useEffect(() => {
    invoke<string[]>('get_available_sounds')
      .then(sounds => setAvailableSounds(sounds))
      .catch(console.error);
  }, []);

  const previewSoundFlow = async () => {
    if (isPreviewingSound) return;
    
    console.log('Preview button clicked!');
    try {
      setIsPreviewingSound(true);
      await invoke('preview_sound_flow');
    } catch (error) {
      console.error('Failed to preview sound flow:', error);
      setIsPreviewingSound(false);
      alert('Failed to preview sounds. Make sure the app is fully loaded.');
      return;
    }
    
    setTimeout(() => {
      setIsPreviewingSound(false);
    }, 2500);
  };

  return (
    <div className="settings-section">
      <div className="settings-section-header-row">
        <h3 className="settings-section-header">Sound Settings</h3>
        <button
          onClick={previewSoundFlow}
          disabled={!sound.soundEnabled || isPreviewingSound}
          className={`preview-sound-button ${isPreviewingSound ? 'playing' : ''}`}
        >
          {isPreviewingSound ? (
            <>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  animation: 'spin 1s linear infinite'
                }}
              >
                <path d="M21 12a9 9 0 11-6.219-8.56" />
              </svg>
              Playing...
            </>
          ) : (
            <>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
              Preview
            </>
          )}
        </button>
      </div>
      <div className="setting-item" style={{ marginBottom: '20px' }}>
        <label>
          <input
            type="checkbox"
            checked={sound.soundEnabled}
            onChange={actions.toggleSoundEnabled}
          />
          Enable sound effects
        </label>
        <p className="setting-hint">
          Play sounds when starting, stopping, and completing transcription
        </p>
      </div>

      <div className="setting-item">
        <label>Sound flow</label>
        <div className="sound-flow-container">
          <div className="sound-flow-item">
            <div className="sound-flow-label">Start</div>
            <Dropdown
              value={sound.startSound}
              onChange={actions.updateStartSound}
              options={availableSounds}
              disabled={!sound.soundEnabled}
              style={{ width: '140px' }}
            />
          </div>
          <div className="sound-flow-arrow">→</div>
          <div className="sound-flow-item">
            <div className="sound-flow-label">Stop</div>
            <Dropdown
              value={sound.stopSound}
              onChange={actions.updateStopSound}
              options={availableSounds}
              disabled={!sound.soundEnabled}
              style={{ width: '140px' }}
            />
          </div>
          <div className="sound-flow-arrow">→</div>
          <div className="sound-flow-item">
            <div className="sound-flow-label">Complete</div>
            <Dropdown
              value={sound.successSound}
              onChange={actions.updateSuccessSound}
              options={availableSounds}
              disabled={!sound.soundEnabled}
              style={{ width: '140px' }}
            />
          </div>
        </div>
        <p className="setting-hint">
          Sounds played during the recording and transcription process
        </p>
      </div>

      <div className="setting-item">
        <label>Completion sound threshold</label>
        <div className="range-input-container">
          <input
            type="range"
            min="0"
            max="10000"
            step="500"
            value={sound.completionSoundThreshold}
            onChange={(e) => actions.updateCompletionSoundThreshold(Number(e.target.value))}
            disabled={!sound.soundEnabled}
          />
          <span className="range-value-display">
            {(sound.completionSoundThreshold / 1000).toFixed(1)}s
          </span>
        </div>
        <p className="setting-hint">
          Only play completion sound when processing takes longer than this duration
        </p>
      </div>
    </div>
  );
});
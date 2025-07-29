import React, { memo } from 'react';
import { useSettings } from '../../contexts/SettingsContext';
import { useHotkeyCapture } from '../../hooks/useHotkeyCapture';
import { formatShortcutJSX } from '../../lib/formatShortcutJSX';
import { Dropdown } from '../Dropdown';
import { invoke } from '@tauri-apps/api/core';

export const RecordingAudioSettings = memo(function RecordingAudioSettings() {
  const { state, actions } = useSettings();
  const { shortcuts, clipboard, sound } = state;
  const {
    startCapturingHotkey,
    stopCapturingHotkey,
    startCapturingPushToTalkHotkey,
    stopCapturingPushToTalkHotkey
  } = useHotkeyCapture();
  
  const [availableSounds, setAvailableSounds] = React.useState<string[]>([]);
  const [isPreviewingSound, setIsPreviewingSound] = React.useState(false);

  React.useEffect(() => {
    invoke<string[]>('get_available_sounds')
      .then(sounds => setAvailableSounds(sounds))
      .catch(console.error);
  }, []);

  const previewSoundFlow = async () => {
    if (isPreviewingSound) return;
    
    try {
      setIsPreviewingSound(true);
      await invoke('preview_sound_flow');
    } catch (error) {
      console.error('Failed to preview sound flow:', error);
      setIsPreviewingSound(false);
      return;
    }
    
    setTimeout(() => {
      setIsPreviewingSound(false);
    }, 2500);
  };

  return (
    <div className="settings-section">
      <div className="settings-section-header-row">
        <h3 className="settings-section-title">Recording & Audio</h3>
      </div>
      
      {/* Toggle Recording Shortcut */}
      <div className="setting-item">
        <label>Toggle Recording</label>
        <div className="hotkey-input-group">
          <div className={`hotkey-display ${shortcuts.isCapturingHotkey ? 'capturing' : ''}`}>
            {shortcuts.isCapturingHotkey ? (
              <span className="capturing-text">Press shortcut keys...</span>
            ) : (
              <span className="hotkey-keys" title={shortcuts.hotkey}>
                {formatShortcutJSX(shortcuts.hotkey)}
              </span>
            )}
          </div>
          {shortcuts.isCapturingHotkey ? (
            <button onClick={stopCapturingHotkey} className="cancel-button">
              Cancel
            </button>
          ) : (
            <button onClick={startCapturingHotkey}>
              Capture
            </button>
          )}
        </div>
        <p className="setting-hint">
          Press to start/stop recording
        </p>
      </div>
      
      {/* Push-to-Talk Shortcut */}
      <div className="setting-item">
        <label>Push-to-Talk</label>
        <div className="hotkey-input-group">
          <div className={`hotkey-display ${shortcuts.isCapturingPushToTalkHotkey ? 'capturing' : ''}`}>
            {shortcuts.isCapturingPushToTalkHotkey ? (
              <span className="capturing-text">Press shortcut keys...</span>
            ) : (
              <span className="hotkey-keys" title={shortcuts.pushToTalkHotkey}>
                {shortcuts.pushToTalkHotkey ? formatShortcutJSX(shortcuts.pushToTalkHotkey) : 'Not Set'}
              </span>
            )}
          </div>
          {shortcuts.isCapturingPushToTalkHotkey ? (
            <button onClick={stopCapturingPushToTalkHotkey} className="cancel-button">
              Cancel
            </button>
          ) : (
            <>
              <button onClick={startCapturingPushToTalkHotkey}>
                Capture
              </button>
              {shortcuts.pushToTalkHotkey && (
                <button 
                  onClick={() => {
                    // Clear the push-to-talk shortcut
                    invoke('set_push_to_talk_shortcut', { shortcut: '' });
                    localStorage.removeItem('scout-push-to-talk-hotkey');
                    // TODO: Update state when available
                  }}
                  className="clear-button"
                >
                  Clear
                </button>
              )}
            </>
          )}
        </div>
        <p className="setting-hint">
          When set, hold this key while speaking to record
        </p>
      </div>

      {/* Sound Settings */}
      <div className="setting-item with-header">
        <div className="setting-row">
          <label>
            <input
              type="checkbox"
              checked={sound.soundEnabled}
              onChange={actions.toggleSoundEnabled}
            />
            Enable sound effects
          </label>
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
        <p className="setting-hint">
          Play sounds when starting, stopping, and completing transcription
        </p>
      </div>

      {/* Sound flow */}
      {sound.soundEnabled && (
        <div className="setting-item">
          <div className="sound-flow-container">
            <div className="sound-flow-item">
              <div className="sound-flow-label">Start</div>
              <Dropdown
                value={sound.startSound}
                onChange={actions.updateStartSound}
                options={availableSounds}
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
                style={{ width: '140px' }}
              />
            </div>
          </div>
        </div>
      )}
      
      {/* Auto-copy */}
      <div className="setting-item">
        <div className="setting-main">
          <label htmlFor="auto-copy">
            <input
              id="auto-copy"
              type="checkbox"
              checked={clipboard.autoCopy}
              onChange={actions.toggleAutoCopy}
            />
            <span>Auto-copy to clipboard</span>
          </label>
        </div>
        <div className="setting-hint">Automatically copy transcribed text to your clipboard</div>
      </div>
      
      {/* Auto-paste */}
      <div className="setting-item">
        <div className="setting-main">
          <label htmlFor="auto-paste">
            <input
              id="auto-paste"
              type="checkbox"
              checked={clipboard.autoPaste}
              onChange={actions.toggleAutoPaste}
            />
            <span>Auto-paste after transcription</span>
          </label>
        </div>
        <div className="setting-hint">Automatically paste transcribed text at cursor position</div>
      </div>
    </div>
  );
});
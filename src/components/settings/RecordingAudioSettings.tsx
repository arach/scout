import React, { memo } from 'react';
import { useSettings } from '../../contexts/SettingsContext';
import { useSettings as useSettingsHook } from '../../hooks/useSettingsContext';
import { useHotkeyCapture } from '../../hooks/useHotkeyCapture';
import { formatShortcutJSX } from '../../lib/formatShortcutJSX';
import { Dropdown } from '../Dropdown';
import { Toggle } from '../ui/Toggle';
import { invoke } from '@tauri-apps/api/core';
import './RecordingAudioSettings.css';

export const RecordingAudioSettings = memo(function RecordingAudioSettings() {
  const { state } = useSettings();
  const actions = useSettingsHook();
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
    <div className="recording-audio-settings">
      
      {/* Recording Shortcuts and Actions - Two Column Grid */}
      <div className="actions-grid">
        {/* Toggle Recording Shortcut */}
        <div className="setting-item">
          <label>Toggle Recording</label>
          <div className="hotkey-input-group">
            <div className={`hotkey-display ${shortcuts.isCapturingHotkey ? 'capturing' : ''}`}>
              {shortcuts.isCapturingHotkey ? (
                <span className="capturing-text">Press shortcut keys...</span>
              ) : (
                <span className="keyboard-key" title={shortcuts.hotkey}>
                  {formatShortcutJSX(shortcuts.hotkey)}
                </span>
              )}
            </div>
            {shortcuts.isCapturingHotkey ? (
              <button onClick={stopCapturingHotkey} className="cancel-button">
                Cancel
              </button>
            ) : (
              <>
                <button onClick={startCapturingHotkey}>
                  Capture
                </button>
                {shortcuts.hotkey && (
                  <button 
                    onClick={() => {
                      // Clear the toggle recording shortcut
                      invoke('set_global_shortcut', { shortcut: '' });
                      localStorage.removeItem('scout-hotkey');
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
        </div>
        
        {/* Push-to-Talk Shortcut */}
        <div className="setting-item">
          <label>Push-to-Talk</label>
          <div className="hotkey-input-group">
            <div className={`hotkey-display ${shortcuts.isCapturingPushToTalkHotkey ? 'capturing' : ''}`}>
              {shortcuts.isCapturingPushToTalkHotkey ? (
                <span className="capturing-text">Press shortcut keys...</span>
              ) : (
                <span className="keyboard-key" title={shortcuts.pushToTalkHotkey}>
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
        </div>

      </div>

      {/* Toggle Settings - Full Width */}
      <div className="toggles-section">
        {/* Auto-copy Toggle */}
        <Toggle
          label="Auto-copy to clipboard"
          checked={clipboard.autoCopy}
          onChange={actions.toggleAutoCopy}
        />
        
        {/* Auto-paste Toggle */}
        <Toggle
          label="Auto-paste after transcription"
          checked={clipboard.autoPaste}
          onChange={actions.toggleAutoPaste}
        />

        {/* Sound Enable Toggle with Preview Button */}
        <div className="toggle-with-action">
          <Toggle
            label="Enable recording sounds"
            checked={sound.soundEnabled}
            onChange={actions.toggleSoundEnabled}
          />
          {sound.soundEnabled && (
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
          )}
        </div>

        {/* UI Sounds Toggle */}
        <Toggle
          label="Enable UI sounds (transitions, settings saves)"
          checked={localStorage.getItem('scout-ui-sounds-enabled') !== 'false'}
          onChange={(enabled) => {
            localStorage.setItem('scout-ui-sounds-enabled', enabled.toString());
            // Settings are saved in localStorage and checked when playing sounds
          }}
        />
      </div>

      {/* Sound flow configuration */}
      {sound.soundEnabled && (
        <div className="setting-item">
          <div className="sound-flow-container">
              <div className="sound-flow-item">
                <div className="sound-flow-label">Start</div>
                <Dropdown
                  value={sound.startSound}
                  onChange={actions.updateStartSound}
                  options={availableSounds}
                  style={{ width: '120px' }}
                />
              </div>
              <div className="sound-flow-arrow">→</div>
              <div className="sound-flow-item">
                <div className="sound-flow-label">Stop</div>
                <Dropdown
                  value={sound.stopSound}
                  onChange={actions.updateStopSound}
                  options={availableSounds}
                  style={{ width: '120px' }}
                />
              </div>
              <div className="sound-flow-arrow">→</div>
              <div className="sound-flow-item">
                <div className="sound-flow-label">Complete</div>
                <Dropdown
                  value={sound.successSound}
                  onChange={actions.updateSuccessSound}
                  options={availableSounds}
                  style={{ width: '120px' }}
                />
              </div>
          </div>
        </div>
      )}

    </div>
  );
});
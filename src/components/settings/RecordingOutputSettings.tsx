import React, { memo } from 'react';
import { useSettings } from '../../contexts/SettingsContext';
import { useHotkeyCapture } from '../../hooks/useHotkeyCapture';
import { formatShortcutJSX } from '../../lib/formatShortcutJSX';

export const RecordingOutputSettings = memo(function RecordingOutputSettings() {
  const { state, actions } = useSettings();
  const { shortcuts, clipboard } = state;
  const {
    startCapturingPushToTalkHotkey,
    stopCapturingPushToTalkHotkey
  } = useHotkeyCapture();
  
  // Get push-to-talk mode from local storage for now
  const [isPushToTalkMode, setIsPushToTalkMode] = React.useState(() => {
    return localStorage.getItem('scout-recording-mode') === 'push-to-talk';
  });
  
  const handleRecordingModeChange = (enabled: boolean) => {
    const mode = enabled ? 'push-to-talk' : 'toggle';
    localStorage.setItem('scout-recording-mode', mode);
    setIsPushToTalkMode(enabled);
  };

  return (
    <div className="settings-section">
      
      {/* Push-to-Talk Mode */}
      <div className="setting-item">
        <div className="setting-main">
          <label htmlFor="recording-mode">
            <input
              id="recording-mode"
              type="checkbox"
              checked={isPushToTalkMode}
              onChange={(e) => handleRecordingModeChange(e.target.checked)}
            />
            <span>Enable Push-to-Talk Mode</span>
          </label>
        </div>
        <div className="setting-hint">Hold a key while speaking instead of toggle recording</div>
      </div>
      
      {/* Push-to-Talk Shortcut - Only visible when push-to-talk is enabled */}
      {isPushToTalkMode && (
        <div className="setting-item">
          <div className="setting-main">
            <label htmlFor="push-to-talk-key">Push-to-Talk Key</label>
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
                <button onClick={startCapturingPushToTalkHotkey}>
                  Capture
                </button>
              )}
            </div>
          </div>
          <div className="setting-hint">Hold this key while speaking to record</div>
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
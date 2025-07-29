import React, { memo } from 'react';
import { useSettings } from '../../contexts/SettingsContext';
import { formatShortcutJSX } from '../../lib/formatShortcutJSX';
import { useHotkeyCapture } from '../../hooks/useHotkeyCapture';

export const ShortcutSettings = memo(function ShortcutSettings() {
  const { state } = useSettings();
  const { shortcuts } = state;
  const {
    startCapturingHotkey,
    stopCapturingHotkey,
    startCapturingPushToTalkHotkey,
    stopCapturingPushToTalkHotkey
  } = useHotkeyCapture();

  return (
    <div className="settings-section">
      <div className="settings-two-column">
        <div className="setting-item">
          <label>Toggle Recording Shortcut</label>
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
            Click "Capture" and press your desired shortcut combination
          </p>
          {shortcuts.hotkeyUpdateStatus === 'success' && (
            <p className="setting-success">✓ Shortcut updated successfully!</p>
          )}
          {shortcuts.hotkeyUpdateStatus === 'error' && (
            <p className="setting-error">Failed to update shortcut. Please try a different combination.</p>
          )}
        </div>

        <div className="setting-item">
          <label>Push-to-Talk Shortcut</label>
          <div className="hotkey-input-group">
            <div className={`hotkey-display ${shortcuts.isCapturingPushToTalkHotkey ? 'capturing' : ''}`}>
              {shortcuts.isCapturingPushToTalkHotkey ? (
                <span className="capturing-text">Press shortcut keys...</span>
              ) : (
                <span className="hotkey-keys" title={shortcuts.pushToTalkHotkey}>
                  {formatShortcutJSX(shortcuts.pushToTalkHotkey)}
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
          <p className="setting-hint">
            Auto-stops recording after 10 seconds or press again to stop early
          </p>
        </div>
      </div>
    </div>
  );
});
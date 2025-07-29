import React, { memo } from 'react';
import { useSettings } from '../../contexts/SettingsContext';

export const ClipboardSettings = memo(function ClipboardSettings() {
  const { state, actions } = useSettings();
  const { clipboard } = state;

  return (
    <div className="settings-section">
      <div className="settings-two-column">
        <div className="setting-item">
          <label>
            <input
              type="checkbox"
              checked={clipboard.autoCopy}
              onChange={actions.toggleAutoCopy}
            />
            Auto-copy to clipboard
          </label>
          <p className="setting-hint">
            Automatically copy transcribed text to clipboard
          </p>
        </div>

        <div className="setting-item">
          <label>
            <input
              type="checkbox"
              checked={clipboard.autoPaste}
              onChange={actions.toggleAutoPaste}
            />
            Auto-paste
          </label>
          <p className="setting-hint">
            Automatically paste transcribed text into active application
          </p>
        </div>
      </div>
    </div>
  );
});
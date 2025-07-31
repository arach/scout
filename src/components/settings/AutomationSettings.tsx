import { memo } from 'react';
import { useSettingsContext } from '../../contexts/SettingsContext';

export const AutomationSettings = memo(function AutomationSettings() {
  const { state, actions } = useSettingsContext();
  
  return (
    <div className="settings-section">
      <div className="settings-two-column">
        <div className="setting-item">
          <label>
            <input
              type="checkbox"
              checked={state.clipboard.autoCopy}
              onChange={actions.toggleAutoCopy}
              aria-describedby="auto-copy-hint"
            />
            Auto-copy to clipboard
          </label>
          <p id="auto-copy-hint" className="setting-hint">
            Automatically copy transcribed text to clipboard
          </p>
        </div>
        
        <div className="setting-item">
          <label>
            <input
              type="checkbox"
              checked={state.clipboard.autoPaste}
              onChange={actions.toggleAutoPaste}
              aria-describedby="auto-paste-hint"
            />
            Auto-paste
          </label>
          <p id="auto-paste-hint" className="setting-hint">
            Automatically paste transcribed text into active application
          </p>
        </div>
      </div>
    </div>
  );
});
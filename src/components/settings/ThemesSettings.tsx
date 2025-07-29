import React, { memo } from 'react';
import { useSettings } from '../../contexts/SettingsContext';
import { ThemeSelector } from '../ThemeSelector';

export const ThemesSettings = memo(function ThemesSettings() {
  const { state, actions } = useSettings();
  const { ui } = state;

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Themes</h3>
      <ThemeSelector 
        currentTheme={ui.selectedTheme}
        onThemeChange={actions.updateSelectedTheme}
      />
    </div>
  );
});
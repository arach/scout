import React, { memo } from 'react';
import { useSettings } from '../../contexts/SettingsContext';
import { ThemeSelector } from '../ThemeSelector';

export const ThemesSettings = memo(function ThemesSettings() {
  const { state, actions } = useSettings();
  const { ui } = state;

  return (
    <div className="themes-settings">
      <ThemeSelector 
        currentTheme={ui.selectedTheme}
        onThemeChange={actions.updateSelectedTheme}
      />
    </div>
  );
});
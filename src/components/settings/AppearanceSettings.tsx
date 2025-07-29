import React, { memo } from 'react';
import { useSettings } from '../../contexts/SettingsContext';
import { ThemeSelector } from '../ThemeSelector';

export const AppearanceSettings = memo(function AppearanceSettings() {
  const { state, actions } = useSettings();
  const { ui } = state;

  return (
    <div className="theme-selector-wrapper">
      <ThemeSelector 
        currentTheme={ui.selectedTheme}
        onThemeChange={actions.updateSelectedTheme}
      />
    </div>
  );
});
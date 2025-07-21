import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { ThemeVariant, ThemeContextType } from './types';
import { getTheme, applyTheme, themes } from './index';
import { useSettings } from '../hooks/useSettings';

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

interface ThemeProviderProps {
  children: React.ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const { settings, updateSettings } = useSettings();
  
  // Get current theme based on settings
  const currentTheme = useMemo(() => {
    // Check if we have a selectedTheme in settings
    const themeId = settings.selectedTheme || (settings.theme === 'dark' ? 'vscode-dark' : 'vscode-light');
    return getTheme(themeId as ThemeVariant);
  }, [settings.selectedTheme, settings.theme]);
  
  // Apply theme when it changes
  useEffect(() => {
    applyTheme(currentTheme);
  }, [currentTheme]);
  
  // Listen for system theme changes if using system theme
  useEffect(() => {
    if (settings.selectedTheme === 'system' || (!settings.selectedTheme && settings.theme === 'system')) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      
      const handleChange = () => {
        const systemTheme = getTheme('system');
        applyTheme(systemTheme);
      };
      
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [settings.selectedTheme, settings.theme]);
  
  const setTheme = (themeId: ThemeVariant) => {
    updateSettings({ selectedTheme: themeId });
    
    // Also update the legacy theme setting for backward compatibility
    if (themeId === 'vscode-light') {
      updateSettings({ theme: 'light' });
    } else if (themeId === 'vscode-dark') {
      updateSettings({ theme: 'dark' });
    } else if (themeId === 'system') {
      updateSettings({ theme: 'system' });
    }
  };
  
  const value: ThemeContextType = {
    theme: currentTheme,
    setTheme,
    themes,
  };
  
  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};
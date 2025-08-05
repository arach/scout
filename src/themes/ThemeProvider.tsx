import React, { useEffect, useState, useRef } from 'react';
import { ThemeContextType, Theme } from './types';
import { ThemeVariant, THEME_VARIANTS } from './config';
import { getTheme, getThemeAsync, applyTheme, themes, preloadTheme } from './index';
import { useSettings } from '../hooks/useSettings';
import { vscodeDark } from './base/vscode';
import { ThemeContext } from './ThemeContext';

interface ThemeProviderProps {
  children: React.ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const { settings, updateSettings } = useSettings();
  const [currentTheme, setCurrentTheme] = useState<Theme>(() => {
    // Initial theme - use sync version for immediate render
    const themeId = settings.selectedTheme || (settings.theme === 'dark' ? 'vscode-dark' : 'vscode-light');
    return getTheme(themeId as ThemeVariant);
  });
  const [isLoadingTheme, setIsLoadingTheme] = useState(false);
  const appliedThemeId = useRef<string | null>(null);
  
  // Load theme asynchronously when settings change
  useEffect(() => {
    const themeId = settings.selectedTheme || (settings.theme === 'dark' ? 'vscode-dark' : 'vscode-light');
    
    // For default themes, use sync version
    if (themeId === 'vscode-dark' || themeId === 'vscode-light' || themeId === 'system') {
      const theme = getTheme(themeId as ThemeVariant);
      setCurrentTheme(theme);
      return;
    }
    
    // For other themes, load asynchronously
    setIsLoadingTheme(true);
    getThemeAsync(themeId as ThemeVariant)
      .then(theme => {
        setCurrentTheme(theme);
        setIsLoadingTheme(false);
      })
      .catch(err => {
        console.error('Failed to load theme:', err);
        // Fallback to default theme
        setCurrentTheme(vscodeDark);
        setIsLoadingTheme(false);
      });
  }, [settings.selectedTheme, settings.theme]);
  
  // Apply theme when it changes (with optimization to avoid redundant applications)
  useEffect(() => {
    if (appliedThemeId.current !== currentTheme.id) {
      applyTheme(currentTheme);
      appliedThemeId.current = currentTheme.id;
    }
  }, [currentTheme]);
  
  // Listen for system theme changes if using system theme
  useEffect(() => {
    if (settings.selectedTheme === 'system' || (!settings.selectedTheme && settings.theme === 'system')) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      
      const handleChange = async () => {
        try {
          const systemTheme = await getThemeAsync('system');
          setCurrentTheme(systemTheme);
          applyTheme(systemTheme);
        } catch (err) {
          console.error('Failed to load system theme:', err);
        }
      };
      
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [settings.selectedTheme, settings.theme]);
  
  const setTheme = (themeId: ThemeVariant) => {
    updateSettings({ selectedTheme: themeId });
    
    // Preload adjacent themes for faster switching
    const currentIndex = THEME_VARIANTS.indexOf(themeId);
    if (currentIndex > 0) preloadTheme(THEME_VARIANTS[currentIndex - 1]);
    if (currentIndex < THEME_VARIANTS.length - 1) preloadTheme(THEME_VARIANTS[currentIndex + 1]);
    
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
    isLoadingTheme,
  };
  
  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};
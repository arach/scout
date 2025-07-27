import React from 'react';
import { ThemeVariant } from '../themes/types';
import { getAvailableThemes } from '../themes';
import { useTheme } from '../themes/ThemeProvider';
import './ThemeSelector.css';

interface ThemeSelectorProps {
  currentTheme?: ThemeVariant;
  onThemeChange?: (theme: ThemeVariant) => void;
}

export const ThemeSelector: React.FC<ThemeSelectorProps> = ({ 
  currentTheme: propTheme,
  onThemeChange 
}) => {
  const { theme, setTheme, isLoadingTheme } = useTheme();
  const currentTheme = propTheme || theme.id;
  const availableThemes = getAvailableThemes();
  
  const handleThemeChange = (themeId: ThemeVariant) => {
    setTheme(themeId);
    onThemeChange?.(themeId);
  };
  
  // Group themes by category
  const themeCategories = availableThemes.reduce((acc, theme) => {
    if (!acc[theme.category]) {
      acc[theme.category] = [];
    }
    acc[theme.category].push(theme);
    return acc;
  }, {} as Record<string, typeof availableThemes>);
  
  return (
    <div className="theme-selector-container">
      <label>Theme</label>
      <div className="theme-categories">
        {Object.entries(themeCategories).map(([category, themes]) => (
          themes.length > 0 && (
            <div key={category} className="theme-category">
              <h4 className="theme-category-title">{category}</h4>
              <div className="theme-options">
                {themes.map(theme => (
                  <button
                    key={theme.id}
                    className={`theme-option ${currentTheme === theme.id ? 'active' : ''} ${isLoadingTheme && currentTheme === theme.id ? 'loading' : ''}`}
                    onClick={() => handleThemeChange(theme.id)}
                    title={theme.name}
                    disabled={isLoadingTheme}
                  >
                    <ThemeIcon themeId={theme.id} />
                    <span>{theme.name}</span>
                    {isLoadingTheme && currentTheme === theme.id && (
                      <span className="theme-loading-indicator">...</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )
        ))}
      </div>
      <p className="setting-hint">
        Choose your preferred visual theme. Minimal themes are optimized for overlay display.
      </p>
    </div>
  );
};

// Theme-specific icons
const ThemeIcon: React.FC<{ themeId: ThemeVariant }> = ({ themeId }) => {
  switch (themeId) {
    case 'vscode-light':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M8 1V3M8 13V15M15 8H13M3 8H1M12.95 3.05L11.54 4.46M4.46 11.54L3.05 12.95M12.95 12.95L11.54 11.54M4.46 4.46L3.05 3.05" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      );
    case 'vscode-dark':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8.5 2C5.46 2 3 4.46 3 7.5C3 10.54 5.46 13 8.5 13C10.83 13 12.82 11.45 13.56 9.3C13.19 9.42 12.8 9.5 12.38 9.5C10.17 9.5 8.38 7.71 8.38 5.5C8.38 4.31 8.89 3.24 9.69 2.5C9.3 2.18 8.91 2 8.5 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
        </svg>
      );
    case 'minimal-overlay':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="2" y="2" width="12" height="12" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" opacity="0.5"/>
          <rect x="9" y="3" width="5" height="3" fill="currentColor" opacity="0.8"/>
        </svg>
      );
    case 'winamp-classic':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="2" y="3" width="12" height="10" fill="#232323" stroke="#00ff00" strokeWidth="1"/>
          <rect x="3" y="5" width="10" height="2" fill="#00ff00"/>
          <rect x="3" y="8" width="6" height="1" fill="#00ff00" opacity="0.6"/>
          <rect x="3" y="10" width="8" height="1" fill="#00ff00" opacity="0.4"/>
        </svg>
      );
    case 'winamp-modern':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="2" y="3" width="12" height="10" rx="2" fill="#0c0e14" stroke="#ff6600" strokeWidth="1"/>
          <path d="M4 7 L6 5 L8 8 L10 6 L12 7" stroke="#00ff88" strokeWidth="1.5" fill="none"/>
          <circle cx="5" cy="10" r="1" fill="#ff6600"/>
          <circle cx="8" cy="10" r="1" fill="#00ff88"/>
          <circle cx="11" cy="10" r="1" fill="#ff6600"/>
        </svg>
      );
    case 'terminal-chic':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="1" y="2" width="14" height="12" fill="#0a0a0a" stroke="#00ff41" strokeWidth="1"/>
          <text x="3" y="6" fontSize="3" fill="#00ff41" fontFamily="monospace">$</text>
          <rect x="4.5" y="4.5" width="1" height="1" fill="#00ff41"/>
          <text x="3" y="9" fontSize="2.5" fill="#e0e0e0" fontFamily="monospace">user@scout</text>
          <rect x="3" y="11" width="4" height="1" fill="#333333"/>
          <rect x="8" y="11" width="2" height="1" fill="#333333"/>
        </svg>
      );
    case 'terminal-chic-light':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="1" y="2" width="14" height="12" fill="#fafafa" stroke="#006600" strokeWidth="1"/>
          <text x="3" y="6" fontSize="3" fill="#006600" fontFamily="monospace">$</text>
          <rect x="4.5" y="4.5" width="1" height="1" fill="#006600"/>
          <text x="3" y="9" fontSize="2.5" fill="#1a1a1a" fontFamily="monospace">user@scout</text>
          <rect x="3" y="11" width="4" height="1" fill="#d0d0d0"/>
          <rect x="8" y="11" width="2" height="1" fill="#d0d0d0"/>
        </svg>
      );
    case 'system':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="2" y="3" width="12" height="9" rx="1" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M5 13L6 15M10 13L11 15M4 15H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      );
    default:
      return <span>?</span>;
  }
};
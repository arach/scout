import { Theme, ThemeVariant } from './types';
import { vscodeLight, vscodeDark } from './base/vscode';
import { minimalOverlay } from './base/minimal';
import { winampClassic, winampModern } from './base/winamp';

export * from './types';

// Theme registry
export const themes: Record<ThemeVariant, Theme> = {
  'vscode-light': vscodeLight,
  'vscode-dark': vscodeDark,
  'minimal-overlay': minimalOverlay,
  'winamp-classic': winampClassic,
  'winamp-modern': winampModern,
  'system': vscodeDark, // Default to dark for system
};

// Get theme by ID
export const getTheme = (themeId: ThemeVariant): Theme => {
  if (themeId === 'system') {
    // Check system preference
    const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return isDarkMode ? vscodeDark : vscodeLight;
  }
  return themes[themeId] || vscodeDark;
};

// Convert theme to CSS variables
export const themeToCSSVariables = (theme: Theme): Record<string, string> => {
  const vars: Record<string, string> = {};
  
  // Colors
  Object.entries(theme.colors).forEach(([key, value]) => {
    const cssVarName = `--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
    vars[cssVarName] = value;
  });
  
  // Typography
  vars['--font-family'] = theme.typography.fontFamily;
  vars['--font-family-mono'] = theme.typography.fontFamilyMono;
  
  Object.entries(theme.typography.fontSize).forEach(([key, value]) => {
    vars[`--font-size-${key}`] = value;
  });
  
  Object.entries(theme.typography.fontWeight).forEach(([key, value]) => {
    vars[`--font-weight-${key}`] = value.toString();
  });
  
  Object.entries(theme.typography.lineHeight).forEach(([key, value]) => {
    vars[`--line-height-${key}`] = value;
  });
  
  // Layout
  vars['--border-radius'] = theme.layout.borderRadius;
  vars['--transition'] = theme.layout.transition;
  vars['--animations'] = theme.layout.animations || 'smooth';
  
  if (theme.layout.overlayPosition) {
    vars['--overlay-position'] = theme.layout.overlayPosition;
  }
  
  if (theme.layout.overlayOpacity !== undefined) {
    vars['--overlay-opacity'] = theme.layout.overlayOpacity.toString();
  }
  
  return vars;
};

// Apply theme to document
export const applyTheme = (theme: Theme): void => {
  const cssVars = themeToCSSVariables(theme);
  const root = document.documentElement;
  
  // Apply CSS variables
  Object.entries(cssVars).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });
  
  // Set theme attribute for CSS selectors
  root.setAttribute('data-theme', theme.id);
  
  // Set animation class
  root.classList.remove('animations-smooth', 'animations-retro', 'animations-minimal', 'animations-none');
  root.classList.add(`animations-${theme.layout.animations || 'smooth'}`);
};

// Get all available themes for UI
export const getAvailableThemes = (): Array<{ id: ThemeVariant; name: string }> => {
  return Object.values(themes).map(theme => ({
    id: theme.id,
    name: theme.name,
  }));
};
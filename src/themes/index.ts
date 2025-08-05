import { Theme, ThemeVariant } from './types';
import { loadTheme, preloadTheme, clearThemeCache } from './lazy';

export * from './types';
export { preloadTheme, clearThemeCache };

// Export theme hooks and provider separately to maintain Fast Refresh compatibility
export { ThemeProvider } from './ThemeProvider';
export { useTheme } from './useTheme';

// Default themes that are always loaded (for initial render)
import { vscodeDark, vscodeLight } from './base/vscode';

// Theme metadata for UI
export const themeMetadata: Record<ThemeVariant, { name: string; category: string }> = {
  'vscode-light': { name: 'VS Code Light', category: 'Classic' },
  'vscode-dark': { name: 'VS Code Dark', category: 'Classic' },
  'minimal-overlay': { name: 'Minimal Overlay', category: 'Modern' },
  'terminal-chic': { name: 'Terminal Chic', category: 'Terminal' },
  'terminal-chic-light': { name: 'Terminal Chic Light', category: 'Terminal' },
  'system': { name: 'System', category: 'Auto' },
};

// Legacy theme registry for backward compatibility
export const themes: Record<ThemeVariant, Theme> = {
  'vscode-light': vscodeLight,
  'vscode-dark': vscodeDark,
  'minimal-overlay': {} as Theme, // Will be loaded on demand
  'terminal-chic': {} as Theme,
  'terminal-chic-light': {} as Theme,
  'system': vscodeDark,
};

// Get theme by ID (async version for lazy loading)
export const getThemeAsync = async (themeId: ThemeVariant): Promise<Theme> => {
  return loadTheme(themeId);
};

// Get theme by ID (sync version for backward compatibility - only works for default themes)
export const getTheme = (themeId: ThemeVariant): Theme => {
  if (themeId === 'system') {
    // Check system preference
    const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return isDarkMode ? vscodeDark : vscodeLight;
  }
  
  // Return default themes immediately
  if (themeId === 'vscode-dark') return vscodeDark;
  if (themeId === 'vscode-light') return vscodeLight;
  
  // For other themes, return vscode dark as fallback
  // The async version should be used for non-default themes
  console.warn(`Theme ${themeId} requires async loading. Using default theme.`);
  return vscodeDark;
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

// Apply theme to document with optimized DOM updates
export const applyTheme = (theme: Theme): void => {
  const cssVars = themeToCSSVariables(theme);
  const root = document.documentElement;
  
  // Batch DOM updates to prevent multiple layout recalculations
  requestAnimationFrame(() => {
    // Apply CSS variables in a single batch
    Object.entries(cssVars).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });
    
    // Set theme attribute for CSS selectors
    root.setAttribute('data-theme', theme.id);
    
    // Set animation class
    root.classList.remove('animations-smooth', 'animations-retro', 'animations-minimal', 'animations-none');
    root.classList.add(`animations-${theme.layout.animations || 'smooth'}`);
  });
};

// Get all available themes for UI
export const getAvailableThemes = (): Array<{ id: ThemeVariant; name: string; category: string }> => {
  return Object.entries(themeMetadata).map(([id, metadata]) => ({
    id: id as ThemeVariant,
    name: metadata.name,
    category: metadata.category,
  }));
};
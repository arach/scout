import { Theme, ThemeVariant } from './types';

// Lazy theme loaders
export const themeLoaders: Record<ThemeVariant, () => Promise<Theme>> = {
  'vscode-light': () => import('./base/vscode').then(m => m.vscodeLight),
  'vscode-dark': () => import('./base/vscode').then(m => m.vscodeDark),
  'minimal-overlay': () => import('./base/minimal').then(m => m.minimalOverlay),
  'winamp-classic': () => import('./base/winamp').then(m => m.winampClassic),
  'winamp-modern': () => import('./base/winamp').then(m => m.winampModern),
  'terminal-chic': () => import('./base/terminal').then(m => m.terminalChic),
  'terminal-chic-light': () => import('./base/terminal').then(m => m.terminalChicLight),
  'system': async () => {
    // For system theme, determine which theme to load based on preference
    const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (isDarkMode) {
      return import('./base/vscode').then(m => m.vscodeDark);
    } else {
      return import('./base/vscode').then(m => m.vscodeLight);
    }
  }
};

// Theme cache to avoid re-loading
const themeCache = new Map<ThemeVariant, Theme>();

// Load theme with caching
export async function loadTheme(themeId: ThemeVariant): Promise<Theme> {
  // Check cache first
  if (themeCache.has(themeId)) {
    return themeCache.get(themeId)!;
  }

  // Load theme
  const loader = themeLoaders[themeId];
  if (!loader) {
    throw new Error(`Unknown theme: ${themeId}`);
  }

  const theme = await loader();
  
  // Cache the loaded theme
  themeCache.set(themeId, theme);
  
  return theme;
}

// Preload a theme in the background
export function preloadTheme(themeId: ThemeVariant): void {
  // Fire and forget - load in background
  loadTheme(themeId).catch(err => {
    console.warn(`Failed to preload theme ${themeId}:`, err);
  });
}

// Clear theme cache
export function clearThemeCache(): void {
  themeCache.clear();
}
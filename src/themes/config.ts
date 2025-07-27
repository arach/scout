export type ThemeVariant = 
  | 'vscode-light' 
  | 'vscode-dark' 
  | 'minimal-overlay' 
  | 'winamp-classic' 
  | 'winamp-modern' 
  | 'terminal-chic' 
  | 'terminal-chic-light'
  | 'system';

export const THEME_VARIANTS: ThemeVariant[] = [
  'vscode-light',
  'vscode-dark', 
  'minimal-overlay',
  'winamp-classic',
  'winamp-modern',
  'terminal-chic',
  'terminal-chic-light',
  'system'
];

export const DEFAULT_THEME: ThemeVariant = 'vscode-dark';

// Theme metadata for UI display
export interface ThemeMetadata {
  id: ThemeVariant;
  name: string;
  description: string;
  category: 'editor' | 'overlay' | 'retro' | 'terminal';
}

export const THEME_METADATA: Record<ThemeVariant, ThemeMetadata> = {
  'vscode-light': {
    id: 'vscode-light',
    name: 'VS Code Light',
    description: 'Clean light theme inspired by VS Code',
    category: 'editor'
  },
  'vscode-dark': {
    id: 'vscode-dark', 
    name: 'VS Code Dark',
    description: 'Classic dark theme inspired by VS Code',
    category: 'editor'
  },
  'minimal-overlay': {
    id: 'minimal-overlay',
    name: 'Minimal Overlay',
    description: 'Clean, minimal overlay design',
    category: 'overlay'
  },
  'winamp-classic': {
    id: 'winamp-classic',
    name: 'Winamp Classic',
    description: 'Nostalgic Winamp-inspired design',
    category: 'retro'
  },
  'winamp-modern': {
    id: 'winamp-modern',
    name: 'Winamp Modern',
    description: 'Modern take on Winamp aesthetics',
    category: 'retro'
  },
  'terminal-chic': {
    id: 'terminal-chic',
    name: 'Terminal Chic',
    description: 'Dark terminal-inspired design',
    category: 'terminal'
  },
  'terminal-chic-light': {
    id: 'terminal-chic-light',
    name: 'Terminal Chic Light',
    description: 'Light terminal-inspired design',
    category: 'terminal'
  },
  'system': {
    id: 'system',
    name: 'System',
    description: 'Follows your system theme preference',
    category: 'editor'
  }
}; 
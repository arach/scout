import { Theme } from '../types';

export const winampClassic: Theme = {
  id: 'winamp-classic',
  name: 'Winamp Classic',
  colors: {
    bgPrimary: '#000000',        // Pure black like classic Winamp
    bgSecondary: '#1a1a1a',      // Slightly lighter for headers
    bgTertiary: '#232323',       // More visible for transcript boxes
    bgHover: '#333333',          // Clear hover state
    bgActive: '#434343',         // Active state
    bgDanger: '#3a0a0a',
    bgOverlay: '#0a0a0a',
    
    textPrimary: '#00ff00',
    textSecondary: '#00cc00',
    textTertiary: '#008800',
    textPlaceholder: '#008800',
    textDanger: '#ff0000',
    textSuccess: '#00ff00',
    
    accentPrimary: '#00ff00',
    accentHover: '#33ff33',
    accentActive: '#00cc00',
    
    borderPrimary: '#00ff00',     // Classic Winamp green border
    borderHover: '#33ff33',       // Brighter green on hover
    
    shadowColor: 'rgba(0, 255, 0, 0.2)',
  },
  typography: {
    fontFamily: '"MS Sans Serif", "Chicago", system-ui, sans-serif',
    fontFamilyMono: '"Courier New", "Courier", monospace',
    fontSize: {
      small: '10px',
      base: '11px',
      large: '13px',
      xlarge: '16px',
    },
    fontWeight: {
      normal: 400,
      medium: 400,
      bold: 700,
    },
    lineHeight: {
      tight: '1.0',
      normal: '1.2',
      relaxed: '1.4',
    },
  },
  layout: {
    borderRadius: '0px',
    transition: 'none',
    animations: 'retro',
  },
};

export const winampModern: Theme = {
  id: 'winamp-modern',
  name: 'Winamp Modern',
  colors: {
    bgPrimary: '#0c0e14',
    bgSecondary: '#151821',
    bgTertiary: '#1e222e',
    bgHover: '#2a2f3e',
    bgActive: '#363c4f',
    bgDanger: '#2a1a1a',
    bgOverlay: 'rgba(12, 14, 20, 0.95)',
    
    textPrimary: '#00ff88',
    textSecondary: '#00cc66',
    textTertiary: '#008844',
    textPlaceholder: '#008844',
    textDanger: '#ff4466',
    textSuccess: '#00ff88',
    
    accentPrimary: '#ff6600',
    accentHover: '#ff8833',
    accentActive: '#cc5500',
    
    borderPrimary: '#2a2f3e',
    borderHover: '#363c4f',
    
    shadowColor: 'rgba(255, 102, 0, 0.3)',
  },
  typography: {
    fontFamily: '"Segoe UI", "Roboto", system-ui, sans-serif',
    fontFamilyMono: '"Fira Code", "SF Mono", Monaco, monospace',
    fontSize: {
      small: '11px',
      base: '13px',
      large: '15px',
      xlarge: '18px',
    },
    fontWeight: {
      normal: 400,
      medium: 500,
      bold: 600,
    },
    lineHeight: {
      tight: '1.2',
      normal: '1.5',
      relaxed: '1.7',
    },
  },
  layout: {
    borderRadius: '4px',
    transition: 'all 0.1s ease',
    animations: 'retro',
  },
};
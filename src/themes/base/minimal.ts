import { Theme } from '../types';

export const minimalOverlay: Theme = {
  id: 'minimal-overlay',
  name: 'Minimal Overlay',
  colors: {
    bgPrimary: 'rgba(0, 0, 0, 0.85)',
    bgSecondary: 'rgba(0, 0, 0, 0.9)',
    bgTertiary: 'rgba(0, 0, 0, 0.95)',
    bgHover: 'rgba(255, 255, 255, 0.1)',
    bgActive: 'rgba(255, 255, 255, 0.15)',
    bgDanger: 'rgba(255, 0, 0, 0.2)',
    bgOverlay: 'rgba(0, 0, 0, 0.8)',
    
    textPrimary: 'rgba(255, 255, 255, 0.9)',
    textSecondary: 'rgba(255, 255, 255, 0.7)',
    textPlaceholder: 'rgba(255, 255, 255, 0.5)',
    textDanger: '#ff6b6b',
    textSuccess: '#51cf66',
    
    accentPrimary: 'rgba(255, 255, 255, 0.8)',
    accentHover: 'rgba(255, 255, 255, 0.9)',
    accentActive: 'rgba(255, 255, 255, 1)',
    
    borderPrimary: 'rgba(255, 255, 255, 0.1)',
    borderHover: 'rgba(255, 255, 255, 0.2)',
    
    shadowColor: 'rgba(0, 0, 0, 0.5)',
    overlayBackdrop: 'transparent',
  },
  typography: {
    fontFamily: '"SF Mono", Monaco, Consolas, "Courier New", monospace',
    fontFamilyMono: '"SF Mono", Monaco, Consolas, "Courier New", monospace',
    fontSize: {
      small: '10px',
      base: '11px',
      large: '13px',
      xlarge: '16px',
    },
    fontWeight: {
      normal: 400,
      medium: 500,
      bold: 600,
    },
    lineHeight: {
      tight: '1.1',
      normal: '1.4',
      relaxed: '1.6',
    },
  },
  layout: {
    borderRadius: '0px',
    transition: 'opacity 0.15s ease',
    overlayPosition: 'top-right',
    overlayOpacity: 0.8,
    animations: 'minimal',
  },
};
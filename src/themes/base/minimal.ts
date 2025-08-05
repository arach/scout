import { Theme } from '../types';

export const minimalOverlay: Theme = {
  id: 'minimal-overlay',
  name: 'Minimal Overlay',
  colors: {
    bgPrimary: 'rgba(0, 0, 0, 0.9)',   // More opaque for better readability
    bgSecondary: 'rgba(0, 0, 0, 0.95)', // Slightly more opaque
    bgTertiary: 'rgba(0, 0, 0, 0.98)',  // Nearly opaque for important content
    bgHover: 'rgba(255, 255, 255, 0.12)', // Slightly more visible hover
    bgActive: 'rgba(255, 255, 255, 0.18)', // More noticeable active state
    bgDanger: 'rgba(255, 0, 0, 0.25)',  // More visible danger state
    bgOverlay: 'rgba(0, 0, 0, 0.85)',   // Better backdrop
    
    textPrimary: 'rgba(255, 255, 255, 0.9)',
    textSecondary: 'rgba(255, 255, 255, 0.7)',
    textTertiary: 'rgba(255, 255, 255, 0.5)',
    textPlaceholder: 'rgba(255, 255, 255, 0.5)',
    textDanger: '#ff6b6b',
    textSuccess: '#51cf66',
    
    accentPrimary: '#4a9eff',
    accentHover: '#5aa7ff',
    accentActive: '#3a8eef',
    
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
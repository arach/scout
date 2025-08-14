import { Theme } from '../types';

export const vscodeLight: Theme = {
  id: 'vscode-light',
  name: 'VS Code Light',
  colors: {
    bgPrimary: '#ffffff',
    bgSecondary: '#f3f3f3',
    bgTertiary: '#f0f0f0',
    bgHover: '#e8e8e8',
    bgActive: '#dcdcdc',
    bgDanger: '#fee',
    
    textPrimary: '#1f2937',     // Darker for better contrast
    textSecondary: '#4b5563',   // Improved contrast ratio
    textTertiary: '#6b7280',    // Better accessibility
    textPlaceholder: '#9ca3af', // Lighter placeholder
    textDanger: '#d32f2f',
    textSuccess: '#388e3c',
    
    accentPrimary: '#007acc',
    accentHover: '#0080cc',
    accentActive: '#005a9e',
    
    borderPrimary: '#e0e0e0',
    borderHover: '#cccccc',
    
    shadowColor: 'rgba(0, 0, 0, 0.1)',
    bgOverlay: 'rgba(255, 255, 255, 0.95)',
    overlayBackdrop: 'rgba(0, 0, 0, 0.1)',
    
    // Scrollbar colors
    scrollbarTrack: '#f5f5f5',
    scrollbarThumb: '#c0c0c0',
    scrollbarThumbHover: '#888888',
    
    // Input colors
    bgInput: '#ffffff',
  },
  typography: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontFamilyMono: '"SF Mono", Monaco, Consolas, "Courier New", monospace',
    fontSize: {
      small: '11px',
      base: '13px',
      large: '16px',
      xlarge: '20px',
    },
    fontWeight: {
      normal: 400,
      medium: 500,
      bold: 600,
    },
    lineHeight: {
      tight: '1.2',
      normal: '1.5',
      relaxed: '1.75',
    },
  },
  layout: {
    borderRadius: '6px',
    transition: 'all 0.2s ease',
    animations: 'smooth',
    overlayPosition: 'center',
    overlayOpacity: 0.95,
  },
};

export const vscodeDark: Theme = {
  id: 'vscode-dark',
  name: 'VS Code Dark',
  colors: {
    bgPrimary: '#2a2a2a',         // Slightly lighter than VS Code's dark background
    bgSecondary: '#2f2f30',       // Slightly lighter than VS Code's sidebar background
    bgTertiary: '#353538',        // Slightly lighter than VS Code's editor group background
    bgHover: '#3e3e42',           // VS Code's hover state
    bgActive: '#37373d',          // VS Code's active state
    bgDanger: '#3a1d1d',
    
    textPrimary: '#cccccc',       // VS Code's default text color
    textSecondary: '#969696',     // VS Code's secondary text
    textTertiary: '#858585',      // VS Code's tertiary text
    textPlaceholder: '#767676',   // VS Code's placeholder text
    textDanger: '#ef5350',
    textSuccess: '#66bb6a',
    
    accentPrimary: '#0080ff',
    accentHover: '#1a8fff',
    accentActive: '#0066cc',
    
    borderPrimary: '#464647',     // VS Code's border color
    borderHover: '#5a5a5a',       // VS Code's hover border
    
    shadowColor: 'rgba(0, 0, 0, 0.3)',
    bgOverlay: 'rgba(42, 42, 42, 0.95)',
    overlayBackdrop: 'rgba(0, 0, 0, 0.5)',
    
    // Scrollbar colors
    scrollbarTrack: '#2a2a2a',
    scrollbarThumb: '#4a4a4a',
    scrollbarThumbHover: '#5a5a5a',
    
    // Input colors
    bgInput: '#3f3f46',
  },
  typography: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontFamilyMono: '"SF Mono", Monaco, Consolas, "Courier New", monospace',
    fontSize: {
      small: '11px',
      base: '13px',
      large: '16px',
      xlarge: '20px',
    },
    fontWeight: {
      normal: 400,
      medium: 500,
      bold: 600,
    },
    lineHeight: {
      tight: '1.2',
      normal: '1.5',
      relaxed: '1.75',
    },
  },
  layout: {
    borderRadius: '6px',
    transition: 'all 0.2s ease',
    animations: 'smooth',
    overlayPosition: 'center',
    overlayOpacity: 0.95,
  },
};
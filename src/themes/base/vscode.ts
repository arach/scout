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
    
    textPrimary: '#333333',
    textSecondary: '#666666',
    textTertiary: '#999999',
    textPlaceholder: '#999999',
    textDanger: '#d32f2f',
    textSuccess: '#388e3c',
    
    accentPrimary: '#007acc',
    accentHover: '#0080cc',
    accentActive: '#005a9e',
    
    borderPrimary: '#e0e0e0',
    borderHover: '#cccccc',
    
    shadowColor: 'rgba(0, 0, 0, 0.1)',
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
  },
};

export const vscodeDark: Theme = {
  id: 'vscode-dark',
  name: 'VS Code Dark',
  colors: {
    bgPrimary: '#1e1e1e',         // VS Code's actual dark background
    bgSecondary: '#252526',       // VS Code's sidebar background
    bgTertiary: '#2d2d30',        // VS Code's editor group background
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
  },
};
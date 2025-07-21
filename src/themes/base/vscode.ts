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
    bgPrimary: '#1a1a1a',
    bgSecondary: '#2a2a2a',
    bgTertiary: '#303030',
    bgHover: '#3a3a3a',
    bgActive: '#4a4a4a',
    bgDanger: '#2a1a1a',
    
    textPrimary: '#e0e0e0',
    textSecondary: '#b0b0b0',
    textPlaceholder: '#808080',
    textDanger: '#ef5350',
    textSuccess: '#66bb6a',
    
    accentPrimary: '#0080ff',
    accentHover: '#1a8fff',
    accentActive: '#0066cc',
    
    borderPrimary: '#3a3a3a',
    borderHover: '#4a4a4a',
    
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
import { Theme } from '../types';

export const terminalChic: Theme = {
  id: 'terminal-chic',
  name: 'Terminal Chic',
  colors: {
    // High contrast terminal backgrounds with better separation
    bgPrimary: '#0f0f0f',           // Slightly lighter for better contrast
    bgSecondary: '#1a1a1a',         // More distinct secondary
    bgTertiary: '#252525',          // Better card contrast
    bgHover: '#2a2a2a',             // More visible hover state
    bgActive: '#333333',            // Clear active state
    bgDanger: '#2a1515',            // Clearer danger state
    bgOverlay: 'rgba(0, 0, 0, 0.95)',
    
    // Terminal-inspired text colors
    textPrimary: '#e0e0e0',         // Bright terminal text
    textSecondary: '#a0a0a0',       // Dimmed terminal text
    textTertiary: '#606060',        // Even more dimmed text
    textPlaceholder: '#606060',     // Subtle placeholder
    textDanger: '#ff4444',          // Terminal red
    textSuccess: '#00ff41',         // Classic terminal green
    
    // Subtle white/grey accents instead of strong green
    accentPrimary: '#ffffff',       // Clean white
    accentHover: '#f0f0f0',         // Light grey hover
    accentActive: '#e0e0e0',        // Slightly darker active
    
    // Ultra-thin borders for that sleek terminal feel
    borderPrimary: '#404040',       // More visible grey border
    borderHover: '#555555',         // Brighter on hover for contrast
    
    // Minimal shadows
    shadowColor: 'rgba(0, 0, 0, 0.8)',
    overlayBackdrop: 'rgba(0, 0, 0, 0.9)',
  },
  typography: {
    // Pure monospace for that authentic terminal feel
    fontFamily: '"SF Mono", "JetBrains Mono", "Fira Code", Monaco, Consolas, "Courier New", monospace',
    fontFamilyMono: '"SF Mono", "JetBrains Mono", "Fira Code", Monaco, Consolas, "Courier New", monospace',
    fontSize: {
      small: '9px',     // More compact terminal text
      base: '11px',     // Smaller standard terminal size
      large: '12px',    // Smaller headers
      xlarge: '14px',   // Smaller titles
    },
    fontWeight: {
      normal: 300,      // Light weight for that thin terminal look
      medium: 400,      // Standard weight, still light
      bold: 500,        // "Bold" is just medium weight
    },
    lineHeight: {
      tight: '1.0',     // Very tight for terminal density
      normal: '1.2',    // Compact normal spacing
      relaxed: '1.4',   // Still quite tight
    },
  },
  layout: {
    borderRadius: '0px',              // Sharp, geometric edges
    transition: 'all 0.1s ease-out', // Snappy, minimal transitions
    overlayPosition: 'top-right',
    overlayOpacity: 0.95,
    animations: 'minimal',            // Very subtle animations
  },
};

export const terminalChicLight: Theme = {
  id: 'terminal-chic-light',
  name: 'Terminal Chic Light',
  colors: {
    // Inverted for light mode with paper-like feel
    bgPrimary: '#fafafa',           // Almost white
    bgSecondary: '#f5f5f5',         // Light grey
    bgTertiary: '#f0f0f0',          // Card backgrounds
    bgHover: '#eeeeee',             // Subtle hover
    bgActive: '#e8e8e8',            // Active state
    bgDanger: '#fef5f5',            // Light red tint
    bgOverlay: 'rgba(255, 255, 255, 0.95)',
    
    // Dark text on light for high contrast
    textPrimary: '#1a1a1a',         // Dark primary text
    textSecondary: '#4a4a4a',       // Medium grey
    textTertiary: '#9a9a9a',        // Light grey tertiary text
    textPlaceholder: '#9a9a9a',     // Light grey placeholder
    textDanger: '#cc0000',          // Dark red
    textSuccess: '#006600',         // Dark green
    
    // Clean dark accents for light theme
    accentPrimary: '#333333',       // Dark grey
    accentHover: '#444444',         // Medium grey hover
    accentActive: '#222222',        // Darker active
    
    // Thin light borders
    borderPrimary: '#d0d0d0',       // Light border
    borderHover: '#b0b0b0',         // Darker on hover
    
    shadowColor: 'rgba(0, 0, 0, 0.1)',
    overlayBackdrop: 'rgba(255, 255, 255, 0.9)',
  },
  typography: {
    fontFamily: '"SF Mono", "JetBrains Mono", "Fira Code", Monaco, Consolas, "Courier New", monospace',
    fontFamilyMono: '"SF Mono", "JetBrains Mono", "Fira Code", Monaco, Consolas, "Courier New", monospace',
    fontSize: {
      small: '9px',     // More compact terminal text
      base: '11px',     // Smaller standard terminal size
      large: '12px',    // Smaller headers
      xlarge: '14px',   // Smaller titles
    },
    fontWeight: {
      normal: 300,
      medium: 400,
      bold: 500,
    },
    lineHeight: {
      tight: '1.0',
      normal: '1.2',
      relaxed: '1.4',
    },
  },
  layout: {
    borderRadius: '0px',
    transition: 'all 0.1s ease-out',
    overlayPosition: 'top-right',
    overlayOpacity: 0.95,
    animations: 'minimal',
  },
};
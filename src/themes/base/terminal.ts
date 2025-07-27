import { Theme } from '../types';

export const terminalChic: Theme = {
  id: 'terminal-chic',
  name: 'Terminal Chic',
  colors: {
    // Simplified dark color scheme
    bgPrimary: '#1a1a1a',           // Very dark background
    bgSecondary: '#1a1a1a',         // Same dark for consistency
    bgTertiary: '#1a1a1a',          // No color variations - pure black theme
    bgHover: '#2a2a2a',             // Subtle hover state
    bgActive: '#333333',            // Slightly brighter active state
    bgDanger: '#3a1a1a',            // Subtle red tint for danger
    bgOverlay: 'rgba(26, 26, 26, 0.98)',
    
    // All text in light colors - no green
    textPrimary: '#f0f0f0',         // Light gray for primary text
    textSecondary: '#b0b0b0',       // Medium gray for secondary text
    textTertiary: '#808080',        // Darker gray for tertiary text
    textPlaceholder: '#606060',     // Subtle placeholder
    textDanger: '#ff6b6b',          // Soft red for errors
    textSuccess: '#f0f0f0',         // No green - use same as primary
    
    // Minimal accent colors
    accentPrimary: '#f0f0f0',       // Light gray accent
    accentHover: '#ffffff',         // White on hover
    accentActive: '#e0e0e0',        // Slightly darker active
    
    // Very subtle borders
    borderPrimary: '#333333',       // Subtle border
    borderHover: '#404040',         // Slightly brighter on hover
    
    // Minimal shadows
    shadowColor: 'rgba(0, 0, 0, 0.5)',
    overlayBackdrop: 'rgba(0, 0, 0, 0.95)',
  },
  typography: {
    // Monospace font stack for terminal aesthetic
    fontFamily: '"SF Mono", "JetBrains Mono", "Fira Code", Monaco, Consolas, "Courier New", monospace',
    fontFamilyMono: '"SF Mono", "JetBrains Mono", "Fira Code", Monaco, Consolas, "Courier New", monospace',
    fontSize: {
      small: '11px',    // Small but readable
      base: '12px',     // Compact base size for tech-savvy users
      large: '14px',    // Modest headers
      xlarge: '16px',   // Still relatively small titles
    },
    fontWeight: {
      normal: 400,      // Normal weight for better readability
      medium: 500,      // Medium weight
      bold: 600,        // Actual bold for emphasis
    },
    lineHeight: {
      tight: '1.3',     // Tight but not cramped
      normal: '1.5',    // Good readability
      relaxed: '1.6',   // Comfortable spacing
    },
  },
  layout: {
    borderRadius: '0px',              // Sharp corners - no rounded edges
    transition: 'all 0.1s ease-out', // Snappy transitions
    overlayPosition: 'top-right',
    overlayOpacity: 0.98,
    animations: 'minimal',            // Minimal animations
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
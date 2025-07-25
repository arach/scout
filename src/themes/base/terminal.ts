import { Theme } from '../types';

export const terminalChic: Theme = {
  id: 'terminal-chic',
  name: 'Terminal Chic',
  colors: {
    // Sophisticated dark terminal with better contrast
    bgPrimary: 'hsl(240, 10%, 3.9%)',      // Rich dark background
    bgSecondary: 'hsl(240, 6%, 10%)',       // Elevated surface
    bgTertiary: 'hsl(240, 5%, 14%)',        // Card/group backgrounds
    bgHover: 'hsl(240, 4%, 16%)',           // Sophisticated hover
    bgActive: 'hsl(240, 5%, 21%)',          // Active state
    bgDanger: 'hsl(0, 84%, 8%)',            // Dark danger state
    bgOverlay: 'hsla(240, 10%, 3.9%, 0.95)',
    
    // Enhanced terminal text hierarchy
    textPrimary: 'hsl(0, 0%, 98%)',         // High contrast primary
    textSecondary: 'hsl(240, 5%, 65%)',     // Refined secondary
    textTertiary: 'hsl(240, 4%, 46%)',      // Subtle tertiary
    textPlaceholder: 'hsl(240, 4%, 40%)',   // Muted placeholder
    textDanger: 'hsl(0, 84%, 60%)',         // Terminal red
    textSuccess: 'hsl(142, 76%, 36%)',      // Terminal green
    
    // Refined accent system
    accentPrimary: 'hsl(210, 40%, 70%)',    // Subtle blue accent
    accentHover: 'hsl(210, 40%, 75%)',      // Lighter on hover
    accentActive: 'hsl(210, 40%, 65%)',     // Darker when active
    
    // Sophisticated border system
    borderPrimary: 'hsl(240, 4%, 16%)',     // Subtle primary border
    borderHover: 'hsl(240, 5%, 26%)',       // Enhanced on hover
    
    // Enhanced shadows for depth
    shadowColor: 'hsla(240, 10%, 3.9%, 0.5)',
    overlayBackdrop: 'hsla(240, 10%, 3.9%, 0.9)',
  },
  typography: {
    // Enhanced monospace stack with better rendering
    fontFamily: '"SF Mono", "JetBrains Mono", "Fira Code", Monaco, Consolas, "Courier New", monospace',
    fontFamilyMono: '"SF Mono", "JetBrains Mono", "Fira Code", Monaco, Consolas, "Courier New", monospace',
    fontSize: {
      small: '12px',    // Readable small text
      base: '13px',     // Comfortable base size
      large: '14px',    // Clear headers
      xlarge: '16px',   // Prominent titles
    },
    fontWeight: {
      normal: 400,      // Standard readable weight
      medium: 500,      // Medium emphasis
      bold: 600,        // Strong emphasis
    },
    lineHeight: {
      tight: '1.25',    // Compact but readable
      normal: '1.5',    // Comfortable reading
      relaxed: '1.75',  // Spacious when needed
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
    // Sophisticated light terminal with enhanced contrast
    bgPrimary: 'hsl(0, 0%, 98%)',           // Pure white background
    bgSecondary: 'hsl(210, 20%, 96%)',      // Subtle tinted secondary
    bgTertiary: 'hsl(210, 20%, 94%)',       // Card backgrounds
    bgHover: 'hsl(210, 20%, 92%)',          // Enhanced hover
    bgActive: 'hsl(210, 20%, 88%)',         // Clear active state
    bgDanger: 'hsl(0, 100%, 97%)',          // Light danger tint
    bgOverlay: 'hsla(0, 0%, 98%, 0.95)',
    
    // Refined text hierarchy for light mode
    textPrimary: 'hsl(240, 10%, 10%)',      // Deep primary text
    textSecondary: 'hsl(240, 6%, 30%)',     // Sophisticated secondary
    textTertiary: 'hsl(240, 4%, 54%)',      // Balanced tertiary
    textPlaceholder: 'hsl(240, 4%, 60%)',   // Subtle placeholder
    textDanger: 'hsl(0, 84%, 40%)',         // Terminal red
    textSuccess: 'hsl(142, 76%, 30%)',      // Terminal green
    
    // Refined accent system for light mode
    accentPrimary: 'hsl(210, 100%, 40%)',   // Clean blue accent
    accentHover: 'hsl(210, 100%, 35%)',     // Darker on hover
    accentActive: 'hsl(210, 100%, 45%)',    // Lighter when active
    
    // Sophisticated border system
    borderPrimary: 'hsl(210, 20%, 84%)',    // Subtle borders
    borderHover: 'hsl(210, 20%, 74%)',      // Enhanced on hover
    
    shadowColor: 'hsla(240, 10%, 10%, 0.1)',
    overlayBackdrop: 'hsla(0, 0%, 98%, 0.9)',
  },
  typography: {
    fontFamily: '"SF Mono", "JetBrains Mono", "Fira Code", Monaco, Consolas, "Courier New", monospace',
    fontFamilyMono: '"SF Mono", "JetBrains Mono", "Fira Code", Monaco, Consolas, "Courier New", monospace',
    fontSize: {
      small: '12px',    // Readable small text
      base: '13px',     // Comfortable base size
      large: '14px',    // Clear headers
      xlarge: '16px',   // Prominent titles
    },
    fontWeight: {
      normal: 400,      // Standard readable weight
      medium: 500,      // Medium emphasis
      bold: 600,        // Strong emphasis
    },
    lineHeight: {
      tight: '1.25',    // Compact but readable
      normal: '1.5',    // Comfortable reading
      relaxed: '1.75',  // Spacious when needed
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
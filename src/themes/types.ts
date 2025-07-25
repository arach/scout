export type ThemeVariant = 
  | 'vscode-light' 
  | 'vscode-dark'
  | 'minimal-overlay'
  | 'winamp-classic' 
  | 'winamp-modern'
  | 'terminal-chic'
  | 'terminal-chic-light'
  | 'system';

export interface ThemeColors {
  // Background colors
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  bgHover: string;
  bgActive: string;
  bgDanger: string;
  bgOverlay?: string;
  
  // Text colors
  textPrimary: string;
  textSecondary: string;
  textPlaceholder: string;
  textDanger: string;
  textSuccess: string;
  
  // Accent colors
  accentPrimary: string;
  accentHover: string;
  accentActive: string;
  
  // Border colors
  borderPrimary: string;
  borderHover: string;
  
  // Special colors
  shadowColor?: string;
  overlayBackdrop?: string;
}

export interface ThemeTypography {
  fontFamily: string;
  fontFamilyMono: string;
  fontSize: {
    small: string;
    base: string;
    large: string;
    xlarge: string;
  };
  fontWeight: {
    normal: number;
    medium: number;
    bold: number;
  };
  lineHeight: {
    tight: string;
    normal: string;
    relaxed: string;
  };
}

export interface ThemeLayout {
  borderRadius: string;
  transition: string;
  overlayPosition?: 'top-left' | 'top-center' | 'top-right' | 'center-left' | 'center' | 'center-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
  overlayOpacity?: number;
  animations?: 'smooth' | 'retro' | 'minimal' | 'none';
}

export interface Theme {
  id: ThemeVariant;
  name: string;
  colors: ThemeColors;
  typography: ThemeTypography;
  layout: ThemeLayout;
}

export interface ThemeContextType {
  theme: Theme;
  setTheme: (themeId: ThemeVariant) => void;
  themes: Record<ThemeVariant, Theme>;
}
import React from 'react';
import { useTheme } from '../themes/ThemeProvider';
import './TerminalLoaders.css';

interface TerminalSpinnerProps {
  type?: 'default' | 'braille' | 'dots' | 'bounce' | 'clock' | 'square';
  size?: 'small' | 'medium' | 'large';
  className?: string;
}

interface TerminalProgressBarProps {
  progress: number; // 0-100
  label?: string;
  showPercentage?: boolean;
  className?: string;
}

interface TerminalStatusDotProps {
  status: 'idle' | 'recording' | 'processing' | 'complete' | 'error';
  className?: string;
}

// ASCII Spinner Component
export const TerminalSpinner: React.FC<TerminalSpinnerProps> = ({ 
  type = 'default', 
  size = 'medium',
  className = '' 
}) => {
  const { theme } = useTheme();
  
  // Only show ASCII spinners for Terminal Chic themes
  if (!theme.id.includes('terminal-chic')) {
    return <div className={`processing-spinner ${className}`} />;
  }

  const spinnerClass = `terminal-spinner terminal-spinner-${type} terminal-spinner-${size} ${className}`;
  
  return (
    <span className={spinnerClass}>
      {type === 'default' && <span className="spinner-content">|</span>}
      {type === 'braille' && <span className="spinner-content">⠋</span>}
      {type === 'dots' && <span className="spinner-content"></span>}
      {type === 'bounce' && <span className="spinner-content">●○○</span>}
      {type === 'clock' && <span className="spinner-content">🕐</span>}
      {type === 'square' && <span className="spinner-content">▖</span>}
    </span>
  );
};

// ASCII Progress Bar Component
export const TerminalProgressBar: React.FC<TerminalProgressBarProps> = ({ 
  progress, 
  label, 
  showPercentage = true,
  className = '' 
}) => {
  const { theme } = useTheme();
  
  // Only show ASCII progress for Terminal Chic themes
  if (!theme.id.includes('terminal-chic')) {
    return (
      <div className={`progress-bar ${className}`}>
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>
    );
  }

  // Generate ASCII progress bar
  const barLength = 10;
  const filledBars = Math.round((progress / 100) * barLength);
  const emptyBars = barLength - filledBars;
  
  const progressBar = '[' + 
    '█'.repeat(filledBars) + 
    ' '.repeat(emptyBars) + 
    ']';
  
  const percentageText = showPercentage ? ` ${Math.round(progress)}%` : '';
  const labelText = label ? `${label}: ` : '';
  
  return (
    <div className={`terminal-progress-bar ${className}`}>
      <span className="terminal-progress-content">
        {labelText}{progressBar}{percentageText}
      </span>
    </div>
  );
};

// ASCII Status Dot Component
export const TerminalStatusDot: React.FC<TerminalStatusDotProps> = ({ 
  status, 
  className = '' 
}) => {
  const { theme } = useTheme();
  
  // Only show ASCII dots for Terminal Chic themes
  if (!theme.id.includes('terminal-chic')) {
    return <div className={`status-dot ${status} ${className}`} />;
  }

  const getStatusSymbol = (status: string) => {
    switch (status) {
      case 'recording': return '●';
      case 'processing': return '◐';
      case 'complete': return '✓';
      case 'error': return '✗';
      case 'idle':
      default: return '○';
    }
  };

  return (
    <span className={`terminal-status-dot terminal-status-${status} ${className}`}>
      {getStatusSymbol(status)}
    </span>
  );
};

// Terminal Processing Text with Cursor
interface TerminalProcessingTextProps {
  text: string;
  showCursor?: boolean;
  className?: string;
}

export const TerminalProcessingText: React.FC<TerminalProcessingTextProps> = ({
  text,
  showCursor = true,
  className = ''
}) => {
  const { theme } = useTheme();
  
  if (!theme.id.includes('terminal-chic')) {
    return <span className={className}>{text}</span>;
  }

  return (
    <span className={`terminal-processing-text ${className}`}>
      {text}
      {showCursor && <span className="terminal-cursor">▊</span>}
    </span>
  );
};

// Higher-order component to wrap existing loaders with Terminal styling
interface WithTerminalLoadingProps {
  children: React.ReactNode;
  type?: 'spinner' | 'progress' | 'status';
}

export const WithTerminalLoading: React.FC<WithTerminalLoadingProps> = ({ 
  children, 
  type = 'spinner' 
}) => {
  const { theme } = useTheme();
  
  if (!theme.id.includes('terminal-chic')) {
    return <>{children}</>;
  }

  return (
    <div className={`terminal-loading-wrapper terminal-loading-${type}`}>
      {children}
    </div>
  );
};

// Hook for terminal loading states
export const useTerminalLoading = () => {
  const { theme } = useTheme();
  
  const isTerminalTheme = theme.id.includes('terminal-chic');
  
  return {
    isTerminalTheme,
    spinnerComponent: (props: TerminalSpinnerProps) => <TerminalSpinner {...props} />,
    progressComponent: (props: TerminalProgressBarProps) => <TerminalProgressBar {...props} />,
    statusComponent: (props: TerminalStatusDotProps) => <TerminalStatusDot {...props} />,
    processingText: (props: TerminalProcessingTextProps) => <TerminalProcessingText {...props} />
  };
};

// Export everything for easy importing
export default {
  TerminalSpinner,
  TerminalProgressBar,
  TerminalStatusDot,
  TerminalProcessingText,
  WithTerminalLoading,
  useTerminalLoading
};
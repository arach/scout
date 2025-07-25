import React, { Component, ErrorInfo, ReactNode } from 'react';
import { loggers } from '../utils/logger';
import './ErrorBoundary.css';

// Error boundary props interface
interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  isolate?: boolean; // If true, only catches errors from direct children
  name?: string; // Name for logging purposes
}

// Error boundary state interface
interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
  errorId?: string;
}

/**
 * Enhanced Error Boundary Component
 * 
 * Catches JavaScript errors anywhere in the child component tree,
 * logs those errors, and displays a fallback UI instead of crashing.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private retryCount = 0;
  private readonly maxRetries = 3;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    // Update state so the next render will show the fallback UI
    const errorId = `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    return {
      hasError: true,
      error,
      errorId,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const { onError, name = 'Unknown' } = this.props;
    const errorId = this.state.errorId || 'unknown';

    // Log the error with context
    loggers.ui.error(`Error caught by ${name} boundary`, {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      errorId,
      retryCount: this.retryCount,
    });

    // Call custom error handler if provided
    if (onError) {
      try {
        onError(error, errorInfo);
      } catch (handlerError) {
        loggers.ui.error('Error in custom error handler', handlerError);
      }
    }

    // Report to external error tracking if available
    this.reportToErrorTracking(error, errorInfo, errorId);
  }

  private reportToErrorTracking(error: Error, errorInfo: ErrorInfo, errorId: string) {
    // In a real app, you might send this to Sentry, LogRocket, etc.
    // For now, we'll just ensure it's logged properly
    if (process.env.NODE_ENV === 'production') {
      // Could integrate with error tracking service here
      console.error('Production Error:', {
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
        errorId,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        url: window.location.href,
      });
    }
  }

  private handleRetry = () => {
    if (this.retryCount < this.maxRetries) {
      this.retryCount++;
      loggers.ui.info(`Retrying component render (attempt ${this.retryCount}/${this.maxRetries})`);
      this.setState({ hasError: false, error: undefined, errorInfo: undefined });
    } else {
      loggers.ui.warn('Max retry attempts reached, component remains in error state');
    }
  };

  private handleReload = () => {
    loggers.ui.info('User requested page reload from error boundary');
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      const { fallback, name = 'Component' } = this.props;
      const { error, errorId } = this.state;
      const canRetry = this.retryCount < this.maxRetries;

      // Use custom fallback if provided
      if (fallback) {
        return fallback;
      }

      // Default error UI
      return (
        <div className="error-boundary">
          <div className="error-boundary-content">
            <div className="error-boundary-icon">⚠️</div>
            <h2 className="error-boundary-title">Something went wrong</h2>
            <p className="error-boundary-message">
              {name} encountered an unexpected error and couldn't be displayed.
            </p>
            
            {process.env.NODE_ENV === 'development' && (
              <details className="error-boundary-details">
                <summary>Error Details (Development)</summary>
                <div className="error-boundary-error-info">
                  <p><strong>Error ID:</strong> {errorId}</p>
                  <p><strong>Message:</strong> {error?.message}</p>
                  <pre className="error-boundary-stack">
                    {error?.stack}
                  </pre>
                </div>
              </details>
            )}

            <div className="error-boundary-actions">
              {canRetry && (
                <button 
                  className="error-boundary-button error-boundary-button-primary"
                  onClick={this.handleRetry}
                  type="button"
                >
                  Try Again ({this.maxRetries - this.retryCount} attempts left)
                </button>
              )}
              <button 
                className="error-boundary-button error-boundary-button-secondary"
                onClick={this.handleReload}
                type="button"
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Hook-based Error Boundary for functional components
 * Note: This doesn't actually catch errors (only class components can),
 * but provides a way to trigger error boundaries from functional components
 */
export const useErrorHandler = () => {
  return React.useCallback((error: Error, _errorInfo?: { componentStack?: string }) => {
    // This will be caught by the nearest error boundary
    throw error;
  }, []);
};

/**
 * Higher-order component to wrap components with error boundary
 */
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  errorBoundaryProps?: Omit<ErrorBoundaryProps, 'children'>
) {
  const WrappedComponent = (props: P) => (
    <ErrorBoundary {...errorBoundaryProps} name={Component.displayName || Component.name}>
      <Component {...props} />
    </ErrorBoundary>
  );

  WrappedComponent.displayName = `withErrorBoundary(${Component.displayName || Component.name})`;
  return WrappedComponent;
}

/**
 * Specialized error boundaries for different parts of the app
 */

// Audio processing error boundary
export const AudioErrorBoundary: React.FC<{ children: ReactNode }> = ({ children }) => (
  <ErrorBoundary
    name="Audio"
    fallback={
      <div className="audio-error-fallback">
        <p>Audio system encountered an error. Recording may not work properly.</p>
        <p>Try refreshing the page or checking your microphone permissions.</p>
      </div>
    }
    onError={(error) => {
      loggers.audio.error('Audio component error', error);
    }}
  >
    {children}
  </ErrorBoundary>
);

// Transcription error boundary
export const TranscriptionErrorBoundary: React.FC<{ children: ReactNode }> = ({ children }) => (
  <ErrorBoundary
    name="Transcription"
    fallback={
      <div className="transcription-error-fallback">
        <p>Transcription view encountered an error.</p>
        <p>Your transcripts are safe. Try refreshing to restore the view.</p>
      </div>
    }
    onError={(error) => {
      loggers.transcription.error('Transcription component error', error);
    }}
  >
    {children}
  </ErrorBoundary>
);

// Settings error boundary
export const SettingsErrorBoundary: React.FC<{ children: ReactNode }> = ({ children }) => (
  <ErrorBoundary
    name="Settings"
    fallback={
      <div className="settings-error-fallback">
        <p>Settings panel encountered an error.</p>
        <p>Your settings are preserved. The error has been logged.</p>
      </div>
    }
    onError={(error) => {
      loggers.settings.error('Settings component error', error);
    }}
  >
    {children}
  </ErrorBoundary>
);

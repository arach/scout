import { useCallback } from 'react';
import { loggers } from '../utils/logger';
import { getErrorMessage, isRecordingError } from '../types/errors';

export interface ErrorHandlerOptions {
  fallbackMessage?: string;
  showNotification?: boolean;
  logToConsole?: boolean;
}

export function useErrorHandler() {
  const handleError = useCallback((
    error: unknown, 
    context: string, 
    options: ErrorHandlerOptions = {}
  ) => {
    const {
      fallbackMessage = 'An error occurred',
      showNotification = true,
      logToConsole = true
    } = options;

    const errorMessage = getErrorMessage(error);
    
    // Log to appropriate logger
    if (logToConsole) {
      loggers.ui.error(`Error in ${context}`, { error, errorMessage });
    }

    // Handle specific error types
    if (isRecordingError(error)) {
      switch (error.type) {
        case 'ALREADY_RECORDING':
          // Don't show notification for this - it's expected
          return;
        case 'PERMISSION_DENIED':
          if (showNotification) {
            // TODO: Show permission request UI
            console.error('Microphone permission denied');
          }
          break;
        case 'NO_DEVICE':
          if (showNotification) {
            // TODO: Show device selection UI
            console.error('No audio device found');
          }
          break;
      }
    }

    // Show user notification if needed
    if (showNotification) {
      // TODO: Integrate with a proper notification system
      // For now, we'll just log it
      console.error(`${context}: ${errorMessage || fallbackMessage}`);
    }

    return errorMessage;
  }, []);

  const withErrorHandler = useCallback(<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    context: string,
    options?: ErrorHandlerOptions
  ): T => {
    return (async (...args: Parameters<T>) => {
      try {
        return await fn(...args);
      } catch (error) {
        handleError(error, context, options);
        throw error; // Re-throw to allow caller to handle if needed
      }
    }) as T;
  }, [handleError]);

  return {
    handleError,
    withErrorHandler
  };
}
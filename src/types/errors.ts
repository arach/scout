/**
 * Type-safe error handling for the Scout application
 */

export interface TauriError {
  message: string;
  code?: string;
  details?: unknown;
}

export interface RecordingError extends TauriError {
  type: 'ALREADY_RECORDING' | 'NO_DEVICE' | 'PERMISSION_DENIED' | 'UNKNOWN';
}

export interface TranscriptionError extends TauriError {
  type: 'FILE_NOT_FOUND' | 'INVALID_FORMAT' | 'PROCESSING_FAILED' | 'UNKNOWN';
}

export interface NetworkError extends TauriError {
  status?: number;
  statusText?: string;
}

// Type guard functions
export function isTauriError(error: unknown): error is TauriError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as any).message === 'string'
  );
}

export function isRecordingError(error: unknown): error is RecordingError {
  return isTauriError(error) && 'type' in error;
}

export function hasErrorMessage(error: unknown): error is { message: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as any).message === 'string'
  );
}

export function getErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (hasErrorMessage(error)) return error.message;
  return 'An unknown error occurred';
}
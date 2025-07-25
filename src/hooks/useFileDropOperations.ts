import { useCallback, useRef } from 'react';
import { invokeTyped } from '../types/tauri';
import { loggers } from '../utils/logger';
import { useFileDrop } from './useFileDrop';

interface UploadProgress {
  filename?: string;
  fileSize?: number;
  status: 'idle' | 'uploading' | 'queued' | 'processing' | 'converting' | 'transcribing';
  queuePosition?: number;
  progress?: number;
}

interface UseFileDropOperationsOptions {
  isProcessing: boolean;
  setIsProcessing: (processing: boolean) => void;
  setUploadProgress: (progress: UploadProgress) => void;
}

/**
 * Custom hook for file drop and upload operations
 * Extracted from AppContent.tsx to reduce component size and improve reusability
 */
export function useFileDropOperations({ 
  isProcessing, 
  setIsProcessing, 
  setUploadProgress 
}: UseFileDropOperationsOptions) {
  const processingFileRef = useRef<string | null>(null);

  const handleFileDropped = useCallback(async (filePath: string) => {
    try {
      setIsProcessing(true);
      const filename = filePath.split('/').pop() || 'audio file';
      processingFileRef.current = filename;
      
      setUploadProgress({
        filename: filename,
        status: 'uploading',
        progress: 0
      });

      await invokeTyped<string>('transcribe_file', { 
        filePath: filePath 
      });
      
      loggers.transcription.info(`Successfully processed file: ${filename}`);
    } catch (error) {
      loggers.transcription.error('Failed to process dropped file', error);
      
      // Show user-friendly error
      const errorMessage = error instanceof Error ? error.message : String(error);
      alert(`Failed to process file: ${errorMessage}`);
      
      // Reset state
      setIsProcessing(false);
      processingFileRef.current = null;
      
      setUploadProgress({
        filename: processingFileRef.current || 'unknown',
        status: 'idle', // Reset to idle on error since 'error' is not in the union type
        progress: 0
      });
    }
  }, [setIsProcessing, setUploadProgress]);

  const { isDragging } = useFileDrop({
    isProcessing,
    onFileDropped: handleFileDropped
  });

  return {
    isDragging,
    processingFileRef,
    handleFileDropped,
  };
}
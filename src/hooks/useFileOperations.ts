import { useCallback } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { invokeTyped } from '../types/tauri';
import { loggers } from '../utils/logger';

/**
 * Custom hook for file operations and uploads
 * Extracted from AppContent.tsx to reduce component complexity
 */
export const useFileOperations = () => {
  
  /**
   * Handle file upload with dialog picker
   */
  const handleFileUpload = useCallback(async (): Promise<{
    success: boolean;
    filePath?: string;
    fileName?: string;
    error?: string;
  }> => {
    try {
      // Open file dialog
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'Audio',
          extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'wma']
        }],
      });

      if (!selected) {
        loggers.ui.debug('File upload cancelled by user');
        return { success: false };
      }

      const filePath = Array.isArray(selected) ? selected[0] : selected;
      const fileName = filePath.split('/').pop() || 'Unknown';
      
      loggers.ui.info('File selected for upload', { fileName, filePath });

      // Start transcription
      const transcriptionId = await invokeTyped<string>('transcribe_file', {
        filePath,
        fileName,
        language: 'auto' // Could be made configurable
      });

      loggers.transcription.info('File transcription started', { 
        fileName, 
        transcriptionId 
      });

      return {
        success: true,
        filePath,
        fileName
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      loggers.ui.error('File upload failed', error);
      
      return {
        success: false,
        error: errorMessage
      };
    }
  }, []);

  /**
   * Validate file type and size
   */
  const validateFile = useCallback((file: File): {
    valid: boolean;
    error?: string;
  } => {
    const maxSizeBytes = 100 * 1024 * 1024; // 100MB
    const allowedTypes = [
      'audio/mpeg',
      'audio/wav', 
      'audio/mp4',
      'audio/aac',
      'audio/flac',
      'audio/ogg',
      'audio/x-ms-wma'
    ];

    if (file.size > maxSizeBytes) {
      return {
        valid: false,
        error: `File size too large. Maximum size is 100MB, got ${(file.size / 1024 / 1024).toFixed(1)}MB`
      };
    }

    if (!allowedTypes.includes(file.type)) {
      return {
        valid: false,
        error: `Unsupported file type: ${file.type}. Supported types: ${allowedTypes.join(', ')}`
      };
    }

    return { valid: true };
  }, []);

  /**
   * Handle drag and drop file upload
   */
  const handleDroppedFile = useCallback(async (file: File): Promise<{
    success: boolean;
    fileName?: string;
    error?: string;
  }> => {
    const validation = validateFile(file);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error
      };
    }

    try {
      // For dropped files, we need to save them to a temporary location first
      // This would require additional Tauri commands to handle file copying
      loggers.ui.info('Processing dropped file', { 
        fileName: file.name, 
        size: file.size,
        type: file.type 
      });

      // TODO: Implement file copying to temp directory and transcription
      // For now, just return success to demonstrate the structure
      
      return {
        success: true,
        fileName: file.name
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      loggers.ui.error('Dropped file processing failed', error);
      
      return {
        success: false,
        error: errorMessage
      };
    }
  }, [validateFile]);

  /**
   * Get file extension from filename
   */
  const getFileExtension = useCallback((filename: string): string => {
    const parts = filename.split('.');
    return parts.length > 1 ? parts.pop()?.toLowerCase() || '' : '';
  }, []);

  /**
   * Check if file extension is supported
   */
  const isSupportedFileType = useCallback((filename: string): boolean => {
    const extension = getFileExtension(filename);
    const supportedExtensions = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'wma'];
    return supportedExtensions.includes(extension);
  }, [getFileExtension]);

  return {
    handleFileUpload,
    validateFile,
    handleDroppedFile,
    getFileExtension,
    isSupportedFileType,
  };
};

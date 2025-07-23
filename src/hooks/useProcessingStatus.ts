import { useEffect, useRef } from 'react';
import { safeEventListen, cleanupListeners } from '../lib/safeEventListener';

interface ProcessingStatus {
  Queued?: { position: number };
  Processing?: { filename: string };
  Converting?: { filename: string };
  Transcribing?: { filename: string };
  Complete?: any;
  Failed?: { error?: string };
}

interface UploadProgress {
  filename?: string;
  fileSize?: number;
  status: 'idle' | 'uploading' | 'queued' | 'processing' | 'converting' | 'transcribing';
  queuePosition?: number;
  progress?: number;
}

interface UseProcessingStatusOptions {
  setUploadProgress: (progress: UploadProgress | ((prev: UploadProgress) => UploadProgress)) => void;
  setIsProcessing: (processing: boolean) => void;
  onProcessingComplete?: () => void;
  onProcessingFailed?: (error: string) => void;
}

export function useProcessingStatus(options: UseProcessingStatusOptions) {
  const {
    setUploadProgress,
    setIsProcessing,
    onProcessingComplete,
    onProcessingFailed,
  } = options;

  const processingFileRef = useRef<string | null>(null);
  const processingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Skip if no callbacks are provided (e.g., during onboarding)
    if (!setUploadProgress && !setIsProcessing) {
      return;
    }
    
    let mounted = true;
    const cleanupFunctions: Array<() => void> = [];
    
    // Listen for processing status updates from the background queue
    safeEventListen<ProcessingStatus>('processing-status', (event) => {
      if (!mounted) return;
      const status = event.payload;
      
      // Update UI based on processing status
      if (status.Queued) {
        const queuedStatus = status.Queued;
        if (queuedStatus.position !== undefined) {
          setUploadProgress(prev => ({
            ...prev,
            status: 'queued',
            queuePosition: queuedStatus.position
          }));
        }
      } else if (status.Processing) {
        const processingStatus = status.Processing;
        if (processingStatus.filename) {
          setUploadProgress(prev => ({
            ...prev,
            status: 'processing',
            filename: processingStatus.filename
          }));
        }
      } else if (status.Converting) {
        const convertingStatus = status.Converting;
        if (convertingStatus.filename) {
          setUploadProgress(prev => ({
            ...prev,
            status: 'converting',
            filename: convertingStatus.filename
          }));
        }
      } else if (status.Transcribing) {
        const transcribingStatus = status.Transcribing;
        if (transcribingStatus.filename) {
          setUploadProgress(prev => ({
            ...prev,
            status: 'transcribing',
            filename: transcribingStatus.filename
          }));
        }
      } else if (status.Complete) {
        // Transcription complete
        setUploadProgress({ status: 'idle' });
        if (processingTimeoutRef.current) {
          clearTimeout(processingTimeoutRef.current);
          processingTimeoutRef.current = null;
        }
        setIsProcessing(false);
        processingFileRef.current = null; // Clear the processing file reference
        
        onProcessingComplete?.();
      } else if (status.Failed) {
        console.error("Processing failed:", status.Failed);
        if (processingTimeoutRef.current) {
          clearTimeout(processingTimeoutRef.current);
          processingTimeoutRef.current = null;
        }
        setIsProcessing(false);
        processingFileRef.current = null; // Clear the processing file reference
        setUploadProgress({ status: 'idle' });
        
        const errorMsg = status.Failed?.error || 'Unknown error';
        onProcessingFailed?.(errorMsg);
        
        // Show error message to user
        alert(`Failed to process audio file: ${errorMsg}`);
      }
    }).then(cleanup => cleanupFunctions.push(cleanup));
    
    // Listen for file upload complete events
    safeEventListen('file-upload-complete', (event) => {
      if (!mounted) return;
      const data = event.payload as any;
      
      // Update upload progress with file info
      setUploadProgress(prev => ({
        ...prev,
        filename: data.originalName || data.filename,
        fileSize: data.size,
        status: 'queued'
      }));
    }).then(cleanup => cleanupFunctions.push(cleanup));

    return () => {
      mounted = false;
      // Use the safe cleanup utility
      cleanupListeners(cleanupFunctions);
    };
  }, [setUploadProgress, setIsProcessing, onProcessingComplete, onProcessingFailed]);

  return {
    processingFileRef,
    processingTimeoutRef,
  };
}
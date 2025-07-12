import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';

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
    // Listen for processing status updates from the background queue
    const unsubscribeProcessing = listen<ProcessingStatus>('processing-status', (event) => {
      const status = event.payload;
      
      // Update UI based on processing status
      if (status.Queued) {
        setUploadProgress(prev => ({
          ...prev,
          status: 'queued',
          queuePosition: status.Queued.position
        }));
      } else if (status.Processing) {
        setUploadProgress(prev => ({
          ...prev,
          status: 'processing',
          filename: status.Processing.filename
        }));
      } else if (status.Converting) {
        setUploadProgress(prev => ({
          ...prev,
          status: 'converting',
          filename: status.Converting.filename
        }));
      } else if (status.Transcribing) {
        setUploadProgress(prev => ({
          ...prev,
          status: 'transcribing',
          filename: status.Transcribing.filename
        }));
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
        
        const errorMsg = status.Failed.error || 'Unknown error';
        onProcessingFailed?.(errorMsg);
        
        // Show error message to user
        alert(`Failed to process audio file: ${errorMsg}`);
      }
    });
    
    // Listen for file upload complete events
    const unsubscribeFileUpload = listen('file-upload-complete', (event) => {
      const data = event.payload as any;
      
      // Update upload progress with file info
      setUploadProgress(prev => ({
        ...prev,
        filename: data.originalName || data.filename,
        fileSize: data.size,
        status: 'queued'
      }));
    });

    return () => {
      unsubscribeProcessing.then(fn => fn());
      unsubscribeFileUpload.then(fn => fn());
    };
  }, [setUploadProgress, setIsProcessing, onProcessingComplete, onProcessingFailed]);

  return {
    processingFileRef,
    processingTimeoutRef,
  };
}
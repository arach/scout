import { useState, useEffect, useRef } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
// import { invoke } from '@tauri-apps/api/core'; // Unused import

interface UseFileDropOptions {
  onFileDropped?: (filePath: string) => void;
  isProcessing?: boolean;
}

export function useFileDrop(options: UseFileDropOptions = {}) {
  const { onFileDropped, isProcessing = false } = options;
  const [isDragging, setIsDragging] = useState(false);
  const processingFileRef = useRef<string | null>(null);

  useEffect(() => {
    let unsubscribeFileDrop: (() => void) | undefined;

    const setupFileDrop = async () => {
      const webview = getCurrentWebview();
      
      unsubscribeFileDrop = await webview.onDragDropEvent(async (event) => {
        // Check the event type from the event name
        if (event.event === 'tauri://drag-over') {
          setIsDragging(true);
        } else if (event.event === 'tauri://drag-drop') {
          setIsDragging(false);
          
          const files = (event.payload as any).paths;
          
          // Check if we're already processing to prevent duplicates
          if (isProcessing) {
            return;
          }
          
          const audioFiles = files.filter((filePath: string) => {
            const extension = filePath.split('.').pop()?.toLowerCase();
            return ['wav', 'mp3', 'm4a', 'flac', 'ogg', 'webm'].includes(extension || '');
          });

          if (audioFiles.length > 0) {
            // Process the first audio file
            const filePath = audioFiles[0];
            
            // Check if we're already processing this specific file
            if (processingFileRef.current === filePath) {
              return;
            }
            
            // Mark this file as being processed
            processingFileRef.current = filePath;
            
            // Call the callback
            onFileDropped?.(filePath);
          } else if (files.length > 0) {
            // Non-audio files were dropped
            alert('Please drop audio files only (wav, mp3, m4a, flac, ogg, webm)');
          }
        } else if (event.event === 'tauri://drag-leave') {
          setIsDragging(false);
        }
      });
    };
    
    setupFileDrop();

    return () => {
      if (unsubscribeFileDrop) {
        unsubscribeFileDrop();
      }
    };
  }, [onFileDropped, isProcessing]);

  // Reset processing file ref when processing completes
  useEffect(() => {
    if (!isProcessing) {
      processingFileRef.current = null;
    }
  }, [isProcessing]);

  return {
    isDragging,
    processingFile: processingFileRef.current,
  };
}
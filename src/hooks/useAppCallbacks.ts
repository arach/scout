import { useCallback } from 'react';
import { useUIContext } from '../contexts/UIContext';

/**
 * Custom hook that provides memoized callback functions for the main App component
 * This reduces the complexity of App.tsx and prevents unnecessary re-renders
 */
export function useAppCallbacks() {
  const { currentView } = useUIContext();

  // Load transcripts function - will be passed from App component
  let loadRecentTranscripts: () => Promise<void>;

  const onTranscriptCreatedCallback = useCallback(() => {
    if (currentView === 'record') {
      loadRecentTranscripts?.();
    }
  }, [currentView]);

  const onRecordingCompleteCallback = useCallback(() => {
    // Don't show processing state for normal recording
    // Ring buffer transcribes in real-time, so transcription is already done
    // The transcript-created event will fire immediately
    // Only file uploads need the processing state
  }, []);

  const onProcessingCompleteCallback = useCallback(() => {
    // Force refresh to ensure UI is updated
    setTimeout(() => {
      loadRecentTranscripts?.();
    }, 50);
  }, []);

  const onRecordingCompletedCallback = useCallback(() => {
    // Force refresh
    setTimeout(() => {
      loadRecentTranscripts?.();
    }, 50);
  }, []);

  // Function to set the loadRecentTranscripts function
  const setLoadTranscriptsFunction = useCallback((fn: () => Promise<void>) => {
    loadRecentTranscripts = fn;
  }, []);

  return {
    onTranscriptCreatedCallback,
    onRecordingCompleteCallback,
    onProcessingCompleteCallback,
    onRecordingCompletedCallback,
    setLoadTranscriptsFunction,
  };
}
import { useCallback } from 'react';
import { tauriApi } from '../types/tauri';
import { loggers } from '../utils/logger';
import { Transcript } from '../types/transcript';

interface UseTranscriptOperationsOptions {
  setTranscripts: (transcripts: Transcript[]) => void;
  currentView?: string;
}

/**
 * Custom hook for transcript loading and management operations
 * Extracted from AppContent.tsx to reduce component size and improve reusability
 */
export function useTranscriptOperations({ setTranscripts, currentView }: UseTranscriptOperationsOptions) {
  // Core transcript loading functions
  const loadRecentTranscripts = useCallback(async () => {
    try {
      const recent = await tauriApi.getRecentTranscripts({ limit: 10 });
      setTranscripts(recent);
    } catch (error) {
      loggers.api.error('Failed to load recent transcripts', error);
    }
  }, [setTranscripts]);

  const loadAllTranscripts = useCallback(async () => {
    try {
      const all = await tauriApi.getRecentTranscripts({ limit: 1000 });
      setTranscripts(all);
    } catch (error) {
      loggers.api.error('Failed to load all transcripts', error);
    }
  }, [setTranscripts]);

  // Event callback handlers
  const onTranscriptCreatedCallback = useCallback(() => {
    if (currentView === 'record') {
      loadRecentTranscripts();
    }
  }, [currentView, loadRecentTranscripts]);

  const onRecordingCompleteCallback = useCallback(() => {
    // Ring buffer transcribes in real-time, so transcription is already done
  }, []);

  const onProcessingCompleteCallback = useCallback(() => {
    setTimeout(() => {
      loadRecentTranscripts();
    }, 50);
  }, [loadRecentTranscripts]);

  const onRecordingCompletedCallback = useCallback(() => {
    setTimeout(() => {
      loadRecentTranscripts();
    }, 50);
  }, [loadRecentTranscripts]);

  return {
    loadRecentTranscripts,
    loadAllTranscripts,
    onTranscriptCreatedCallback,
    onRecordingCompleteCallback,
    onProcessingCompleteCallback,
    onRecordingCompletedCallback,
  };
}
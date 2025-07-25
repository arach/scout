import { useCallback } from 'react';
import { tauriApi } from '../types/tauri';
import { Transcript } from '../types/transcript';
import { loggers } from '../utils/logger';

/**
 * Custom hook for transcript management operations
 * Extracted from AppContent.tsx to reduce component complexity
 */
export const useTranscriptManagement = () => {
  
  /**
   * Load recent transcripts from the database
   */
  const loadRecentTranscripts = useCallback(async (limit: number = 10): Promise<Transcript[]> => {
    try {
      const recent = await tauriApi.getRecentTranscripts({ limit });
      loggers.transcription.debug(`Loaded ${recent.length} recent transcripts`);
      return recent;
    } catch (error) {
      loggers.transcription.error('Failed to load recent transcripts', error);
      return [];
    }
  }, []);

  /**
   * Load all transcripts from the database
   */
  const loadAllTranscripts = useCallback(async (limit: number = 1000): Promise<Transcript[]> => {
    try {
      const all = await tauriApi.getRecentTranscripts({ limit });
      loggers.transcription.debug(`Loaded ${all.length} total transcripts`);
      return all;
    } catch (error) {
      loggers.transcription.error('Failed to load all transcripts', error);
      return [];
    }
  }, []);

  /**
   * Delete a single transcript
   */
  const deleteTranscript = useCallback(async (id: number): Promise<boolean> => {
    try {
      await tauriApi.deleteTranscript({ id });
      loggers.transcription.info('Transcript deleted', { id });
      return true;
    } catch (error) {
      loggers.transcription.error('Failed to delete transcript', error, { id });
      return false;
    }
  }, []);

  /**
   * Search transcripts by query
   */
  const searchTranscripts = useCallback(async (query: string): Promise<Transcript[]> => {
    if (!query.trim()) {
      return [];
    }

    try {
      const results = await tauriApi.searchTranscripts({ query });
      loggers.transcription.debug(`Search found ${results.length} transcripts`, { query });
      return results;
    } catch (error) {
      loggers.transcription.error('Failed to search transcripts', error, { query });
      return [];
    }
  }, []);

  /**
   * Export transcripts in specified format
   */
  const exportTranscripts = useCallback(async (
    format: 'json' | 'markdown' | 'text',
    transcriptIds: number[]
  ): Promise<boolean> => {
    try {
      await tauriApi.exportTranscripts({ format, transcriptIds });
      loggers.transcription.info('Transcripts exported', { format, count: transcriptIds.length });
      return true;
    } catch (error) {
      loggers.transcription.error('Failed to export transcripts', error, { format, count: transcriptIds.length });
      return false;
    }
  }, []);

  /**
   * Copy transcript text to clipboard
   */
  const copyTranscript = useCallback(async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      loggers.ui.debug('Transcript copied to clipboard', { length: text.length });
      return true;
    } catch (error) {
      loggers.ui.error('Failed to copy transcript to clipboard', error);
      return false;
    }
  }, []);

  return {
    loadRecentTranscripts,
    loadAllTranscripts,
    deleteTranscript,
    searchTranscripts,
    exportTranscripts,
    copyTranscript,
  };
};

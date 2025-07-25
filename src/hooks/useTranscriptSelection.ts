import { useCallback, useState } from 'react';
import { Transcript } from '../types/transcript';
import { loggers } from '../utils/logger';

/**
 * Custom hook for managing transcript selection state and operations
 * Extracted from AppContent.tsx to reduce component complexity
 */
export const useTranscriptSelection = () => {
  const [selectedTranscripts, setSelectedTranscripts] = useState<Set<number>>(new Set());

  /**
   * Toggle selection of a single transcript
   */
  const toggleTranscriptSelection = useCallback((id: number) => {
    setSelectedTranscripts(prev => {
      const newSelection = new Set(prev);
      if (newSelection.has(id)) {
        newSelection.delete(id);
        loggers.ui.debug('Transcript deselected', { id, total: newSelection.size });
      } else {
        newSelection.add(id);
        loggers.ui.debug('Transcript selected', { id, total: newSelection.size });
      }
      return newSelection;
    });
  }, []);

  /**
   * Toggle selection of a group of transcripts
   */
  const toggleTranscriptGroupSelection = useCallback((ids: number[]) => {
    setSelectedTranscripts(prev => {
      const newSelection = new Set(prev);
      const allSelected = ids.every(id => newSelection.has(id));
      
      if (allSelected) {
        // Deselect all in group
        ids.forEach(id => newSelection.delete(id));
        loggers.ui.debug('Transcript group deselected', { count: ids.length, total: newSelection.size });
      } else {
        // Select all in group
        ids.forEach(id => newSelection.add(id));
        loggers.ui.debug('Transcript group selected', { count: ids.length, total: newSelection.size });
      }
      
      return newSelection;
    });
  }, []);

  /**
   * Select all provided transcripts
   */
  const selectAllTranscripts = useCallback((transcripts: Transcript[]) => {
    const allIds = transcripts.map(t => t.id);
    setSelectedTranscripts(new Set(allIds));
    loggers.ui.debug('All transcripts selected', { count: allIds.length });
  }, []);

  /**
   * Clear all transcript selections
   */
  const clearSelection = useCallback(() => {
    const prevCount = selectedTranscripts.size;
    setSelectedTranscripts(new Set());
    loggers.ui.debug('All transcript selections cleared', { previousCount: prevCount });
  }, [selectedTranscripts.size]);

  /**
   * Check if any transcripts are selected
   */
  const hasSelection = selectedTranscripts.size > 0;

  /**
   * Get the number of selected transcripts
   */
  const selectionCount = selectedTranscripts.size;

  /**
   * Check if all provided transcripts are selected
   */
  const areAllSelected = useCallback((transcripts: Transcript[]): boolean => {
    return transcripts.length > 0 && transcripts.every(t => selectedTranscripts.has(t.id));
  }, [selectedTranscripts]);

  /**
   * Check if some (but not all) provided transcripts are selected
   */
  const areSomeSelected = useCallback((transcripts: Transcript[]): boolean => {
    const selectedCount = transcripts.filter(t => selectedTranscripts.has(t.id)).length;
    return selectedCount > 0 && selectedCount < transcripts.length;
  }, [selectedTranscripts]);

  /**
   * Get selected transcript IDs as an array
   */
  const getSelectedIds = useCallback((): number[] => {
    return Array.from(selectedTranscripts);
  }, [selectedTranscripts]);

  /**
   * Get selected transcripts from a list
   */
  const getSelectedTranscripts = useCallback((transcripts: Transcript[]): Transcript[] => {
    return transcripts.filter(t => selectedTranscripts.has(t.id));
  }, [selectedTranscripts]);

  return {
    selectedTranscripts,
    toggleTranscriptSelection,
    toggleTranscriptGroupSelection,
    selectAllTranscripts,
    clearSelection,
    hasSelection,
    selectionCount,
    areAllSelected,
    areSomeSelected,
    getSelectedIds,
    getSelectedTranscripts,
  };
};

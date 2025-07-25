import { useState, useEffect, useMemo, useCallback } from 'react';
import { TranscriptGroup } from './useTranscriptGrouping';

const ITEMS_PER_PAGE = 50;

/**
 * Hook to handle transcript pagination with load more functionality
 */
export function useTranscriptPagination(allGroups: TranscriptGroup[], totalTranscripts: number) {
  const [displayedItems, setDisplayedItems] = useState(ITEMS_PER_PAGE);

  // Reset displayed items when transcripts change
  useEffect(() => {
    setDisplayedItems(ITEMS_PER_PAGE);
  }, [totalTranscripts]);

  const loadMore = useCallback(() => {
    setDisplayedItems(prev => prev + ITEMS_PER_PAGE);
  }, []);

  // Calculate paginated groups
  const paginatedGroups = useMemo(() => {
    let itemCount = 0;
    const result: TranscriptGroup[] = [];
    
    for (const group of allGroups) {
      const visibleTranscripts: typeof group.transcripts = [];
      
      for (const transcript of group.transcripts) {
        if (itemCount < displayedItems) {
          visibleTranscripts.push(transcript);
          itemCount++;
        }
      }
      
      if (visibleTranscripts.length > 0) {
        result.push({ title: group.title, transcripts: visibleTranscripts });
      }
    }
    
    return result;
  }, [allGroups, displayedItems]);

  const hasMore = totalTranscripts > displayedItems;
  const remainingCount = totalTranscripts - displayedItems;

  return {
    paginatedGroups,
    displayedItems,
    hasMore,
    remainingCount,
    loadMore,
  };
}

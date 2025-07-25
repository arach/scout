import { useMemo, useState, useCallback } from 'react';
import { Transcript } from '../types/transcript';

/**
 * Grouped transcript structure
 */
export interface TranscriptGroup {
  title: string;
  transcripts: Transcript[];
}

/**
 * Hook to handle transcript grouping by date with expand/collapse functionality
 */
export function useTranscriptGrouping(transcripts: Transcript[]) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(['Today', 'Yesterday'])
  );

  const toggleGroup = useCallback((groupTitle: string) => {
    setExpandedGroups(prev => {
      const newSet = new Set(prev);
      if (newSet.has(groupTitle)) {
        newSet.delete(groupTitle);
      } else {
        newSet.add(groupTitle);
      }
      return newSet;
    });
  }, []);

  // Group transcripts by date
  const groupedTranscripts = useMemo((): TranscriptGroup[] => {
    const groups: { [key: string]: Transcript[] } = {};
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const thisWeek = new Date(today);
    thisWeek.setDate(thisWeek.getDate() - 7);
    const thisMonth = new Date(today);
    thisMonth.setDate(thisMonth.getDate() - 30);

    transcripts.forEach(transcript => {
      const date = new Date(transcript.created_at);
      let groupKey: string;

      if (date >= today) {
        groupKey = 'Today';
      } else if (date >= yesterday) {
        groupKey = 'Yesterday';
      } else if (date >= thisWeek) {
        groupKey = 'This Week';
      } else if (date >= thisMonth) {
        groupKey = 'This Month';
      } else {
        groupKey = 'Older';
      }

      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(transcript);
    });

    // Return in order
    const orderedGroups: TranscriptGroup[] = [];
    const order = ['Today', 'Yesterday', 'This Week', 'This Month', 'Older'];
    order.forEach(key => {
      if (groups[key]) {
        orderedGroups.push({ title: key, transcripts: groups[key] });
      }
    });

    return orderedGroups;
  }, [transcripts]);

  return {
    groupedTranscripts,
    expandedGroups,
    toggleGroup,
  };
}

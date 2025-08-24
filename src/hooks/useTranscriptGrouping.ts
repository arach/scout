import { useMemo } from 'react';
import { Transcript } from '../types/transcript';

interface TranscriptGroup {
  title: string;
  transcripts: Transcript[];
}

// Pre-calculate date boundaries to avoid repeated calculations
const getDateBoundaries = () => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const thisWeek = new Date(today);
  thisWeek.setDate(thisWeek.getDate() - 7);
  const thisMonth = new Date(today);
  thisMonth.setDate(thisMonth.getDate() - 30);

  return { today, yesterday, thisWeek, thisMonth };
};

// Cache date boundaries for the session (they only change daily)
let cachedBoundaries: ReturnType<typeof getDateBoundaries> | null = null;
let cacheDate: string | null = null;

const getCachedDateBoundaries = () => {
  const currentDate = new Date().toDateString();
  if (!cachedBoundaries || cacheDate !== currentDate) {
    cachedBoundaries = getDateBoundaries();
    cacheDate = currentDate;
  }
  return cachedBoundaries;
};

export const useTranscriptGrouping = (transcripts: Transcript[]): TranscriptGroup[] => {
  return useMemo(() => {
    const groups: { [key: string]: Transcript[] } = {};
    const { today, yesterday, thisWeek, thisMonth } = getCachedDateBoundaries();

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
};
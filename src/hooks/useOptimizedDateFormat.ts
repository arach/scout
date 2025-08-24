import { useMemo } from 'react';

// Cache formatted times to avoid recomputation
const formatCache = new Map<string, string>();
const MAX_CACHE_SIZE = 1000;

const clearCacheIfNeeded = () => {
  if (formatCache.size > MAX_CACHE_SIZE) {
    // Clear oldest half of cache (simple LRU approximation)
    const entries = Array.from(formatCache.entries());
    entries.slice(0, Math.floor(MAX_CACHE_SIZE / 2)).forEach(([key]) => {
      formatCache.delete(key);
    });
  }
};

export const useOptimizedDateFormat = (dateString: string, variant: 'default' | 'compact' = 'default') => {
  return useMemo(() => {
    const cacheKey = `${dateString}-${variant}`;
    
    if (formatCache.has(cacheKey)) {
      return formatCache.get(cacheKey)!;
    }

    // Parse the UTC timestamp correctly
    const utcDateString = dateString.includes('Z') || dateString.includes('+') || dateString.includes('T') 
      ? dateString 
      : dateString.replace(' ', 'T') + 'Z';
    const date = new Date(utcDateString);
    
    let formatted: string;

    // Always use time-only format for compact variant
    if (variant === 'compact') {
      formatted = date.toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit'
      });
    } else {
      // Use the EXACT same logic as TranscriptsView grouping
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      // Item is "Today" if date >= today AND date < tomorrow
      const isToday = date >= today && date < tomorrow;
      
      // Always show just time for Today items
      if (isToday) {
        formatted = date.toLocaleTimeString([], { 
          hour: 'numeric', 
          minute: '2-digit'
        });
      } else {
        // For other dates, use a more compact format
        const yearPart = date.getFullYear() !== now.getFullYear() ? '2-digit' : undefined;
        const formattedDate = date.toLocaleDateString([], { 
          month: 'short', 
          day: 'numeric',
          year: yearPart
        });
        const time = date.toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit'
        });
        formatted = `${formattedDate}, ${time}`;
      }
    }

    clearCacheIfNeeded();
    formatCache.set(cacheKey, formatted);
    return formatted;
  }, [dateString, variant]);
};
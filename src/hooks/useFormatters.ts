import { useCallback } from 'react';

/**
 * Custom hook providing formatting utilities
 * Extracted from AppContent.tsx to reduce component complexity
 */
export const useFormatters = () => {
  
  /**
   * Format milliseconds into human-readable duration
   */
  const formatDuration = useCallback((ms: number): string => {
    // < 100ms: Show exact milliseconds (e.g., "87ms")
    if (ms < 100) {
      return `${Math.round(ms)}ms`;
    }
    
    // 100ms - 1s: Show milliseconds rounded to nearest 10 (e.g., "450ms")
    if (ms < 1000) {
      return `${Math.round(ms / 10) * 10}ms`;
    }
    
    // 1s - 5s: Show milliseconds (e.g., "1,234ms" or "1.234s")
    if (ms < 5000) {
      // Show as milliseconds with comma separator
      return `${Math.round(ms).toLocaleString()}ms`;
    }
    
    const totalSeconds = ms / 1000;
    const seconds = Math.floor(totalSeconds);
    const minutes = Math.floor(seconds / 60);
    
    // 5s - 10s: Show with 2 decimal places (e.g., "7.45s")
    if (totalSeconds < 10) {
      return `${totalSeconds.toFixed(2)}s`;
    }
    
    // 10s - 60s: Show with 1 decimal place (e.g., "25.3s")
    if (totalSeconds < 60) {
      return `${totalSeconds.toFixed(1)}s`;
    }
    
    // 1min - 10min: Show as "2:34" with seconds
    if (minutes < 10) {
      const remainingSeconds = seconds % 60;
      return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
    
    // >= 10min: Show as "12:34" (standard time format)
    const hours = Math.floor(minutes / 60);
    if (hours > 0) {
      const remainingMinutes = minutes % 60;
      const remainingSeconds = seconds % 60;
      return `${hours}:${remainingMinutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
    
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }, []);

  /**
   * Format milliseconds for recording timer display
   */
  const formatRecordingTimer = useCallback((ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }, []);

  /**
   * Format file size in bytes to human-readable format
   */
  const formatFileSize = useCallback((bytes?: number): string => {
    if (!bytes || bytes === 0) return '0 B';
    
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const size = bytes / Math.pow(1024, i);
    
    // Format with appropriate decimal places
    const formatted = i === 0 
      ? size.toString() 
      : size.toFixed(i === 1 ? 0 : 1);
    
    return `${formatted} ${sizes[i]}`;
  }, []);

  /**
   * Format date to relative time (e.g., "2 hours ago", "yesterday")
   */
  const formatRelativeTime = useCallback((date: string | Date): string => {
    const now = new Date();
    const targetDate = typeof date === 'string' ? new Date(date) : date;
    const diffMs = now.getTime() - targetDate.getTime();
    
    const seconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (seconds < 60) {
      return 'just now';
    } else if (minutes < 60) {
      return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    } else if (hours < 24) {
      return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    } else if (days === 1) {
      return 'yesterday';
    } else if (days < 7) {
      return `${days} days ago`;
    } else {
      // For older dates, show the actual date
      return targetDate.toLocaleDateString();
    }
  }, []);

  /**
   * Format timestamp to time string (e.g., "2:30 PM")
   */
  const formatTime = useCallback((date: string | Date): string => {
    const targetDate = typeof date === 'string' ? new Date(date) : date;
    return targetDate.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    });
  }, []);

  /**
   * Format number with thousands separators
   */
  const formatNumber = useCallback((num: number): string => {
    return num.toLocaleString();
  }, []);

  /**
   * Truncate text to specified length with ellipsis
   */
  const truncateText = useCallback((text: string, maxLength: number): string => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + '...';
  }, []);

  return {
    formatDuration,
    formatRecordingTimer,
    formatFileSize,
    formatRelativeTime,
    formatTime,
    formatNumber,
    truncateText,
  };
};

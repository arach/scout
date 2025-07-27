import { useState, useEffect, useRef, useCallback } from 'react';
import { tauriApi } from '../types/tauri';
import { loggers } from '../utils/logger';

// Cache for audio blobs to prevent re-fetching the same audio files
const audioBlobCache = new Map<string, Blob>();
const CACHE_SIZE_LIMIT = 50; // Limit cache to 50 items
const CACHE_SIZE_CHECK_INTERVAL = 1000; // Check cache size every second

// LRU cache implementation with size tracking
let cacheAccessOrder: string[] = [];
let totalCacheSize = 0;

const addToCache = (path: string, blob: Blob) => {
  // Remove if already exists to update access order
  if (audioBlobCache.has(path)) {
    removeFromCache(path);
  }
  
  audioBlobCache.set(path, blob);
  cacheAccessOrder.push(path);
  totalCacheSize += blob.size;
  
  loggers.performance.debug('Audio blob cached', { 
    path, 
    size: blob.size, 
    totalSize: totalCacheSize,
    cacheEntries: audioBlobCache.size 
  });
  
  // Clean up cache if it gets too large
  cleanupCache();
};

const removeFromCache = (path: string) => {
  const blob = audioBlobCache.get(path);
  if (blob) {
    audioBlobCache.delete(path);
    cacheAccessOrder = cacheAccessOrder.filter(p => p !== path);
    totalCacheSize -= blob.size;
    
    loggers.performance.debug('Audio blob removed from cache', { 
      path, 
      remainingSize: totalCacheSize,
      cacheEntries: audioBlobCache.size 
    });
  }
};

const cleanupCache = () => {
  // Remove oldest entries if cache is too large
  while (audioBlobCache.size > CACHE_SIZE_LIMIT || totalCacheSize > 100 * 1024 * 1024) { // 100MB limit
    const oldestPath = cacheAccessOrder.shift();
    if (oldestPath) {
      removeFromCache(oldestPath);
    } else {
      break;
    }
  }
};

const accessCache = (path: string): Blob | null => {
  const blob = audioBlobCache.get(path);
  if (blob) {
    // Update access order (move to end)
    cacheAccessOrder = cacheAccessOrder.filter(p => p !== path);
    cacheAccessOrder.push(path);
    
    loggers.performance.debug('Audio blob cache hit', { path });
    return blob;
  }
  return null;
};

// Cleanup interval to prevent memory leaks
setInterval(() => {
  if (audioBlobCache.size > CACHE_SIZE_LIMIT * 0.8) {
    loggers.performance.warn('Audio blob cache size approaching limit', {
      size: audioBlobCache.size,
      totalSize: totalCacheSize,
      limit: CACHE_SIZE_LIMIT
    });
  }
}, CACHE_SIZE_CHECK_INTERVAL);

export const useAudioBlob = (audioPath: string) => {
    const [blob, setBlob] = useState<Blob | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const mountedRef = useRef(true);

    const cleanup = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        
        const fetchAudio = async () => {
            if (!audioPath) {
                if (mountedRef.current) {
                    setIsLoading(false);
                    setBlob(null);
                }
                return;
            }

            // Check cache first
            const cachedBlob = accessCache(audioPath);
            if (cachedBlob && mountedRef.current) {
                setBlob(cachedBlob);
                setIsLoading(false);
                setError(null);
                return;
            }

            // Cancel any previous request
            cleanup();
            
            // Create new abort controller for this request
            abortControllerRef.current = new AbortController();

            if (mountedRef.current) {
                setIsLoading(true);
                setError(null);
                setBlob(null);
            }

            try {
                const startTime = performance.now();
                const audioData: number[] = await tauriApi.readAudioFile({ audioPath });
                
                // Check if component is still mounted and request wasn't aborted
                if (!mountedRef.current || abortControllerRef.current?.signal.aborted) {
                    return;
                }
                
                const audioBlob = new Blob([new Uint8Array(audioData)], { type: 'audio/wav' });
                const loadTime = performance.now() - startTime;
                
                loggers.performance.debug('Audio blob loaded', { 
                    path: audioPath, 
                    size: audioBlob.size,
                    loadTime: `${loadTime.toFixed(2)}ms`
                });

                // Add to cache for future use
                addToCache(audioPath, audioBlob);

                if (mountedRef.current) {
                    setBlob(audioBlob);
                }

            } catch (err: any) {
                if (mountedRef.current && !abortControllerRef.current?.signal.aborted) {
                    const errorMessage = err.message || 'Failed to load audio file';
                    loggers.audio.error('Audio blob load failed', { path: audioPath, error: errorMessage });
                    setError(errorMessage);
                }
            } finally {
                if (mountedRef.current && !abortControllerRef.current?.signal.aborted) {
                    setIsLoading(false);
                }
                abortControllerRef.current = null;
            }
        };

        // Small delay to allow for rapid path changes without unnecessary requests
        const handler = setTimeout(() => {
            fetchAudio();
        }, 50);

        return () => {
            clearTimeout(handler);
            cleanup();
        };
    }, [audioPath, cleanup]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            mountedRef.current = false;
            cleanup();
        };
    }, [cleanup]);

    return { 
        blob, 
        isLoading, 
        error,
        // Expose cache stats for debugging
        cacheStats: {
            size: audioBlobCache.size,
            totalSize: totalCacheSize,
            hasPath: (path: string) => audioBlobCache.has(path)
        }
    };
};

// Export utility to manually clear cache if needed
export const clearAudioBlobCache = () => {
    audioBlobCache.clear();
    cacheAccessOrder = [];
    totalCacheSize = 0;
    loggers.performance.info('Audio blob cache cleared');
}; 
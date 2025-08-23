import { useState, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface LazyAudioState {
  blob: Blob | null;
  isLoading: boolean;
  error: string | null;
  isLoaded: boolean;
}

// Global cache for audio blobs to prevent redundant loading
const audioCache = new Map<string, Blob>();
const MAX_CACHE_SIZE = 50; // Limit memory usage

const clearCacheIfNeeded = () => {
  if (audioCache.size > MAX_CACHE_SIZE) {
    // Clear oldest half of cache (simple LRU approximation)
    const entries = Array.from(audioCache.entries());
    entries.slice(0, Math.floor(MAX_CACHE_SIZE / 2)).forEach(([key]) => {
      audioCache.delete(key);
    });
  }
};

export const useLazyAudioBlob = (audioPath: string) => {
  const [state, setState] = useState<LazyAudioState>({
    blob: null,
    isLoading: false,
    error: null,
    isLoaded: false
  });
  
  const abortControllerRef = useRef<AbortController | null>(null);

  const loadAudio = useCallback(async () => {
    if (!audioPath || state.isLoaded || state.isLoading) {
      return;
    }

    // Check cache first
    if (audioCache.has(audioPath)) {
      setState({
        blob: audioCache.get(audioPath)!,
        isLoading: false,
        error: null,
        isLoaded: true
      });
      return;
    }

    // Cancel any existing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();
    
    setState(prev => ({
      ...prev,
      isLoading: true,
      error: null
    }));

    try {
      const audioData: number[] = await invoke('read_audio_file', { audioPath });
      
      // Check if request was cancelled
      if (abortControllerRef.current?.signal.aborted) {
        return;
      }
      
      const audioBlob = new Blob([new Uint8Array(audioData)], { type: 'audio/wav' });
      
      // Cache the blob
      clearCacheIfNeeded();
      audioCache.set(audioPath, audioBlob);

      setState({
        blob: audioBlob,
        isLoading: false,
        error: null,
        isLoaded: true
      });

    } catch (err: any) {
      if (!abortControllerRef.current?.signal.aborted) {
        setState({
          blob: null,
          isLoading: false,
          error: err.message || 'An unknown error occurred.',
          isLoaded: false
        });
      }
    }
  }, [audioPath, state.isLoaded, state.isLoading]);

  const reset = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setState({
      blob: null,
      isLoading: false,
      error: null,
      isLoaded: false
    });
  }, []);

  return {
    ...state,
    loadAudio,
    reset
  };
};
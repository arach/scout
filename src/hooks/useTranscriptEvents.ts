import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

interface Transcript {
  id: number;
  text: string;
  duration_ms: number;
  created_at: string;
  metadata?: string;
  audio_path?: string;
  file_size?: number;
}

interface UseTranscriptEventsOptions {
  autoCopy: boolean;
  autoPaste: boolean;
  soundEnabled: boolean;
  completionSoundThreshold: number;
  onTranscriptCreated?: (transcript: Transcript) => void;
  onProcessingComplete?: (transcript: Transcript) => void;
  onRecordingCompleted?: () => void;
  setIsProcessing?: (processing: boolean) => void;
  setTranscripts?: (updater: (prev: Transcript[]) => Transcript[]) => void;
}

export function useTranscriptEvents(options: UseTranscriptEventsOptions) {
  const {
    autoCopy,
    autoPaste,
    soundEnabled,
    completionSoundThreshold,
    onTranscriptCreated,
    onProcessingComplete,
    onRecordingCompleted,
    setIsProcessing,
    setTranscripts,
  } = options;

  const processingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    let mounted = true;
    console.log('🔔 Setting up transcript-created listener at', new Date().toISOString());
    
    // Listen for transcript-created events (pub/sub for real-time updates)
    const unsubscribeTranscriptCreated = listen('transcript-created', async (event) => {
      if (!mounted) return;
      const newTranscript = event.payload as Transcript;
      console.log('📝 Transcript created event received at', new Date().toISOString(), ':', {
        id: newTranscript.id,
        textLength: newTranscript.text?.length || 0,
        duration: newTranscript.duration_ms
      });
      
      // Add the new transcript to the list
      setTranscripts?.(prev => {
        // Check if transcript already exists (by id)
        const exists = prev.some(t => t.id === newTranscript.id);
        if (exists) return prev;
        
        // Add new transcript at the beginning and keep only recent ones
        return [newTranscript, ...prev].slice(0, 100);
      });
      
      // Clear processing state when transcript is created
      console.log('📝 Transcript created - clearing processing state');
      setIsProcessing?.(false);
      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current);
        processingTimeoutRef.current = null;
      }
      
      // Handle auto-copy if enabled
      if (autoCopy && newTranscript.text) {
        try {
          await navigator.clipboard.writeText(newTranscript.text);
          console.log('Transcript auto-copied to clipboard');
        } catch (error) {
          console.error('Failed to auto-copy transcript:', error);
        }
      }
      
      // Handle auto-paste if enabled
      if (autoPaste && newTranscript.text) {
        try {
          // First copy to clipboard
          await navigator.clipboard.writeText(newTranscript.text);
          // Then paste using Tauri command
          await invoke('paste_text');
          console.log('Transcript auto-pasted');
        } catch (error) {
          console.error('Failed to auto-paste transcript:', error);
        }
      }
      
      // Play success sound if enabled and transcript meets threshold
      const duration = newTranscript.duration_ms || 0;
      if (soundEnabled && duration >= completionSoundThreshold) {
        try {
          await invoke('play_success_sound');
        } catch (error) {
          console.error('Failed to play success sound:', error);
        }
      }
      
      onTranscriptCreated?.(newTranscript);
    });
    
    // Listen for performance metrics events (for debugging)
    const unsubscribePerformanceMetrics = listen('performance-metrics-recorded', async (event) => {
      if (!mounted) return;
      const metrics = event.payload as any;
      console.log('Performance Metrics:', {
        recording_duration: `${metrics.recording_duration_ms}ms`,
        transcription_time: `${metrics.transcription_time_ms}ms`, 
        user_perceived_latency: metrics.user_perceived_latency_ms ? `${metrics.user_perceived_latency_ms}ms` : 'N/A',
        queue_time: `${metrics.processing_queue_time_ms}ms`,
        model: metrics.model_used,
      });
    });
    
    // Listen for processing-complete event as a backup to transcript-created
    const unsubscribeProcessingComplete = listen('processing-complete', async (event) => {
      if (!mounted) return;
      const transcript = event.payload as Transcript;
      console.log('🏁 Processing complete event received at', new Date().toISOString(), 'transcript:', transcript.id);
      
      // Clear processing state immediately
      console.log('🎯 Clearing processing state from processing-complete at', new Date().toISOString());
      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current);
        processingTimeoutRef.current = null;
      }
      setIsProcessing?.(false);
      
      // Ensure transcript is in the list
      setTranscripts?.(prev => {
        const exists = prev.some(t => t.id === transcript.id);
        if (exists) return prev;
        return [transcript, ...prev].slice(0, 100);
      });
      
      onProcessingComplete?.(transcript);
    });
    
    // Listen for recording-completed event as another backup
    const unsubscribeRecordingCompleted = listen('recording-completed', async (_event) => {
      if (!mounted) return;
      console.log('🏁 Recording-completed event received at', new Date().toISOString());
      
      // Clear processing state immediately
      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current);
        processingTimeoutRef.current = null;
      }
      setIsProcessing?.(false);
      
      onRecordingCompleted?.();
    });

    return () => {
      mounted = false;
      unsubscribeTranscriptCreated.then(fn => fn()).catch(console.error);
      unsubscribePerformanceMetrics.then(fn => fn()).catch(console.error);
      unsubscribeProcessingComplete.then(fn => fn()).catch(console.error);
      unsubscribeRecordingCompleted.then(fn => fn()).catch(console.error);
    };
  }, [autoCopy, autoPaste, soundEnabled, completionSoundThreshold, onTranscriptCreated, onProcessingComplete, onRecordingCompleted, setIsProcessing, setTranscripts]);

  return {
    processingTimeoutRef,
  };
}
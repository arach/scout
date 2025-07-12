import { useState, useRef, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

interface RecordingProgress {
  duration: number;
  status: string;
}

interface UseRecordingOptions {
  onTranscriptCreated?: () => void;
  onRecordingComplete?: () => void;
  soundEnabled?: boolean;
  selectedMic?: string;
  vadEnabled?: boolean;
}

export function useRecording(options: UseRecordingOptions = {}) {
  const {
    onTranscriptCreated,
    onRecordingComplete,
    soundEnabled = true,
    selectedMic = 'Default microphone',
    vadEnabled = false
  } = options;

  // State
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  
  // Refs
  const isRecordingRef = useRef(false);
  const lastToggleTimeRef = useRef(0);
  const isStartingRecording = useRef(false);
  const pushToTalkTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pushToTalkStartTimeRef = useRef<number>(0);
  const audioTargetRef = useRef(0);
  const audioCurrentRef = useRef(0);
  const animationFrameRef = useRef<number>();

  // Audio level animation
  const animateAudioLevel = useCallback(() => {
    const diff = audioTargetRef.current - audioCurrentRef.current;
    audioCurrentRef.current += diff * 0.3;
    setAudioLevel(audioCurrentRef.current);
    
    if (Math.abs(diff) > 0.01) {
      animationFrameRef.current = requestAnimationFrame(animateAudioLevel);
    }
  }, []);

  // Start recording
  const startRecording = useCallback(async () => {
    if (isStartingRecording.current || isRecordingRef.current) {
      console.log('Recording already in progress or starting');
      return;
    }

    try {
      isStartingRecording.current = true;
      console.log('Starting recording...');
      
      const result = await invoke<string>('start_recording', { 
        deviceName: selectedMic !== 'Default microphone' ? selectedMic : null 
      });
      
      console.log('Recording started successfully:', result);
      setIsRecording(true);
      isRecordingRef.current = true;
      setRecordingDuration(0);
      
      if (soundEnabled) {
        try {
          await invoke('play_start_sound');
        } catch (error) {
          console.error('Failed to play start sound:', error);
        }
      }
    } catch (error) {
      console.error('Failed to start recording:', error);
      setIsRecording(false);
      isRecordingRef.current = false;
    } finally {
      isStartingRecording.current = false;
    }
  }, [selectedMic, soundEnabled]);

  // Stop recording
  const stopRecording = useCallback(async () => {
    if (!isRecordingRef.current) {
      console.log('Not recording, nothing to stop');
      return;
    }

    try {
      console.log('Stopping recording...');
      isRecordingRef.current = false;
      setIsRecording(false);
      
      await invoke('stop_recording');
      console.log('Recording stopped successfully');
      
      if (soundEnabled) {
        try {
          await invoke('play_stop_sound');
        } catch (error) {
          console.error('Failed to play stop sound:', error);
        }
      }
      
      onRecordingComplete?.();
    } catch (error) {
      console.error('Failed to stop recording:', error);
      setIsRecording(false);
      isRecordingRef.current = false;
    }
  }, [soundEnabled, onRecordingComplete]);

  // Toggle recording
  const toggleRecording = useCallback(async () => {
    const now = Date.now();
    if (now - lastToggleTimeRef.current < 300) {
      console.log('Ignoring rapid toggle');
      return;
    }
    lastToggleTimeRef.current = now;

    if (isRecordingRef.current) {
      await stopRecording();
    } else {
      await startRecording();
    }
  }, [startRecording, stopRecording]);

  // Push-to-talk handlers
  const handlePushToTalkPressed = useCallback(async () => {
    const now = Date.now();
    
    if (pushToTalkTimeoutRef.current) {
      clearTimeout(pushToTalkTimeoutRef.current);
      pushToTalkTimeoutRef.current = null;
    }
    
    if (!isRecordingRef.current) {
      pushToTalkStartTimeRef.current = now;
      await startRecording();
    }
  }, [startRecording]);

  const handlePushToTalkReleased = useCallback(async () => {
    const now = Date.now();
    const recordingTime = now - pushToTalkStartTimeRef.current;
    
    if (pushToTalkTimeoutRef.current) {
      clearTimeout(pushToTalkTimeoutRef.current);
    }
    
    const minimumRecordingTime = vadEnabled ? 50 : 300;
    
    if (isRecordingRef.current && recordingTime >= minimumRecordingTime) {
      if (vadEnabled) {
        pushToTalkTimeoutRef.current = setTimeout(async () => {
          if (isRecordingRef.current) {
            await stopRecording();
          }
        }, 500);
      } else {
        await stopRecording();
      }
    } else if (isRecordingRef.current) {
      await stopRecording();
    }
  }, [stopRecording, vadEnabled]);

  // Set up event listeners
  useEffect(() => {
    const setupListeners = async () => {
      const unsubscribeProgress = await listen<RecordingProgress>('recording-progress', (event) => {
        if (event.payload.status === 'recording') {
          setRecordingDuration(event.payload.duration);
        }
      });

      const unsubscribeAudioLevel = await listen<number>('audio-level', (event) => {
        audioTargetRef.current = event.payload;
        if (!animationFrameRef.current) {
          animationFrameRef.current = requestAnimationFrame(animateAudioLevel);
        }
      });

      const unsubscribePushToTalkPressed = await listen('push-to-talk-pressed', handlePushToTalkPressed);
      const unsubscribePushToTalkReleased = await listen('push-to-talk-released', handlePushToTalkReleased);

      const unsubscribeProcessingComplete = await listen('processing-complete', () => {
        onTranscriptCreated?.();
      });

      return () => {
        unsubscribeProgress();
        unsubscribeAudioLevel();
        unsubscribePushToTalkPressed();
        unsubscribePushToTalkReleased();
        unsubscribeProcessingComplete();
        
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
      };
    };

    const cleanup = setupListeners();
    return () => {
      cleanup.then(fn => fn());
    };
  }, [animateAudioLevel, handlePushToTalkPressed, handlePushToTalkReleased, onTranscriptCreated]);

  // Cancel recording
  const cancelRecording = useCallback(async () => {
    if (!isRecordingRef.current) {
      console.log('No recording to cancel');
      return;
    }

    try {
      console.log('Cancelling recording...');
      isRecordingRef.current = false;
      setIsRecording(false);
      
      await invoke('cancel_recording');
      console.log('Recording cancelled successfully');
    } catch (error) {
      console.error('Failed to cancel recording:', error);
      setIsRecording(false);
      isRecordingRef.current = false;
    }
  }, []);

  return {
    isRecording,
    recordingDuration,
    audioLevel,
    toggleRecording,
    startRecording,
    stopRecording,
    cancelRecording,
  };
}
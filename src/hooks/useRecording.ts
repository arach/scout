import { useState, useRef, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

interface RecordingProgress {
  Idle?: any;
  Recording?: {
    filename: string;
    start_time: number;
  };
  Stopping?: {
    filename: string;
  };
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

  // Sync with backend state on mount
  useEffect(() => {
    const checkBackendState = async () => {
      try {
        const backendIsRecording = await invoke<boolean>('is_recording');
        if (backendIsRecording !== isRecordingRef.current) {
          console.log('Syncing initial recording state with backend:', backendIsRecording);
          setIsRecording(backendIsRecording);
          isRecordingRef.current = backendIsRecording;
        }
      } catch (error) {
        console.error('Failed to check initial recording state:', error);
      }
    };
    
    checkBackendState();
  }, []);

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
    // Prevent concurrent start attempts
    if (isStartingRecording.current) {
      console.log('Already starting recording, ignoring duplicate request');
      return;
    }

    // Set flag immediately to prevent race conditions
    isStartingRecording.current = true;

    try {
      // Check backend state first
      const backendIsRecording = await invoke<boolean>('is_recording');
      if (backendIsRecording) {
        console.log('Backend is already recording, syncing frontend state');
        setIsRecording(true);
        isRecordingRef.current = true;
        return;
      }

      // Double-check frontend state
      if (isRecordingRef.current) {
        console.log('Frontend already recording, ignoring duplicate request');
        return;
      }

      // Set frontend state optimistically before calling backend
      setIsRecording(true);
      isRecordingRef.current = true;
      setRecordingDuration(0);
      
      console.log('Starting recording with device:', selectedMic);
      const result = await invoke<string>('start_recording', { 
        deviceName: selectedMic !== 'Default microphone' ? selectedMic : null 
      });
      
      console.log('Recording started successfully:', result);
      
      if (soundEnabled) {
        try {
          await invoke('play_start_sound');
        } catch (error: any) {
          // Only log if it's not a "command not found" error
          if (!error.includes || !error.includes('not found')) {
            console.error('Failed to play start sound:', error);
          }
        }
      }
    } catch (error: any) {
      console.error('Failed to start recording:', error);
      // If the error is "Recording already in progress", keep our state as recording
      if (error.includes && error.includes('already in progress')) {
        console.log('Backend says recording in progress, keeping recording state');
        // State is already set, just keep it
      } else {
        // Only reset state on actual errors
        setIsRecording(false);
        isRecordingRef.current = false;
      }
    } finally {
      // Small delay before clearing flag to handle rapid calls
      setTimeout(() => {
        isStartingRecording.current = false;
      }, 100);
    }
  }, [selectedMic, soundEnabled]);

  // Stop recording
  const stopRecording = useCallback(async () => {
    // Check backend state first
    try {
      const backendIsRecording = await invoke<boolean>('is_recording');
      if (!backendIsRecording) {
        // console.log('Backend is not recording, syncing frontend state');
        setIsRecording(false);
        isRecordingRef.current = false;
        setRecordingDuration(0);
        audioTargetRef.current = 0;
        audioCurrentRef.current = 0;
        setAudioLevel(0);
        return;
      }
    } catch (error) {
      console.error('Failed to check recording state:', error);
    }

    if (!isRecordingRef.current) {
      // console.log('Frontend not recording, but backend might be - attempting stop');
    }

    try {
      // console.log('Stopping recording...');
      
      // Call backend FIRST, then update frontend state
      await invoke('stop_recording');
      // console.log('Recording stopped successfully');
      
      // Only update frontend state after backend confirms stop
      isRecordingRef.current = false;
      setIsRecording(false);
      setRecordingDuration(0);
      audioTargetRef.current = 0;
      audioCurrentRef.current = 0;
      setAudioLevel(0);
      
      if (soundEnabled) {
        try {
          await invoke('play_stop_sound');
        } catch (error: any) {
          // Only log if it's not a "command not found" error
          if (!error.includes || !error.includes('not found')) {
            console.error('Failed to play stop sound:', error);
          }
        }
      }
      
      onRecordingComplete?.();
      
      // For ring buffer recordings, transcript-created event fires immediately
      // so we don't need a processing state
    } catch (error) {
      console.error('Failed to stop recording:', error);
      // Don't change state on error - let the backend state sync handle it
      // The recording-state-changed event will update our state
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
    console.log('Push-to-talk pressed');
    const now = Date.now();
    
    if (pushToTalkTimeoutRef.current) {
      clearTimeout(pushToTalkTimeoutRef.current);
      pushToTalkTimeoutRef.current = null;
    }
    
    if (!isRecordingRef.current) {
      pushToTalkStartTimeRef.current = now;
      console.log('Starting recording from push-to-talk');
      await startRecording();
    }
  }, [startRecording]);

  const handlePushToTalkReleased = useCallback(async () => {
    console.log('Push-to-talk released');
    const now = Date.now();
    const recordingTime = now - pushToTalkStartTimeRef.current;
    
    if (pushToTalkTimeoutRef.current) {
      clearTimeout(pushToTalkTimeoutRef.current);
    }
    
    const minimumRecordingTime = vadEnabled ? 50 : 300;
    
    console.log(`Recording time: ${recordingTime}ms, minimum: ${minimumRecordingTime}ms, isRecording: ${isRecordingRef.current}`);
    
    if (isRecordingRef.current && recordingTime >= minimumRecordingTime) {
      if (vadEnabled) {
        console.log('VAD enabled, setting timeout to stop recording');
        pushToTalkTimeoutRef.current = setTimeout(async () => {
          if (isRecordingRef.current) {
            console.log('Stopping recording after VAD timeout');
            await stopRecording();
          }
        }, 500);
      } else {
        console.log('VAD disabled, stopping recording immediately');
        await stopRecording();
      }
    } else if (isRecordingRef.current) {
      console.log('Recording time too short, stopping anyway');
      await stopRecording();
    }
  }, [stopRecording, vadEnabled]);

  // Set up event listeners
  useEffect(() => {
    let mounted = true;
    const unsubscribers: Array<() => void> = [];
    
    const setupListeners = async () => {
      if (!mounted) return;
      
      try {
        // Listen for recording state changes from backend
        const unsubscribeRecordingState = await listen("recording-state-changed", (event: any) => {
          if (!mounted) return;
        const { state } = event.payload;
        
        if (state === "recording") {
          // Backend says we're recording
          if (!isRecordingRef.current) {
            // console.log('Backend started recording, updating frontend state');
            setIsRecording(true);
            isRecordingRef.current = true;
            setRecordingDuration(0);
          }
        } else if (state === "stopped" || state === "idle") {
          // Backend says we've stopped or are idle
          if (isRecordingRef.current || isRecording) {
            // console.log('Backend stopped recording, updating frontend state');
            setIsRecording(false);
            isRecordingRef.current = false;
            setRecordingDuration(0);
            audioTargetRef.current = 0;
            audioCurrentRef.current = 0;
            setAudioLevel(0);
          }
        }
      });

      // Set up recording duration tracking
      let recordingStartTime: number | null = null;
      let durationInterval: NodeJS.Timeout | null = null;

      const unsubscribeProgress = await listen<RecordingProgress>('recording-progress', (event) => {
        if (!mounted) return;
        if (event.payload.Recording) {
          // Start tracking duration from the backend's start_time
          if (!recordingStartTime) {
            recordingStartTime = event.payload.Recording.start_time;
            
            // Set initial duration immediately
            const now = Date.now();
            const duration = now - recordingStartTime;
            setRecordingDuration(duration);
            
            // Update duration every 1000ms to avoid jumpy display
            durationInterval = setInterval(() => {
              const now = Date.now();
              const duration = now - recordingStartTime!;
              setRecordingDuration(duration);
            }, 1000);
          }
        } else if (event.payload.Idle || event.payload.Stopping) {
          // Stop tracking duration
          if (durationInterval) {
            clearInterval(durationInterval);
            durationInterval = null;
          }
          recordingStartTime = null;
          setRecordingDuration(0);
        }
      });

      const unsubscribeAudioLevel = await listen<number>('audio-level', (event) => {
        if (!mounted) return;
        audioTargetRef.current = event.payload;
        if (!animationFrameRef.current) {
          animationFrameRef.current = requestAnimationFrame(animateAudioLevel);
        }
      });

      const unsubscribePushToTalkPressed = await listen('push-to-talk-pressed', async () => {
        if (!mounted) return;
        await handlePushToTalkPressed();
      });
      
      const unsubscribePushToTalkReleased = await listen('push-to-talk-released', async () => {
        if (!mounted) return;
        await handlePushToTalkReleased();
      });

      const unsubscribeProcessingComplete = await listen('processing-complete', () => {
        if (!mounted) return;
        onTranscriptCreated?.();
      });

      // Store all unsubscribe functions
      unsubscribers.push(
        unsubscribeRecordingState,
        unsubscribeProgress,
        unsubscribeAudioLevel,
        unsubscribePushToTalkPressed,
        unsubscribePushToTalkReleased,
        unsubscribeProcessingComplete
      );
      
      // Also store the interval cleanup
      if (durationInterval) {
        unsubscribers.push(() => clearInterval(durationInterval));
      }
      } catch (error) {
        console.error('Failed to set up recording event listeners:', error);
      }
    };

    setupListeners().catch(error => {
      console.error('Failed to setup recording listeners:', error);
    });

    return () => {
      mounted = false;
      
      // Cancel any pending timeouts
      if (pushToTalkTimeoutRef.current) {
        clearTimeout(pushToTalkTimeoutRef.current);
        pushToTalkTimeoutRef.current = null;
      }
      
      // Cancel animation frame
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
      }
      
      // Call all unsubscribe functions
      unsubscribers.forEach(unsubscribe => {
        try {
          unsubscribe?.();
        } catch (error) {
          console.error('Error during listener cleanup:', error);
        }
      });
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
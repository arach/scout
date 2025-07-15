import { useState, useRef, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { recordingManager } from './recordingManager';

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
  const [recordingStartTime, setRecordingStartTime] = useState<number | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  
  // Refs
  const isRecordingRef = useRef(false);
  const lastToggleTimeRef = useRef(0);
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


  // Start audio level monitoring on mount - using polling like in master
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    let animationFrame: number;
    let isActive = true;

    const startMonitoring = async () => {
      try {
        console.log('Attempting to start audio level monitoring...');
        // Start monitoring first
        await invoke('start_audio_level_monitoring', { 
          deviceName: selectedMic !== 'Default microphone' ? selectedMic : null 
        });
        console.log('Audio level monitoring started successfully');
        
        // Animation function - define inside effect to avoid stale closures
        const animate = () => {
          if (!isActive) return;
          
          const target = audioTargetRef.current;
          const current = audioCurrentRef.current;
          const diff = target - current;
          const speed = 0.3;
          let newLevel = current + (diff * speed);
          
          // Organic motion from master
          if (target > 0.02) {
            const flutter = (Math.random() - 0.5) * target * 0.12;
            const shimmer = Math.sin(Date.now() * 0.007) * target * 0.04;
            const pulse = Math.sin(Date.now() * 0.003) * target * 0.06;
            newLevel += flutter + shimmer + pulse;
          }
          
          // Breathing motion even when quiet
          const breathingMotion = Math.sin(Date.now() * 0.0015) * 0.015;
          newLevel += breathingMotion;
          
          // Clamp and update
          audioCurrentRef.current = Math.max(0, Math.min(newLevel, 1.0));
          setAudioLevel(audioCurrentRef.current);
          
          console.log('[useRecording] Animation frame:', {
            target: target.toFixed(6),
            current: current.toFixed(6),
            newLevel: newLevel.toFixed(6),
            final: audioCurrentRef.current.toFixed(6)
          });
          
          animationFrame = requestAnimationFrame(animate);
        };
        
        // Start the animation loop
        animate();
        
        // Poll every 150ms like in master
        interval = setInterval(async () => {
          if (!isActive) return;
          try {
            const level = await invoke<number>('get_current_audio_level');
            
            // Log raw backend value
            console.log('[useRecording] Backend audio level:', {
              raw: level.toFixed(6),
              timestamp: Date.now(),
              device: selectedMic
            });
            
            // Same processing as master
            let processed = 0;
            if (level > 0.12) {
              processed = (level - 0.12) * 1.5; // More amplification
            }
            
            // Add bit of raw signal for organic movement
            processed += level * 0.08; // More jitter for liveliness
            
            // Set target - animation will smoothly move toward it
            audioTargetRef.current = Math.min(processed, 1.0);
            
            console.log('[useRecording] Processed audio:', {
              target: audioTargetRef.current.toFixed(6),
              current: audioCurrentRef.current.toFixed(6),
              frontendLevel: audioLevel.toFixed(6)
            });
          } catch (error) {
            console.error('Failed to get audio level:', error);
          }
        }, 150);
        
      } catch (error) {
        console.error('Failed to start audio level monitoring:', error);
      }
    };

    // Delay start to ensure Tauri is ready
    const timeoutId = setTimeout(() => {
      if (isActive) {
        startMonitoring();
      }
    }, 200);

    // Cleanup on unmount
    return () => {
      isActive = false;
      clearTimeout(timeoutId);
      if (interval) clearInterval(interval);
      if (animationFrame) cancelAnimationFrame(animationFrame);
      invoke('stop_audio_level_monitoring').catch(() => {});
      audioTargetRef.current = 0;
      audioCurrentRef.current = 0;
      setAudioLevel(0);
    };
  }, [selectedMic]);


  // Start recording
  const startRecording = useCallback(async () => {
    // Use global singleton to prevent multiple instances
    if (!recordingManager.canStartRecording()) {
      console.log('RecordingManager prevented duplicate recording');
      return;
    }

    recordingManager.setStarting(true);

    try {
      // Check backend state first
      const backendIsRecording = await invoke<boolean>('is_recording');
      if (backendIsRecording) {
        console.log('Backend is already recording, syncing frontend state');
        setIsRecording(true);
        isRecordingRef.current = true;
        recordingManager.setRecording(true);
        recordingManager.setStarting(false);
        return;
      }

      // Set frontend state optimistically before calling backend
      setIsRecording(true);
      isRecordingRef.current = true;
      recordingManager.setRecording(true);
      setRecordingStartTime(Date.now());
      
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
        recordingManager.setRecording(true);
      } else {
        // Only reset state on actual errors
        setIsRecording(false);
        isRecordingRef.current = false;
        recordingManager.setRecording(false);
      }
    } finally {
      recordingManager.setStarting(false);
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
        setRecordingStartTime(null);
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
      recordingManager.setRecording(false);
      setRecordingStartTime(null);
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
    
    // Prevent multiple push-to-talk presses in quick succession
    if (now - pushToTalkStartTimeRef.current < 100) {
      console.log('Ignoring rapid push-to-talk press');
      return;
    }
    
    if (pushToTalkTimeoutRef.current) {
      clearTimeout(pushToTalkTimeoutRef.current);
      pushToTalkTimeoutRef.current = null;
    }
    
    if (!isRecordingRef.current && !recordingManager.getState().isRecording) {
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
    
    const currentlyRecording = isRecordingRef.current || recordingManager.getState().isRecording;
    console.log(`Recording time: ${recordingTime}ms, minimum: ${minimumRecordingTime}ms, isRecording: ${currentlyRecording}`);
    
    if (currentlyRecording && recordingTime >= minimumRecordingTime) {
      if (vadEnabled) {
        console.log('VAD enabled, setting timeout to stop recording');
        pushToTalkTimeoutRef.current = setTimeout(async () => {
          const stillRecording = isRecordingRef.current || recordingManager.getState().isRecording;
          if (stillRecording) {
            console.log('Stopping recording after VAD timeout');
            await stopRecording();
          }
        }, 500);
      } else {
        console.log('VAD disabled, stopping recording immediately');
        await stopRecording();
      }
    } else if (currentlyRecording) {
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
            recordingManager.setRecording(true);
            setRecordingStartTime(null);
          }
        } else if (state === "stopped" || state === "idle") {
          // Backend says we've stopped or are idle
          if (isRecordingRef.current || isRecording) {
            // console.log('Backend stopped recording, updating frontend state');
            setIsRecording(false);
            isRecordingRef.current = false;
            recordingManager.setRecording(false);
            setRecordingStartTime(null);
            audioTargetRef.current = 0;
            audioCurrentRef.current = 0;
            setAudioLevel(audioCurrentRef.current);
          }
        }
      });

      const unsubscribeProgress = await listen<RecordingProgress>('recording-progress', (event) => {
        if (!mounted) return;
        if (event.payload.Recording) {
          // Update start time from backend
          setRecordingStartTime(event.payload.Recording.start_time);
        } else if (event.payload.Idle || event.payload.Stopping) {
          // Clear start time
          setRecordingStartTime(null);
        }
      });

      // Audio level is now handled by polling in the monitoring effect above

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

      // Store all unsubscribe functions (filter out any undefined)
      const validUnsubscribers = [
        unsubscribeRecordingState,
        unsubscribeProgress,
        unsubscribePushToTalkPressed,
        unsubscribePushToTalkReleased,
        unsubscribeProcessingComplete
      ].filter(fn => typeof fn === 'function');
      
      unsubscribers.push(...validUnsubscribers);
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
          if (typeof unsubscribe === 'function') {
            unsubscribe();
          }
        } catch (error) {
          console.error('Error during listener cleanup:', error);
        }
      });
      
      // Clear the array to prevent double cleanup
      unsubscribers.length = 0;
    };
  }, [handlePushToTalkPressed, handlePushToTalkReleased, onTranscriptCreated]);

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
    recordingStartTime,
    audioLevel,
    toggleRecording,
    startRecording,
    stopRecording,
    cancelRecording,
  };
}
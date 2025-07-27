import { useState, useRef, useCallback, useEffect } from 'react';
import { invokeTyped, tauriApi } from '../types/tauri';
import { safeEventListen, cleanupListeners } from '../lib/safeEventListener';
import { useRecordingContext } from '../contexts/RecordingContext';
import { usePushToTalkMonitor } from './usePushToTalkMonitor';
import { useAudioLevelMonitoring } from './useAudioLevelMonitoring';
import { loggers } from '../utils/logger';

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
  onRecordingStart?: () => void;
  soundEnabled?: boolean;
  selectedMic?: string;
  pushToTalkShortcut?: string;
  isRecordViewActive?: boolean;
}

export function useRecording(options: UseRecordingOptions = {}) {
  const {
    onTranscriptCreated,
    onRecordingComplete,
    onRecordingStart,
    soundEnabled = true,
    selectedMic = 'Default microphone',
    pushToTalkShortcut = '',
    isRecordViewActive = false
  } = options;

  // Recording context (replaces singleton)
  const recordingContext = useRecordingContext();

  // Audio level monitoring (extracted to separate hook)
  useAudioLevelMonitoring({
    isActive: isRecordViewActive,
  });

  // State
  const [isRecording, setIsRecording] = useState(false);
  const [recordingStartTime, setRecordingStartTime] = useState<number | null>(null);
  
  // Refs
  const isRecordingRef = useRef(false);
  const lastToggleTimeRef = useRef(0);
  const pushToTalkTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pushToTalkStartTimeRef = useRef<number>(0);
  const isPushToTalkActiveRef = useRef(false);

  // Sync with backend state on mount
  useEffect(() => {
    const checkBackendState = async () => {
      try {
        const backendIsRecording = await tauriApi.isRecording();
        if (backendIsRecording !== isRecordingRef.current) {
          loggers.recording.debug('Syncing initial recording state with backend', { backendIsRecording });
          setIsRecording(backendIsRecording);
          isRecordingRef.current = backendIsRecording;
          // Also sync the recording manager
          recordingContext.setRecording(backendIsRecording);
        } else {
          // Make sure recording manager is also in sync even if states match
          recordingContext.setRecording(backendIsRecording);
        }
      } catch (error) {
        loggers.recording.error('Failed to check initial recording state', error);
        // Reset recording manager on error to ensure clean state
        recordingContext.reset();
      }
    };
    
    checkBackendState();
  }, []);


  // Start recording
  const startRecording = useCallback(async () => {
    // Use global singleton to prevent multiple instances
    if (!recordingContext.canStartRecording()) {
      loggers.recording.debug('RecordingManager prevented duplicate recording');
      return;
    }

    recordingContext.setStarting(true);

    try {
      // Check backend state first
      const backendIsRecording = await tauriApi.isRecording();
      if (backendIsRecording) {
        loggers.recording.debug('Backend is already recording, syncing frontend state');
        setIsRecording(true);
        isRecordingRef.current = true;
        recordingContext.setRecording(true);
        recordingContext.setStarting(false);
        return;
      }

      // Set frontend state optimistically before calling backend
      setIsRecording(true);
      isRecordingRef.current = true;
      recordingContext.setRecording(true);
      setRecordingStartTime(Date.now());
      
      // Call onRecordingStart callback if provided
      onRecordingStart?.();
      
      loggers.recording.info('Starting recording', { device: selectedMic || 'default' });
      const result = await invokeTyped<string>('start_recording', { 
        deviceName: selectedMic !== 'Default microphone' ? selectedMic : null 
      });
      
      loggers.recording.info('Recording started successfully', { result });
      
      if (soundEnabled) {
        try {
          await tauriApi.playStartSound();
        } catch (error: any) {
          // Only log if it's not a "command not found" error
          if (!error.includes || !error.includes('not found')) {
            loggers.audio.error('Failed to play start sound', error);
          }
        }
      }
    } catch (error: any) {
      loggers.recording.error('Failed to start recording', error);
      // If the error is "Recording already in progress", keep our state as recording
      if (error.includes && error.includes('already in progress')) {
        loggers.recording.debug('Backend reports recording in progress, syncing state');
        recordingContext.setRecording(true);
      } else {
        // Only reset state on actual errors
        setIsRecording(false);
        isRecordingRef.current = false;
        recordingContext.setRecording(false);
      }
    } finally {
      recordingContext.setStarting(false);
    }
  }, [selectedMic, soundEnabled]);

  // Stop recording
  const stopRecording = useCallback(async () => {
    // Check backend state first
    try {
      const backendIsRecording = await tauriApi.isRecording();
      if (!backendIsRecording) {
        // console.log('Backend is not recording, syncing frontend state');
        setIsRecording(false);
        isRecordingRef.current = false;
        setRecordingStartTime(null);
        return;
      }
    } catch (error) {
      loggers.recording.error('Failed to check recording state', error);
    }

    if (!isRecordingRef.current) {
      // console.log('Frontend not recording, but backend might be - attempting stop');
    }

    try {
      // console.log('Stopping recording...');
      
      // Call backend FIRST, then update frontend state
      await tauriApi.stopRecording();
      // console.log('Recording stopped successfully');
      
      // Only update frontend state after backend confirms stop
      isRecordingRef.current = false;
      setIsRecording(false);
      recordingContext.setRecording(false);
      setRecordingStartTime(null);
      
      if (soundEnabled) {
        try {
          await tauriApi.playStopSound();
        } catch (error: any) {
          // Only log if it's not a "command not found" error
          if (!error.includes || !error.includes('not found')) {
            loggers.audio.error('Failed to play stop sound', error);
          }
        }
      }
      
      onRecordingComplete?.();
      
      // For ring buffer recordings, transcript-created event fires immediately
      // so we don't need a processing state
    } catch (error) {
      loggers.recording.error('Failed to stop recording', error);
      // Don't change state on error - let the backend state sync handle it
      // The recording-state-changed event will update our state
    }
  }, [soundEnabled, onRecordingComplete]);

  // Toggle recording
  const toggleRecording = useCallback(async () => {
    const now = Date.now();
    if (now - lastToggleTimeRef.current < 300) {
      loggers.recording.debug('Ignoring rapid toggle - too frequent');
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
    loggers.recording.debug('Push-to-talk pressed');
    const now = Date.now();
    
    // Prevent multiple push-to-talk presses in quick succession
    if (now - pushToTalkStartTimeRef.current < 100) {
      loggers.recording.debug('Ignoring rapid push-to-talk press');
      return;
    }
    
    if (pushToTalkTimeoutRef.current) {
      clearTimeout(pushToTalkTimeoutRef.current);
      pushToTalkTimeoutRef.current = null;
    }
    
    if (!isRecordingRef.current && !recordingContext.state.isRecording) {
      pushToTalkStartTimeRef.current = now;
      isPushToTalkActiveRef.current = true;
      loggers.recording.info('Starting recording from push-to-talk');
      await startRecording();
    }
  }, [startRecording]);

  const handlePushToTalkReleased = useCallback(async () => {
    loggers.recording.debug('Push-to-talk released');
    isPushToTalkActiveRef.current = false;
    const now = Date.now();
    const recordingTime = now - pushToTalkStartTimeRef.current;
    
    if (pushToTalkTimeoutRef.current) {
      clearTimeout(pushToTalkTimeoutRef.current);
    }
    
    const minimumRecordingTime = 300;
    
    const currentlyRecording = isRecordingRef.current || recordingContext.state.isRecording;
    loggers.recording.debug('Push-to-talk timing', { recordingTime, minimumRecordingTime, isRecording: currentlyRecording });
    
    if (currentlyRecording && recordingTime >= minimumRecordingTime) {
      loggers.recording.debug('Stopping recording immediately');
      await stopRecording();
    } else if (currentlyRecording) {
      loggers.recording.debug('Recording time too short, stopping anyway');
      await stopRecording();
    }
  }, [stopRecording]);

  // Use push-to-talk monitor to detect key release in the frontend
  usePushToTalkMonitor({
    enabled: !!pushToTalkShortcut && typeof window !== 'undefined',
    shortcut: pushToTalkShortcut,
    onRelease: () => {
      loggers.recording.debug('Push-to-talk key released detected (frontend)');
      if (isPushToTalkActiveRef.current) {
        handlePushToTalkReleased();
      }
    }
  });

  // Set up event listeners
  useEffect(() => {
    let mounted = true;
    const cleanupFunctions: Array<() => void> = [];
    
    const setupListeners = async () => {
      if (!mounted) return;
      
      try {
        // Listen for recording state changes from backend
        const cleanupRecordingState = await safeEventListen("recording-state-changed", (event: any) => {
          if (!mounted) return;
        const { state } = event.payload;
        
        if (state === "recording") {
          // Backend says we're recording
          if (!isRecordingRef.current) {
            // console.log('Backend started recording, updating frontend state');
            setIsRecording(true);
            isRecordingRef.current = true;
            recordingContext.setRecording(true);
            setRecordingStartTime(null);
          }
        } else if (state === "stopped" || state === "idle") {
          // Backend says we've stopped or are idle
          if (isRecordingRef.current || isRecording) {
            // console.log('Backend stopped recording, updating frontend state');
            setIsRecording(false);
            isRecordingRef.current = false;
            recordingContext.setRecording(false);
            setRecordingStartTime(null);
          }
        }
      });
      cleanupFunctions.push(cleanupRecordingState);

      const cleanupProgress = await safeEventListen<RecordingProgress>('recording-progress', (event) => {
        if (!mounted) return;
        if (event.payload.Recording) {
          // Update start time from backend
          setRecordingStartTime(event.payload.Recording.start_time);
        } else if (event.payload.Idle || event.payload.Stopping) {
          // Clear start time
          setRecordingStartTime(null);
        }
      });
      cleanupFunctions.push(cleanupProgress);

      // Audio level is now handled by polling in the monitoring effect above

      const cleanupPushToTalkPressed = await safeEventListen('push-to-talk-pressed', async () => {
        if (!mounted) return;
        await handlePushToTalkPressed();
      });
      cleanupFunctions.push(cleanupPushToTalkPressed);
      
      // Listen for push-to-talk release from keyboard monitor (if available)
      // This is a backup - our frontend monitor handles most cases
      const cleanupPushToTalkReleased = await safeEventListen('push-to-talk-released', async () => {
        if (!mounted) return;
        loggers.recording.debug('Push-to-talk released event received (backend)');
        await handlePushToTalkReleased();
      });
      cleanupFunctions.push(cleanupPushToTalkReleased);

      const cleanupProcessingComplete = await safeEventListen('processing-complete', () => {
        if (!mounted) return;
        onTranscriptCreated?.();
      });
      cleanupFunctions.push(cleanupProcessingComplete);

      } catch (error) {
        loggers.recording.error('Failed to set up recording event listeners', error);
      }
    };

    setupListeners().catch(error => {
      loggers.recording.error('Failed to setup recording listeners', error);
    });

    return () => {
      mounted = false;
      
      // Cancel any pending timeouts
      if (pushToTalkTimeoutRef.current) {
        clearTimeout(pushToTalkTimeoutRef.current);
        pushToTalkTimeoutRef.current = null;
      }
      
      // Use safe cleanup
      cleanupListeners(cleanupFunctions);
    };
  }, [handlePushToTalkPressed, handlePushToTalkReleased, onTranscriptCreated]);

  // Cancel recording
  const cancelRecording = useCallback(async () => {
    if (!isRecordingRef.current) {
      loggers.recording.debug('No recording to cancel');
      return;
    }

    try {
      loggers.recording.info('Cancelling recording');
      isRecordingRef.current = false;
      setIsRecording(false);
      
      await tauriApi.cancelRecording();
      loggers.recording.info('Recording cancelled successfully');
    } catch (error) {
      loggers.recording.error('Failed to cancel recording', error);
      setIsRecording(false);
      isRecordingRef.current = false;
    }
  }, []);

  return {
    isRecording,
    recordingStartTime,
    toggleRecording,
    startRecording,
    stopRecording,
    cancelRecording,
  };
}
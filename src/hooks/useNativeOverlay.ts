import { useEffect } from 'react';
import { safeEventListen, cleanupListeners } from '../lib/safeEventListener';
import { tauriApi } from '../types/tauri';
import { loggers } from '../utils/logger';

interface UseNativeOverlayOptions {
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  cancelRecording: () => Promise<void>;
}

export function useNativeOverlay(options: UseNativeOverlayOptions) {
  const { startRecording, stopRecording, cancelRecording } = options;

  useEffect(() => {
    // Skip if no callbacks are provided (e.g., during onboarding)
    if (!startRecording || !stopRecording || !cancelRecording) {
      return;
    }
    
    let mounted = true;
    const cleanupFunctions: Array<() => void> = [];
    
    // Listen for recording requests from native overlay
    safeEventListen('native-overlay-start-recording', async () => {
      loggers.ui.info('Native overlay start recording event received');
      if (!mounted) return;
      
      try {
        // Check the actual recording state from backend to avoid stale closure
        const isCurrentlyRecording = await tauriApi.isRecording();
        loggers.recording.debug('Current recording state from backend', { isCurrentlyRecording });
        if (!isCurrentlyRecording) {
          loggers.recording.info('Starting recording from native overlay');
          await startRecording();
          loggers.recording.info('Recording started from native overlay');
        } else {
          loggers.recording.debug('Already recording, ignoring native overlay start request');
        }
      } catch (error) {
        loggers.recording.error('Error handling native overlay start recording', error);
      }
    }).then(cleanup => cleanupFunctions.push(cleanup));

    safeEventListen('native-overlay-stop-recording', async () => {
      loggers.ui.info('Native overlay stop recording event received');
      if (!mounted) return;
      
      try {
        // Check the actual recording state from backend
        const isCurrentlyRecording = await tauriApi.isRecording();
        loggers.recording.debug('Current recording state from backend', { isCurrentlyRecording });
        if (isCurrentlyRecording) {
          loggers.recording.info('Stopping recording from native overlay');
          await stopRecording();
          loggers.recording.info('Recording stopped from native overlay');
        } else {
          loggers.recording.debug('Not recording, ignoring native overlay stop request');
        }
      } catch (error) {
        loggers.recording.error('Error handling native overlay stop recording', error);
      }
    }).then(cleanup => cleanupFunctions.push(cleanup));

    safeEventListen('native-overlay-cancel-recording', async () => {
      loggers.ui.info('Native overlay cancel recording event received');
      if (!mounted) return;
      
      try {
        // Check the actual recording state from backend
        const isCurrentlyRecording = await tauriApi.isRecording();
        loggers.recording.debug('Current recording state from backend', { isCurrentlyRecording });
        if (isCurrentlyRecording) {
          loggers.recording.info('Cancelling recording from native overlay');
          await cancelRecording();
          loggers.recording.info('Recording cancelled from native overlay');
        } else {
          loggers.recording.debug('Not recording, ignoring native overlay cancel request');
        }
      } catch (error) {
        loggers.recording.error('Error handling native overlay cancel recording', error);
      }
    }).then(cleanup => cleanupFunctions.push(cleanup));

    return () => {
      mounted = false;
      // Use the safe cleanup utility
      cleanupListeners(cleanupFunctions);
    };
  }, [startRecording, stopRecording, cancelRecording]);
}
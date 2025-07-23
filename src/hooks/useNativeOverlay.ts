import { useEffect } from 'react';
import { safeEventListen, cleanupListeners } from '../lib/safeEventListener';
import { invoke } from '@tauri-apps/api/core';

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
      console.log('Native overlay start recording event received');
      if (!mounted) return;
      
      try {
        // Check the actual recording state from backend to avoid stale closure
        const isCurrentlyRecording = await invoke<boolean>("is_recording");
        console.log('Current recording state from backend:', isCurrentlyRecording);
        if (!isCurrentlyRecording) {
          console.log('Starting recording from native overlay...');
          await startRecording();
          console.log('Recording started from native overlay');
        } else {
          console.log('Already recording, ignoring native overlay start request');
        }
      } catch (error) {
        console.error('Error handling native overlay start recording:', error);
      }
    }).then(cleanup => cleanupFunctions.push(cleanup));

    safeEventListen('native-overlay-stop-recording', async () => {
      console.log('Native overlay stop recording event received');
      if (!mounted) return;
      
      try {
        // Check the actual recording state from backend
        const isCurrentlyRecording = await invoke<boolean>("is_recording");
        console.log('Current recording state from backend:', isCurrentlyRecording);
        if (isCurrentlyRecording) {
          console.log('Stopping recording from native overlay...');
          await stopRecording();
          console.log('Recording stopped from native overlay');
        } else {
          console.log('Not recording, ignoring native overlay stop request');
        }
      } catch (error) {
        console.error('Error handling native overlay stop recording:', error);
      }
    }).then(cleanup => cleanupFunctions.push(cleanup));

    safeEventListen('native-overlay-cancel-recording', async () => {
      console.log('Native overlay cancel recording event received');
      if (!mounted) return;
      
      try {
        // Check the actual recording state from backend
        const isCurrentlyRecording = await invoke<boolean>("is_recording");
        console.log('Current recording state from backend:', isCurrentlyRecording);
        if (isCurrentlyRecording) {
          console.log('Cancelling recording from native overlay...');
          await cancelRecording();
          console.log('Recording cancelled from native overlay');
        } else {
          console.log('Not recording, ignoring native overlay cancel request');
        }
      } catch (error) {
        console.error('Error handling native overlay cancel recording:', error);
      }
    }).then(cleanup => cleanupFunctions.push(cleanup));

    return () => {
      mounted = false;
      // Use the safe cleanup utility
      cleanupListeners(cleanupFunctions);
    };
  }, [startRecording, stopRecording, cancelRecording]);
}
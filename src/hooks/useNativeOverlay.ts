import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

interface UseNativeOverlayOptions {
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  cancelRecording: () => Promise<void>;
}

export function useNativeOverlay(options: UseNativeOverlayOptions) {
  const { startRecording, stopRecording, cancelRecording } = options;

  useEffect(() => {
    let mounted = true;
    
    // Listen for recording requests from native overlay
    const unsubscribeNativeStart = listen('native-overlay-start-recording', async () => {
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
    });

    const unsubscribeNativeStop = listen('native-overlay-stop-recording', async () => {
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
    });

    const unsubscribeNativeCancel = listen('native-overlay-cancel-recording', async () => {
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
    });

    return () => {
      mounted = false;
      
      // Properly cleanup event listeners
      unsubscribeNativeStart.then(fn => {
        if (typeof fn === 'function') {
          fn();
        }
      }).catch(error => {
        console.error('Error unsubscribing from native start events:', error);
      });
      
      unsubscribeNativeStop.then(fn => {
        if (typeof fn === 'function') {
          fn();
        }
      }).catch(error => {
        console.error('Error unsubscribing from native stop events:', error);
      });
      
      unsubscribeNativeCancel.then(fn => {
        if (typeof fn === 'function') {
          fn();
        }
      }).catch(error => {
        console.error('Error unsubscribing from native cancel events:', error);
      });
    };
  }, [startRecording, stopRecording, cancelRecording]);
}
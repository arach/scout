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
      if (!mounted) return;
      
      // Check the actual recording state from backend to avoid stale closure
      const isCurrentlyRecording = await invoke<boolean>("is_recording");
      if (!isCurrentlyRecording) {
        await startRecording();
      }
    });

    const unsubscribeNativeStop = listen('native-overlay-stop-recording', async () => {
      if (!mounted) return;
      
      // Check the actual recording state from backend
      const isCurrentlyRecording = await invoke<boolean>("is_recording");
      if (isCurrentlyRecording) {
        await stopRecording();
      }
    });

    const unsubscribeNativeCancel = listen('native-overlay-cancel-recording', async () => {
      if (!mounted) return;
      
      // Check the actual recording state from backend
      const isCurrentlyRecording = await invoke<boolean>("is_recording");
      if (isCurrentlyRecording) {
        await cancelRecording();
      }
    });

    return () => {
      mounted = false;
      unsubscribeNativeStart.then(fn => fn());
      unsubscribeNativeStop.then(fn => fn());
      unsubscribeNativeCancel.then(fn => fn());
    };
  }, [startRecording, stopRecording, cancelRecording]);
}
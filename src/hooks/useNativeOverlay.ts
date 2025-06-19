import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export function useNativeOverlay() {
  const [isVisible, setIsVisible] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Show the native overlay
  const show = async () => {
    try {
      await invoke('show_native_overlay');
      setIsVisible(true);
    } catch (error) {
      console.error('Failed to show native overlay:', error);
    }
  };

  // Hide the native overlay
  const hide = async () => {
    try {
      await invoke('hide_native_overlay');
      setIsVisible(false);
    } catch (error) {
      console.error('Failed to hide native overlay:', error);
    }
  };

  // Update overlay state
  const updateState = async (recording: boolean, processing: boolean) => {
    try {
      await invoke('update_native_overlay_state', { recording, processing });
      setIsRecording(recording);
      setIsProcessing(processing);
    } catch (error) {
      console.error('Failed to update native overlay state:', error);
    }
  };

  useEffect(() => {
    // Listen for recording requests from the native overlay
    const unsubscribeStart = listen('native-overlay-start-recording', () => {
      console.log('Native overlay wants to start recording');
      // This will be handled by the component using this hook
    });

    const unsubscribeStop = listen('native-overlay-stop-recording', () => {
      console.log('Native overlay wants to stop recording');
      // This will be handled by the component using this hook
    });

    return () => {
      unsubscribeStart.then(fn => fn());
      unsubscribeStop.then(fn => fn());
    };
  }, []);

  return {
    isVisible,
    isRecording,
    isProcessing,
    show,
    hide,
    updateState
  };
}
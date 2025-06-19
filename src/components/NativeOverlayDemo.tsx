import { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useNativeOverlay } from '../hooks/useNativeOverlay';

export function NativeOverlayDemo() {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'processing'>('idle');
  const nativeOverlay = useNativeOverlay();

  useEffect(() => {
    // Listen for recording requests from native overlay
    const unsubscribeStart = listen('native-overlay-start-recording', async () => {
      console.log('Starting recording from native overlay');
      try {
        await invoke('start_recording');
        setIsRecording(true);
        setRecordingState('recording');
        nativeOverlay.updateState(true, false);
      } catch (error) {
        console.error('Failed to start recording:', error);
      }
    });

    const unsubscribeStop = listen('native-overlay-stop-recording', async () => {
      console.log('Stopping recording from native overlay');
      try {
        await invoke('stop_recording');
        setIsRecording(false);
        setRecordingState('processing');
        nativeOverlay.updateState(false, true);
      } catch (error) {
        console.error('Failed to stop recording:', error);
      }
    });

    // Listen for recording state updates
    const unsubscribeRecordingState = listen('recording-state-update', (event: any) => {
      const { isRecording } = event.payload;
      setIsRecording(isRecording);
      if (isRecording) {
        setRecordingState('recording');
        nativeOverlay.updateState(true, false);
      }
    });

    // Listen for processing status
    const unsubscribeProcessing = listen('processing-status', (event: any) => {
      if (event.payload.Complete) {
        setRecordingState('idle');
        nativeOverlay.updateState(false, false);
      } else if (event.payload.Failed) {
        setRecordingState('idle');
        nativeOverlay.updateState(false, false);
      }
    });

    return () => {
      unsubscribeStart.then(fn => fn());
      unsubscribeStop.then(fn => fn());
      unsubscribeRecordingState.then(fn => fn());
      unsubscribeProcessing.then(fn => fn());
    };
  }, [nativeOverlay]);

  const toggleOverlay = () => {
    if (nativeOverlay.isVisible) {
      nativeOverlay.hide();
    } else {
      nativeOverlay.show();
    }
  };

  return (
    <div className="native-overlay-demo" style={{ padding: '20px' }}>
      <h2>Native NSPanel Overlay Demo</h2>
      <p>This demonstrates the true hover-without-focus overlay using native macOS NSPanel.</p>
      
      <div style={{ marginTop: '20px' }}>
        <button 
          onClick={toggleOverlay}
          style={{
            padding: '10px 20px',
            fontSize: '16px',
            borderRadius: '8px',
            background: nativeOverlay.isVisible ? '#ff4444' : '#44ff44',
            color: 'white',
            border: 'none',
            cursor: 'pointer'
          }}
        >
          {nativeOverlay.isVisible ? 'Hide' : 'Show'} Native Overlay
        </button>
      </div>

      <div style={{ marginTop: '20px' }}>
        <h3>Current State:</h3>
        <ul>
          <li>Overlay Visible: {nativeOverlay.isVisible ? 'Yes' : 'No'}</li>
          <li>Recording: {isRecording ? 'Yes' : 'No'}</li>
          <li>State: {recordingState}</li>
        </ul>
      </div>

      <div style={{ marginTop: '20px', padding: '15px', background: '#f0f0f0', borderRadius: '8px' }}>
        <h4>Features:</h4>
        <ul>
          <li>✅ True hover-without-focus (no click required)</li>
          <li>✅ Stays on top of all windows</li>
          <li>✅ Works across all Spaces</li>
          <li>✅ Doesn't steal focus from active app</li>
          <li>✅ Smooth expand/collapse animations</li>
          <li>✅ Native macOS look and feel</li>
        </ul>
      </div>
    </div>
  );
}
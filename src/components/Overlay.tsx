import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./Overlay.css";

interface RecordingState {
  isRecording: boolean;
  duration: number;
}

function Overlay() {
  const [recordingState, setRecordingState] = useState<RecordingState>({
    isRecording: false,
    duration: 0
  });
  const [isMinimized, setIsMinimized] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const currentWindow = getCurrentWindow();
    
    console.log("Overlay component mounted");
    
    // Log current window position periodically
    const positionLogger = setInterval(async () => {
      try {
        const pos = await currentWindow.outerPosition();
        const size = await currentWindow.outerSize();
        console.log(`Overlay position: x=${pos.x}, y=${pos.y}, size: ${size.width}x${size.height}`);
        setPosition({ x: pos.x, y: pos.y });
      } catch (e) {
        console.error("Error getting window position:", e);
      }
    }, 500);
    
    // Listen for recording state updates from main window
    const unsubscribeRecording = listen<RecordingState>("recording-state-update", (event) => {
      console.log("Recording state update:", event.payload);
      setRecordingState(event.payload);
      
      // Show window when recording starts
      if (event.payload.isRecording) {
        console.log("Showing overlay window");
        currentWindow.show();
        // Ensure we're not minimized when recording starts
        setIsMinimized(false);
      }
    });

    // Listen for recording stopped event
    const unsubscribeStopped = listen("recording-stopped", () => {
      // Hide window after a short delay when recording stops
      setTimeout(() => {
        currentWindow.hide();
      }, 1000);
    });

    return () => {
      clearInterval(positionLogger);
      unsubscribeRecording.then(fn => fn());
      unsubscribeStopped.then(fn => fn());
    };
  }, []);

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const handleClose = async () => {
    const currentWindow = getCurrentWindow();
    await currentWindow.hide();
  };

  if (!recordingState.isRecording) {
    return null;
  }

  return (
    <div className={`overlay-container ${isMinimized ? 'minimized' : ''}`}>
      <div className="overlay-content" style={{ position: 'relative' }}>
        <div style={{ position: 'absolute', top: -30, left: 0, fontSize: '14px', color: 'yellow', background: 'black', padding: '4px 8px', borderRadius: '4px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
          Pos: {position.x}, {position.y} | Screen: 3440x1440 | Expected: 1560,40
        </div>
        <div className="recording-indicator">
          <div className="recording-dot"></div>
          <span className="recording-text">Recording</span>
        </div>
        
        {!isMinimized && (
          <>
            <div className="duration">{formatDuration(recordingState.duration)}</div>
            <div className="overlay-actions">
              <button 
                className="minimize-btn"
                onClick={() => setIsMinimized(true)}
                title="Minimize"
              >
                −
              </button>
              <button 
                className="close-btn"
                onClick={handleClose}
                title="Hide overlay"
              >
                ×
              </button>
            </div>
          </>
        )}
        
        {isMinimized && (
          <button 
            className="expand-btn"
            onClick={() => setIsMinimized(false)}
            title="Expand"
          >
            +
          </button>
        )}
      </div>
    </div>
  );
}

export default Overlay;
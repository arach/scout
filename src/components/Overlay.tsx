import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import "./Overlay.css";

interface RecordingState {
  isRecording: boolean;
  duration: number;
  audioLevel?: number;
}

interface RecordingProgress {
  status?: "idle" | "recording" | "processing" | "transcribing" | "complete" | "failed";
  // The backend sends different enum variants, we need to handle them
  Idle?: any;
  Recording?: { filename: string; start_time: number };
  Stopping?: { filename: string };
}

interface ProcessingStatus {
  Queued?: { position: number };
  Processing?: { filename: string };
  Transcribing?: { filename: string };
  Complete?: { filename: string; transcript: string };
  Failed?: { filename: string; error: string };
}

function Overlay() {
  const [recordingState, setRecordingState] = useState<RecordingState>({
    isRecording: false,
    duration: 0
  });
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Component mounted
  const [progress, setProgress] = useState<RecordingProgress>({ status: "idle" });

  useEffect(() => {
    // Start in minimized state
    setIsExpanded(false);
    
    // Listen for recording state updates
    const unsubscribeRecording = listen<RecordingState>("recording-state-update", (event) => {
      setRecordingState(event.payload);
      
      // Automatically expand when recording starts
      if (event.payload.isRecording) {
        setIsExpanded(true);
      }
    });

    // Listen for recording stopped event
    const unsubscribeStopped = listen("recording-stopped", () => {
      setRecordingState({ isRecording: false, duration: 0 });
      // Keep expanded to show processing state
      // Will minimize when processing is complete
    });

    // Listen for progress updates
    const unsubscribeProgress = listen<RecordingProgress>("recording-progress", (event) => {
      // Convert Rust enum to our status format
      let status: RecordingProgress["status"] = "idle";
      if (event.payload.Idle !== undefined) {
        status = "idle";
      } else if (event.payload.Recording !== undefined) {
        status = "recording";
      } else if (event.payload.Stopping !== undefined) {
        status = "processing";
      }
      
      setProgress({ ...event.payload, status });
    });

    // Listen for processing status updates (from processing queue)
    const unsubscribeProcessing = listen<ProcessingStatus>("processing-status", (event) => {
      let status: RecordingProgress["status"] = "idle";
      
      if (event.payload.Processing !== undefined) {
        status = "processing";
      } else if (event.payload.Transcribing !== undefined) {
        status = "transcribing";
      } else if (event.payload.Complete !== undefined) {
        status = "complete";
      } else if (event.payload.Failed !== undefined) {
        status = "failed";
      }
      
      setProgress({ status });
      
      // Minimize when processing is complete or failed
      if (status === "complete" || status === "failed") {
        setTimeout(() => {
          setIsExpanded(false);
        }, 2000); // Let the completion animation play for 2 seconds before minimizing
      }
    });

    return () => {
      unsubscribeRecording.then(fn => fn());
      unsubscribeStopped.then(fn => fn());
      unsubscribeProgress.then(fn => fn());
      unsubscribeProcessing.then(fn => fn());
    };
  }, []); // Remove isExpanded dependency to prevent re-subscription

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  // Debug removed

  return (
    <div className={`overlay-container ${isExpanded ? 'expanded' : 'minimized'}`}>
      <div className="overlay-pill">
        {isExpanded ? (
          <div className="expanded-content">
            {recordingState.isRecording && (
              <>
                <div className="visualizer">
                  <div className="bar" style={{ height: `${Math.max(8, (recordingState.audioLevel || 0) * 20)}px` }} />
                  <div className="bar" style={{ height: `${Math.max(12, (recordingState.audioLevel || 0) * 28)}px` }} />
                  <div className="bar" style={{ height: `${Math.max(10, (recordingState.audioLevel || 0) * 24)}px` }} />
                </div>
                <span className="duration">{formatDuration(recordingState.duration)}</span>
              </>
            )}
            {!recordingState.isRecording && (progress.status === "processing" || progress.status === "transcribing") && (
              <>
                <div className="processing-indicator">
                  <div className="processing-dot" />
                  <div className="processing-dot" />
                  <div className="processing-dot" />
                </div>
                <span className="status-text">
                  {progress.status === "processing" ? "Processing..." : "Transcribing..."}
                </span>
              </>
            )}
            {!recordingState.isRecording && progress.status === "complete" && (
              <div className="completion-animation">
                <div className="completion-pulse" />
              </div>
            )}
            {!recordingState.isRecording && progress.status === "failed" && (
              <span className="status-text">✗ Failed</span>
            )}
          </div>
        ) : (
          <div className="minimized-content" />
        )}
      </div>
    </div>
  );
}

export default Overlay;
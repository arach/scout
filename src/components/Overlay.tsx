import { useState, useEffect, useRef } from "react";
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
  const [progress, setProgress] = useState<RecordingProgress>({ status: "idle" });
  const [audioHistory, setAudioHistory] = useState<number[]>([0.3, 0.5, 0.4, 0.6, 0.3]);
  const [pulseKey, setPulseKey] = useState(0);
  const animationRef = useRef<number>();
  const timeRef = useRef<number>(0);
  const minimizeTimeoutRef = useRef<number>();

  // Generate smooth audio visualization with real audio levels
  useEffect(() => {
    if (recordingState.isRecording) {
      const animate = (timestamp: number) => {
        if (!timeRef.current) timeRef.current = timestamp;
        const elapsed = timestamp - timeRef.current;
        
        setAudioHistory(prev => {
          // Use real audio level if available
          const audioLevel = recordingState.audioLevel || 0;
          
          // Log audio level every 500ms
          if (elapsed % 500 < 50) {
            console.log('Audio level:', audioLevel);
          }
          
          if (audioLevel > 0) {
            // Real audio data - create responsive waveform
            const newValues = prev.map((_, index) => {
              // Add some variation between bars
              const variation = 0.7 + (index * 0.1);
              const flutter = Math.sin(elapsed * 0.01 + index * 2) * 0.05;
              const value = audioLevel * variation + flutter;
              
              return Math.max(0.1, Math.min(1, value));
            });
            // Smooth transition by averaging with previous values
            return newValues.map((val, i) => (val + prev[i]) / 2);
          } else {
            // Fallback to simulated waveform if no audio data
            const newValues = prev.map((_, index) => {
              const base = 0.3 + Math.sin(elapsed * 0.002 + index * 0.8) * 0.15;
              const wave = Math.sin(elapsed * 0.005 + index * 1.2) * 0.1;
              const random = (Math.random() - 0.5) * 0.05;
              
              return Math.max(0.1, Math.min(1, base + wave + random));
            });
            return newValues;
          }
        });
        
        animationRef.current = requestAnimationFrame(animate);
      };
      animationRef.current = requestAnimationFrame(animate);
    } else {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      timeRef.current = 0;
      // Animate bars down when stopping
      setAudioHistory([0.1, 0.1, 0.1, 0.1, 0.1]);
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [recordingState.isRecording, recordingState.audioLevel]);

  useEffect(() => {
    // Start in minimized state
    setIsExpanded(false);
    console.log('Overlay component mounted');
    
    // Listen for recording state updates
    const unsubscribeRecording = listen<RecordingState>("recording-state-update", (event) => {
      console.log('Recording state update:', {
        isRecording: event.payload.isRecording,
        audioLevel: event.payload.audioLevel,
        duration: event.payload.duration
      });
      
      setRecordingState(event.payload);
      
      // Automatically expand with staggered animation when recording starts
      if (event.payload.isRecording && !isExpanded) {
        console.log('Recording started, expanding overlay');
        setIsExpanded(true);
        setPulseKey(prev => prev + 1);
      }
    });

    // Listen for recording stopped event
    const unsubscribeStopped = listen("recording-stopped", () => {
      console.log('Recording stopped event received');
      setRecordingState({ isRecording: false, duration: 0 });
      // Reset audio visualization
      setAudioHistory([0.1, 0.1, 0.1, 0.1, 0.1]);
      // Immediately show processing state
      setProgress({ status: "processing" });
      
      // Clear any existing minimize timeout
      if (minimizeTimeoutRef.current) {
        clearTimeout(minimizeTimeoutRef.current);
      }
      
      // Schedule minimize after delay
      console.log('Scheduling minimize in 800ms');
      minimizeTimeoutRef.current = window.setTimeout(() => {
        console.log('Minimizing overlay');
        setIsExpanded(false);
      }, 800);
    });

    // Listen for progress updates
    const unsubscribeProgress = listen<RecordingProgress>("recording-progress", (event) => {
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
        // Clear minimize timeout if we're still transcribing
        if (minimizeTimeoutRef.current) {
          clearTimeout(minimizeTimeoutRef.current);
        }
      } else if (event.payload.Complete !== undefined) {
        status = "complete";
        setPulseKey(prev => prev + 1); // Trigger completion animation
      } else if (event.payload.Failed !== undefined) {
        status = "failed";
      }
      
      setProgress({ status });
      
      // Minimize with elegant delay for completion states
      if (status === "complete" || status === "failed") {
        // Clear any existing timeout
        if (minimizeTimeoutRef.current) {
          clearTimeout(minimizeTimeoutRef.current);
        }
        
        minimizeTimeoutRef.current = window.setTimeout(() => {
          setIsExpanded(false);
        }, status === "complete" ? 2500 : 1500);
      }
    });

    return () => {
      unsubscribeRecording.then(fn => fn());
      unsubscribeStopped.then(fn => fn());
      unsubscribeProgress.then(fn => fn());
      unsubscribeProcessing.then(fn => fn());
      
      // Clear minimize timeout on cleanup
      if (minimizeTimeoutRef.current) {
        clearTimeout(minimizeTimeoutRef.current);
      }
    };
  }, []);

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  console.log('Render state:', { isExpanded, isRecording: recordingState.isRecording, status: progress.status });
  
  return (
    <div className={`overlay-container ${isExpanded ? 'expanded' : 'minimized'} state-${progress.status || 'idle'} ${recordingState.isRecording ? 'is-recording' : ''}`}>
      <div className="overlay-pill" key={`pill-${pulseKey}`}>
        {/* Background gradient effects */}
        <div className="gradient-bg" />
        <div className="shimmer-effect" />
        
        {isExpanded ? (
          <div className="expanded-content">
            {recordingState.isRecording && (
              <>
                <div className="recording-indicator">
                  <div className="pulse-ring" key={`pulse-${pulseKey}`} />
                  <div className="recording-dot" />
                  <span className="rec-label">REC</span>
                </div>
                
                <div className="visualizer">
                  {audioHistory.map((level, index) => (
                    <div 
                      key={index}
                      className="bar" 
                      style={{ 
                        height: `${Math.max(3, level * 18)}px`,
                        opacity: 0.6 + level * 0.4
                      }} 
                    />
                  ))}
                </div>
                
                <div className="duration-container">
                  <span className="duration">{formatDuration(recordingState.duration)}</span>
                  <div className="duration-pulse" />
                </div>
              </>
            )}
            
            {!recordingState.isRecording && (progress.status === "processing" || progress.status === "transcribing") && (
              <>
                <div className="processing-indicator">
                  <div className="processing-ring">
                    <div className="processing-orbit" />
                    <div className="processing-orbit delay-1" />
                    <div className="processing-orbit delay-2" />
                  </div>
                </div>
                <div className="status-container">
                  <span className="status-text">
                    {progress.status === "processing" ? "Processing" : "Transcribing"}
                  </span>
                  <div className="status-dots">
                    <span className="dot">.</span>
                    <span className="dot">.</span>
                    <span className="dot">.</span>
                  </div>
                </div>
              </>
            )}
            
            {!recordingState.isRecording && progress.status === "complete" && (
              <div className="completion-animation" key={`complete-${pulseKey}`}>
                <div className="success-ring" />
                <div className="checkmark-container">
                  <svg className="checkmark" viewBox="0 0 24 24" fill="none">
                    <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <div className="completion-sparkles">
                  <div className="sparkle" style={{ top: '20%', left: '20%' }} />
                  <div className="sparkle" style={{ top: '30%', right: '15%' }} />
                  <div className="sparkle" style={{ bottom: '25%', left: '15%' }} />
                  <div className="sparkle" style={{ bottom: '20%', right: '20%' }} />
                </div>
              </div>
            )}
            
            {!recordingState.isRecording && progress.status === "failed" && (
              <div className="error-state">
                <div className="error-icon">✗</div>
                <span className="status-text">Failed</span>
              </div>
            )}
          </div>
        ) : (
          <div className="minimized-content">
            <div className="minimized-indicator" />
          </div>
        )}
      </div>
    </div>
  );
}

export default Overlay;
import { useState, useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, primaryMonitor, LogicalSize, LogicalPosition } from "@tauri-apps/api/window";
import { OVERLAY_ANIMATION, OVERLAY_DIMENSIONS } from "../constants/overlay";
import { useOverlayWindow } from "../hooks/useOverlayWindow";
import { useMouseTracking } from "../hooks/useMouseTracking";
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
  // Configure overlay window for hover detection
  useOverlayWindow();
  
  const [recordingState, setRecordingState] = useState<RecordingState>({
    isRecording: false,
    duration: 0
  });
  const [isExpanded, setIsExpanded] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [contentVisible, setContentVisible] = useState(false);
  const [progress, setProgress] = useState<RecordingProgress>({ status: "idle" });
  
  // Debug: Track isExpanded changes
  useEffect(() => {
    console.log(`🔍 isExpanded changed to: ${isExpanded}`);
  }, [isExpanded]);
  
  // Debug: Track progress status changes
  useEffect(() => {
    console.log(`📍 Progress status is now: ${progress.status}`);
  }, [progress.status]);
  const [audioHistory, setAudioHistory] = useState<number[]>([0.3, 0.5, 0.4, 0.6, 0.3]);
  const [pulseKey, setPulseKey] = useState(0);
  const animationRef = useRef<number>();
  const timeRef = useRef<number>(0);
  const minimizeTimeoutRef = useRef<number>();
  const audioLevelCounterRef = useRef<number>(0);
  const hoverTimeoutRef = useRef<number>();

  // Generate smooth audio visualization with real audio levels
  useEffect(() => {
    if (recordingState.isRecording) {
      const animate = (timestamp: number) => {
        if (!timeRef.current) timeRef.current = timestamp;
        const elapsed = timestamp - timeRef.current;
        
        setAudioHistory(prev => {
          // Use real audio level if available
          const audioLevel = recordingState.audioLevel || 0;
          
          // Remove redundant logging here since we have better logging in recording-state-update
          
          if (audioLevel > 0.0001) { // Ignore noise floor
            // Real audio data - create responsive waveform
            // Amplify the audio level for better visualization
            const amplifiedLevel = Math.min(1, audioLevel * 20); // 20x amplification
            
            const newValues = prev.map((_, index) => {
              // Add some variation between bars
              const variation = 0.7 + (index * 0.1);
              const flutter = Math.sin(elapsed * 0.01 + index * 2) * 0.02;
              
              // Use logarithmic scaling for more natural audio visualization
              const logLevel = Math.log10(amplifiedLevel * 9 + 1);
              const value = logLevel * variation + flutter;
              
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
    console.log('🚀 Overlay component mounted');
    console.log('📦 Initial state: minimized');
    
    // Listen for recording state updates
    const unsubscribeRecording = listen<RecordingState>("recording-state-update", (event) => {
      // Debug: Log first event to see structure
      if (audioLevelCounterRef.current === 0 && event.payload.isRecording) {
        console.log('🔍 First event payload:', JSON.stringify(event.payload, null, 2));
      }
      
      // Always increment counter during recording
      if (event.payload.isRecording) {
        audioLevelCounterRef.current++;
        
        // Log audio levels less frequently - every 20 updates (about once per second)
        if (event.payload.audioLevel !== undefined && audioLevelCounterRef.current % 20 === 0) {
          const level = event.payload.audioLevel;
          const amplifiedLevel = Math.min(1, level * 20);
          const levelDesc = amplifiedLevel < 0.1 ? 'silent' : amplifiedLevel < 0.3 ? 'quiet' : amplifiedLevel < 0.6 ? 'moderate' : 'loud';
          const barCount = Math.floor(amplifiedLevel * 10);
          const bars = barCount > 0 ? '█'.repeat(barCount) : '▁';
          console.log(`📊 Audio: ${bars.padEnd(10, '·')} raw: ${level.toFixed(4)} amp: ${amplifiedLevel.toFixed(2)} (${levelDesc})`);
        }
      }
      
      setRecordingState(event.payload);
      
      // If not recording but still expanded, minimize it
      if (!event.payload.isRecording && isExpanded) {
        console.log('⚠️  Not recording but still expanded - force minimizing');
        console.log('Current state:', { isRecording: event.payload.isRecording, isExpanded });
        setIsExpanded(false);
      }
      
      // Automatically expand with staggered animation when recording starts
      if (event.payload.isRecording && !isExpanded) {
        // Reset counter for new session
        audioLevelCounterRef.current = 0;
        
        console.log('\n═══════════════════════════════════════');
        console.log('🎙️  RECORDING SESSION STARTED');
        console.log('═══════════════════════════════════════');
        console.log(`📅 Time: ${new Date().toLocaleTimeString()}`);
        console.log('📦 Overlay: minimized → expanded');
        console.log('🔴 State: idle → recording');
        console.log('⏱️  Duration tracking: started\n');
        
        // Clear hover state when recording starts
        setIsHovered(false);
        setIsExpanded(true);
        setContentVisible(true); // Immediately show content for recording
        setPulseKey(prev => prev + 1);
        
        // Resize window to expanded state
        resizeAndCenterWindow(true);
      }
    });

    // Listen for recording stopped event
    const unsubscribeStopped = listen("recording-stopped", () => {
      console.log('\n⏹️  RECORDING STOPPED');
      console.log('⚙️  State: recording → processing');
      console.log('📦 Overlay: staying expanded during processing\n');
      
      setRecordingState({ isRecording: false, duration: 0 });
      // Reset audio visualization
      setAudioHistory([0.1, 0.1, 0.1, 0.1, 0.1]);
      // Reset audio level counter for next session
      audioLevelCounterRef.current = 0;
      // Immediately show processing state
      setProgress({ status: "processing" });
      
      // Keep expanded during processing
      // Will minimize after complete animation
      setContentVisible(true); // Ensure content stays visible
    });

    // Listen for progress updates
    const unsubscribeProgress = listen<RecordingProgress>("recording-progress", (event) => {
      console.log('🔍 Progress event received:', JSON.stringify(event.payload));
      
      let status: RecordingProgress["status"] = "idle";
      if (event.payload.Idle !== undefined) {
        status = "idle";
      } else if (event.payload.Recording !== undefined) {
        status = "recording";
      } else if (event.payload.Stopping !== undefined) {
        status = "processing";
      }
      
      console.log(`📍 Progress mapped to status: ${status}`);
      setProgress({ ...event.payload, status });
    });

    // Listen for processing status updates (from processing queue)
    const unsubscribeProcessing = listen<ProcessingStatus>("processing-status", (event) => {
      let status: RecordingProgress["status"] = "idle";
      
      if (event.payload.Processing !== undefined) {
        status = "processing";
        console.log('⚙️  Processing: Audio file ready for transcription');
      } else if (event.payload.Transcribing !== undefined) {
        status = "transcribing";
        console.log('🎯 Transcribing: Whisper model analyzing audio...');
      } else if (event.payload.Complete !== undefined) {
        status = "complete";
        console.log('\n✅ TRANSCRIPTION COMPLETE');
        console.log(`📄 Length: ${event.payload.Complete.transcript.length} characters`);
        console.log(`📝 Preview: "${event.payload.Complete.transcript.slice(0, 80)}..."\n`);
        setPulseKey(prev => prev + 1); // Trigger completion animation
      } else if (event.payload.Failed !== undefined) {
        status = "failed";
        console.log('\n❌ TRANSCRIPTION FAILED');
        console.log(`📛 Error: ${event.payload.Failed.error}\n`);
      }
      
      setProgress({ status });
      
      // Debug: Log status changes
      console.log(`📍 Progress status changed to: ${status}`);
      
      // Don't minimize during processing - stay expanded
      
      // Return to idle and minimize after showing complete state
      if (status === "complete") {
        // Clear any existing timeout
        if (minimizeTimeoutRef.current) {
          clearTimeout(minimizeTimeoutRef.current);
        }
        
        minimizeTimeoutRef.current = window.setTimeout(() => {
          console.log('🔄 State: complete → idle');
          console.log('📦 Overlay: minimizing after complete');
          console.log('═══════════════════════════════════════\n');
          
          // Reset to idle state
          setProgress({ status: "idle" });
          
          // Minimize the overlay
          setIsExpanded(false);
          setContentVisible(false);
          setIsHovered(false);
          
          // Clear any pending hover timeout
          if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current);
            hoverTimeoutRef.current = undefined;
          }
          
          // Resize window back to minimized
          resizeAndCenterWindow(false);
        }, OVERLAY_ANIMATION.completeDisplayDuration);
      }
    });

    return () => {
      console.log('🔚 Overlay component unmounting');
      unsubscribeRecording.then(fn => fn());
      unsubscribeStopped.then(fn => fn());
      unsubscribeProgress.then(fn => fn());
      unsubscribeProcessing.then(fn => fn());
      
      // Clear timeouts on cleanup
      if (minimizeTimeoutRef.current) {
        clearTimeout(minimizeTimeoutRef.current);
      }
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  // Resize and recenter the overlay window
  const resizeAndCenterWindow = async (expanded: boolean) => {
    try {
      const window = getCurrentWindow();
      const dimensions = expanded ? OVERLAY_DIMENSIONS.expanded : OVERLAY_DIMENSIONS.minimized;
      
      console.log(`🔧 Resizing window to ${expanded ? 'expanded' : 'minimized'}: ${dimensions.width}x${dimensions.height}`);
      
      // Get current monitor info for centering
      const monitor = await primaryMonitor();
      if (!monitor) {
        console.error('No monitor found!');
        return;
      }
      
      // Calculate centered position
      const scaleFactor = monitor.scaleFactor || 1;
      const monitorWidth = monitor.size.width / scaleFactor;
      const x = Math.round((monitorWidth - dimensions.width) / 2);
      const y = 10; // Keep at top
      
      // Resize window
      await window.setSize(new LogicalSize(dimensions.width, dimensions.height));
      
      // Recenter window
      await window.setPosition(new LogicalPosition(x, y));
      
      console.log(`✅ Window resized to ${dimensions.width}x${dimensions.height} at (${x}, ${y})`);
    } catch (error) {
      console.error('❌ Failed to resize/center window:', error);
    }
  };

  // Handle CSS transition completion
  const handleTransitionEnd = (e: React.TransitionEvent) => {
    // Only care about width transitions on the container
    if (e.propertyName === 'width' && e.currentTarget === e.target) {
      if (isExpanded && !contentVisible) {
        console.log('✨ Expansion complete - showing content');
        setContentVisible(true);
      } else if (!isExpanded && contentVisible) {
        console.log('✨ Collapse complete - hiding content');
        setContentVisible(false);
      }
    }
  };

  // Handle mouse hover with delay
  const handleMouseEnter = useCallback(() => {
    console.log('🖱️ Mouse entered overlay', { 
      status: progress.status, 
      isRecording: recordingState.isRecording,
      isExpanded,
      isHovered
    });
    
    // Only allow hover when idle
    if (progress.status === "idle" && !recordingState.isRecording) {
      // Clear any existing timeout
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
      
      // Add small delay to prevent accidental triggers
      hoverTimeoutRef.current = window.setTimeout(async () => {
        console.log('🖱️ Mouse hover - starting expansion');
        console.log('Current state:', { isExpanded, isHovered });
        
        setIsHovered(true);
        setIsExpanded(true);
        
        // Try to resize the actual window
        try {
          await resizeAndCenterWindow(true);
        } catch (e) {
          console.error('Failed to resize on hover:', e);
        }
        
        // Content will be shown after transition completes
      }, 150); // 150ms delay for hover stability
    } else {
      console.log('🖱️ Hover ignored - not in idle state');
    }
  }, [progress.status, recordingState.isRecording, isExpanded, isHovered]);

  const handleMouseLeave = useCallback(() => {
    console.log('🖱️ Mouse left overlay', { isHovered, isRecording: recordingState.isRecording });
    
    // Clear hover timeout if mouse leaves before delay
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    
    // Only collapse if not recording and was expanded due to hover
    if (isHovered && !recordingState.isRecording && progress.status === "idle") {
      console.log('🖱️ Mouse leave - starting collapse');
      setIsHovered(false);
      setIsExpanded(false);
      // Resize the actual window
      resizeAndCenterWindow(false);
      // Content will be hidden after transition completes
    }
  }, [isHovered, recordingState.isRecording, progress.status]);

  // Handle click on minimized overlay
  const handleMinimizedClick = useCallback(() => {
    if (!isExpanded && progress.status === "idle" && !recordingState.isRecording) {
      console.log('🖱️ Minimized overlay clicked - expanding');
      setIsHovered(true);
      setIsExpanded(true);
      resizeAndCenterWindow(true);
    }
  }, [isExpanded, progress.status, recordingState.isRecording]);

  // Start recording when button is clicked
  const handleStartRecording = async () => {
    try {
      console.log('🎤 Starting recording from overlay button');
      await invoke('start_recording');
      // Clear hover state as recording will handle expansion
      setIsHovered(false);
      // Keep content visible during recording
      setContentVisible(true);
    } catch (error) {
      console.error('Failed to start recording:', error);
    }
  };

  // Stop recording when button is clicked
  const handleStopRecording = async (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent event bubbling
    try {
      console.log('⏹️ Stopping recording from overlay button');
      await invoke('stop_recording');
      // Keep overlay expanded during processing
      // It will minimize after complete animation
    } catch (error) {
      console.error('Failed to stop recording:', error);
      alert(`Failed to stop recording: ${error}`);
    }
  };

  // Use custom mouse tracking for better hover detection without focus
  const containerRef = useMouseTracking(handleMouseEnter, handleMouseLeave);
  
  // Remove per-render logging to reduce noise
  
  
  return (
    <div 
      ref={containerRef}
      className={`overlay-container ${isExpanded ? 'expanded' : 'minimized'} state-${progress.status || 'idle'} ${recordingState.isRecording ? 'is-recording' : ''} ${isHovered ? 'is-hovered' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onTransitionEnd={handleTransitionEnd}
    >
      <div className="overlay-pill" key={`pill-${pulseKey}`}>
        {/* Background gradient effects */}
        <div className="gradient-bg" />
        <div className="shimmer-effect" />
        
        {isExpanded ? (
          <div className="expanded-content">
            {/* Show record button when hovering in idle state */}
            {contentVisible && isHovered && progress.status === "idle" && !recordingState.isRecording && (
              <div className="hover-controls">
                <button 
                  className="record-button"
                  onClick={handleStartRecording}
                  title="Start recording"
                  aria-label="Start recording"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" fill="currentColor"/>
                    <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 19v3m-4 0h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span className="button-text">Record</span>
                </button>
              </div>
            )}
            
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
                        height: `${Math.max(3, level * 40)}px`,
                        opacity: 0.6 + level * 0.4
                      }} 
                    />
                  ))}
                </div>
                
                <div className="duration-container">
                  <span className="duration">{formatDuration(recordingState.duration)}</span>
                  <div className="duration-pulse" />
                </div>
                
                <button 
                  className="stop-button"
                  onClick={handleStopRecording}
                  title="Stop recording"
                  aria-label="Stop recording"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>
                  </svg>
                </button>
              </>
            )}
            
            {contentVisible && !recordingState.isRecording && (progress.status === "processing" || progress.status === "transcribing") && (
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
            
            {contentVisible && !recordingState.isRecording && progress.status === "complete" && (
              <div className="completion-animation" key={`complete-${pulseKey}`}>
                <div className="checkmark-container">
                  <svg className="checkmark" viewBox="0 0 24 24" fill="none">
                    <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <span className="status-text success">Complete</span>
              </div>
            )}
            
            {contentVisible && !recordingState.isRecording && progress.status === "failed" && (
              <div className="error-state">
                <div className="error-icon">✗</div>
                <span className="status-text">Failed</span>
              </div>
            )}
          </div>
        ) : (
          <div className="minimized-content" onClick={handleMinimizedClick}>
            {progress.status === "idle" && (
              <div className="minimized-indicator" />
            )}
            {(progress.status === "processing" || progress.status === "transcribing") && (
              <div className="minimized-processing">
                <div className="processing-wave" />
                <div className="processing-wave" />
                <div className="processing-wave" />
              </div>
            )}
            {progress.status === "complete" && (
              <div className="minimized-complete">
                <svg className="checkmark-mini" width="8" height="8" viewBox="0 0 24 24" fill="none">
                  <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default Overlay;
import { useState, useEffect, Fragment } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

interface Transcript {
  id: number;
  text: string;
  duration_ms: number;
  created_at: string;
  metadata?: string;
}

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [currentRecordingFile, setCurrentRecordingFile] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [currentTranscript, setCurrentTranscript] = useState<string>("");
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [vadEnabled, setVadEnabled] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [hotkey, setHotkey] = useState("CmdOrCtrl+Shift+Space");
  const [isCapturingHotkey, setIsCapturingHotkey] = useState(false);
  const [capturedKeys, setCapturedKeys] = useState<string[]>([]);

  useEffect(() => {
    loadRecentTranscripts();
    
    // Load saved hotkey
    const savedHotkey = localStorage.getItem('scout-hotkey');
    if (savedHotkey) {
      setHotkey(savedHotkey);
      // Update the global shortcut to use the saved hotkey
      invoke("update_global_shortcut", { shortcut: savedHotkey }).catch(err => {
        console.error("Failed to set saved hotkey:", err);
      });
    }
    
    // Listen for global hotkey events
    const unsubscribe = listen('toggle-recording', () => {
      if (isRecording) {
        stopRecording();
      } else {
        startRecording();
      }
    });
    
    return () => {
      unsubscribe.then(fn => fn());
    };
  }, [isRecording]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRecording) {
      const startTime = Date.now();
      interval = setInterval(() => {
        setRecordingDuration(Date.now() - startTime);
      }, 100);
    } else {
      setRecordingDuration(0);
    }
    return () => clearInterval(interval);
  }, [isRecording]);

  const loadRecentTranscripts = async () => {
    try {
      const recent = await invoke<Transcript[]>("get_recent_transcripts", { limit: 10 });
      setTranscripts(recent);
    } catch (error) {
      console.error("Failed to load transcripts:", error);
    }
  };

  const startRecording = async () => {
    try {
      const filename = await invoke<string>("start_recording");
      setCurrentRecordingFile(filename);
      setIsRecording(true);
      setCurrentTranscript("");
    } catch (error) {
      console.error("Failed to start recording:", error);
    }
  };

  const stopRecording = async () => {
    try {
      await invoke("stop_recording");
      setIsRecording(false);
      setIsProcessing(true);
      
      if (currentRecordingFile) {
        // Transcribe the audio
        let transcriptText = "";
        try {
          const transcript = await invoke<string>("transcribe_audio", { 
            audioFilename: currentRecordingFile 
          });
          
          if (!transcript || transcript.trim() === "") {
            transcriptText = "(No speech detected in recording)";
          } else {
            transcriptText = transcript;
          }
          setCurrentTranscript(transcriptText);
        } catch (transcriptionError) {
          console.error("Transcription failed:", transcriptionError);
          transcriptText = `Transcription error: ${transcriptionError}`;
          setCurrentTranscript(transcriptText);
          setIsProcessing(false);
          return; // Don't continue if transcription failed
        }
        
        // Save the transcript only if we have valid content
        if (transcriptText && transcriptText !== "(No speech detected in recording)" && !transcriptText.startsWith("Transcription error:")) {
          await invoke("save_transcript", { 
            text: transcriptText, 
            durationMs: recordingDuration 
          });
        }
        
        // Reload transcripts
        await loadRecentTranscripts();
        
        // Show success feedback
        setIsProcessing(false);
        setShowSuccess(true);
        setTimeout(() => setShowSuccess(false), 2000);
      }
    } catch (error) {
      console.error("Failed to stop recording:", error);
      setIsProcessing(false);
    }
  };

  const searchTranscripts = async () => {
    try {
      const results = await invoke<Transcript[]>("search_transcripts", { 
        query: searchQuery 
      });
      setTranscripts(results);
    } catch (error) {
      console.error("Failed to search transcripts:", error);
    }
  };

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const toggleVAD = async () => {
    try {
      const newVadState = !vadEnabled;
      await invoke("set_vad_enabled", { enabled: newVadState });
      setVadEnabled(newVadState);
    } catch (error) {
      console.error("Failed to toggle VAD:", error);
    }
  };

  const updateHotkey = async (newHotkey: string) => {
    try {
      await invoke("update_global_shortcut", { shortcut: newHotkey });
      setHotkey(newHotkey);
      localStorage.setItem('scout-hotkey', newHotkey);
    } catch (error) {
      console.error("Failed to update hotkey:", error);
      alert(`Failed to set hotkey: ${error}`);
    }
  };

  const startCapturingHotkey = () => {
    setIsCapturingHotkey(true);
    setCapturedKeys([]);
  };

  const stopCapturingHotkey = () => {
    setIsCapturingHotkey(false);
    if (capturedKeys.length > 0) {
      const newHotkey = capturedKeys.join('+');
      setHotkey(newHotkey);
    }
    setCapturedKeys([]);
  };

  useEffect(() => {
    if (!isCapturingHotkey) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      const keys: string[] = [];
      
      // Add modifiers
      if (e.metaKey || e.ctrlKey) keys.push('CmdOrCtrl');
      if (e.shiftKey) keys.push('Shift');
      if (e.altKey) keys.push('Alt');
      
      // Add the main key
      if (e.key && !['Control', 'Shift', 'Alt', 'Meta', 'Command'].includes(e.key)) {
        let key = e.key;
        
        // Capitalize single letters
        if (key.length === 1) {
          key = key.toUpperCase();
        }
        
        // Map special keys to their common names
        const keyMap: Record<string, string> = {
          ' ': 'Space',
          'ArrowUp': 'Up',
          'ArrowDown': 'Down',
          'ArrowLeft': 'Left',
          'ArrowRight': 'Right',
          'Escape': 'Esc',
          'Enter': 'Return',
        };
        
        if (keyMap[key]) {
          key = keyMap[key];
        }
        
        keys.push(key);
      }
      
      if (keys.length > 0) {
        setCapturedKeys(keys);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Stop capturing on key up if we have captured keys
      if (capturedKeys.length > 0) {
        stopCapturingHotkey();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isCapturingHotkey, capturedKeys]);

  return (
    <main className="container">
      <div className="header">
        <h1>Scout Voice Transcription</h1>
        <div className="header-controls">
          <input
            type="text"
            className="search-input"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && searchTranscripts()}
          />
          <button className="settings-button" onClick={() => setShowSettings(true)}>
            Settings
          </button>
        </div>
      </div>
      
      <div className="recording-section">
        <button
          className={`record-button ${isRecording ? 'recording' : ''} ${isProcessing ? 'processing' : ''}`}
          onClick={isRecording ? stopRecording : startRecording}
          disabled={isProcessing}
        >
          {isProcessing ? 'Processing...' : isRecording ? 'Stop Recording' : 'Start Recording'}
        </button>
        <p className="hotkey-hint">
          Press {hotkey.split('+').map((key, idx) => (
            <Fragment key={idx}>
              {idx > 0 && ' + '}
              <kbd>{key}</kbd>
            </Fragment>
          ))} to toggle recording
        </p>
        
        {isRecording && (
          <div className="recording-indicator">
            <div className="waveform">
              <span className="wave"></span>
              <span className="wave"></span>
              <span className="wave"></span>
              <span className="wave"></span>
              <span className="wave"></span>
            </div>
            <span>Recording... {formatDuration(recordingDuration)}</span>
          </div>
        )}
        
        {isProcessing && (
          <div className="processing-indicator">
            <div className="spinner"></div>
            <span>Transcribing your audio...</span>
          </div>
        )}
        
        {showSuccess && (
          <div className="success-indicator">
            <span className="checkmark">✓</span>
            <span>Recording saved successfully!</span>
          </div>
        )}
        
        {currentTranscript && (
          <div className="current-transcript">
            <h3>Latest Transcript</h3>
            <p>{currentTranscript}</p>
          </div>
        )}
      </div>


      <div className="transcripts-list">
        <h2>Transcripts</h2>
        {transcripts.length === 0 ? (
          <p>No transcripts yet. Start recording!</p>
        ) : (
          transcripts.map((transcript) => (
            <div key={transcript.id} className="transcript-item">
              <div className="transcript-header">
                <span className="transcript-date">
                  {new Date(transcript.created_at).toLocaleString()}
                </span>
                <span className="transcript-duration">
                  {formatDuration(transcript.duration_ms)}
                </span>
              </div>
              <p className="transcript-text">{transcript.text}</p>
            </div>
          ))
        )}
      </div>

      {showSettings && (
        <div className="settings-modal">
          <div className="settings-content">
            <div className="settings-header">
              <h2>Settings</h2>
              <button className="close-button" onClick={() => setShowSettings(false)}>
                ×
              </button>
            </div>
            
            <div className="settings-body">
              <div className="setting-item">
                <label>Global Hotkey</label>
                <div className="hotkey-input-group">
                  <div className={`hotkey-display ${isCapturingHotkey ? 'capturing' : ''}`}>
                    {isCapturingHotkey ? (
                      <span className="capturing-text">Press shortcut keys...</span>
                    ) : (
                      <span className="hotkey-keys">
                        {hotkey.split('+').map((key, idx) => (
                          <Fragment key={idx}>
                            {idx > 0 && <span className="plus">+</span>}
                            <kbd>{key}</kbd>
                          </Fragment>
                        ))}
                      </span>
                    )}
                  </div>
                  {isCapturingHotkey ? (
                    <button onClick={stopCapturingHotkey} className="cancel-button">
                      Cancel
                    </button>
                  ) : (
                    <>
                      <button onClick={startCapturingHotkey}>
                        Capture
                      </button>
                      <button onClick={() => updateHotkey(hotkey)} className="apply-button">
                        Apply
                      </button>
                    </>
                  )}
                </div>
                <p className="setting-hint">
                  Click "Capture" and press your desired shortcut combination
                </p>
              </div>
              
              <div className="setting-item">
                <label>
                  <input
                    type="checkbox"
                    checked={vadEnabled}
                    onChange={toggleVAD}
                  />
                  Voice Activity Detection
                </label>
                <p className="setting-hint">
                  Automatically start recording when you speak
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;

import { useState, useEffect } from "react";
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

  useEffect(() => {
    loadRecentTranscripts();
    
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

  return (
    <main className="container">
      <h1>Scout - Voice Transcription</h1>
      
      <div className="recording-section">
        <button
          className={`record-button ${isRecording ? 'recording' : ''} ${isProcessing ? 'processing' : ''}`}
          onClick={isRecording ? stopRecording : startRecording}
          disabled={isProcessing}
        >
          {isProcessing ? '⏳ Processing...' : isRecording ? '⏹ Stop Recording' : '🎤 Start Recording'}
        </button>
        <p className="hotkey-hint">Press Cmd+Shift+Space to toggle recording</p>
        
        <div className="recording-options">
          <label className="vad-toggle">
            <input
              type="checkbox"
              checked={vadEnabled}
              onChange={toggleVAD}
            />
            <span>Voice Activity Detection (Auto-record when speaking)</span>
          </label>
        </div>
        
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
            <h3>Latest Transcript:</h3>
            <p>{currentTranscript}</p>
          </div>
        )}
      </div>

      <div className="search-section">
        <input
          type="text"
          placeholder="Search transcripts..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && searchTranscripts()}
        />
        <button onClick={searchTranscripts}>Search</button>
        <button onClick={loadRecentTranscripts}>Show Recent</button>
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
    </main>
  );
}

export default App;

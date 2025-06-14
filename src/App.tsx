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
      
      if (currentRecordingFile) {
        // Transcribe the audio
        const transcript = await invoke<string>("transcribe_audio", { 
          audioFilename: currentRecordingFile 
        });
        setCurrentTranscript(transcript);
        
        // Save the transcript
        await invoke("save_transcript", { 
          text: transcript, 
          durationMs: recordingDuration 
        });
        
        // Reload transcripts
        await loadRecentTranscripts();
      }
    } catch (error) {
      console.error("Failed to stop recording:", error);
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

  return (
    <main className="container">
      <h1>Scout - Voice Transcription</h1>
      
      <div className="recording-section">
        <button
          className={`record-button ${isRecording ? 'recording' : ''}`}
          onClick={isRecording ? stopRecording : startRecording}
        >
          {isRecording ? '⏹ Stop Recording' : '🎤 Start Recording'}
        </button>
        <p className="hotkey-hint">Press Cmd+Shift+Space to toggle recording</p>
        
        {isRecording && (
          <div className="recording-indicator">
            <span className="recording-dot"></span>
            Recording... {formatDuration(recordingDuration)}
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

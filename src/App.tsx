import { useState, useEffect, Fragment, useRef } from "react";
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
  const [selectedTranscripts, setSelectedTranscripts] = useState<Set<number>>(new Set());
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    show: boolean;
    transcriptId: number | null;
    transcriptText: string;
    isBulk: boolean;
  }>({ show: false, transcriptId: null, transcriptText: "", isBulk: false });
  const lastToggleTimeRef = useRef(0);
  const [hotkeyUpdateStatus, setHotkeyUpdateStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const isStoppingRef = useRef(false);
  const [overlayPosition, setOverlayPosition] = useState<string>('top-center');

  useEffect(() => {
    loadRecentTranscripts();
    
    // Subscribe to recording progress updates
    invoke('subscribe_to_progress').catch(console.error);
    
    // Load saved overlay position
    const savedPosition = localStorage.getItem('scout-overlay-position');
    if (savedPosition) {
      setOverlayPosition(savedPosition);
      invoke('set_overlay_position', { position: savedPosition }).catch(console.error);
    } else {
      // Get current position from backend
      invoke<string>('get_overlay_position').then(pos => {
        setOverlayPosition(pos);
      }).catch(console.error);
    }
    
    // Check if this is the first time the app has ever been launched
    const hasInitialized = localStorage.getItem('scout-initialized');
    let savedHotkey = localStorage.getItem('scout-hotkey');
    
    // Clean up any invalid shortcuts
    if (savedHotkey) {
      // Fix redundant CmdOrCtrl+Ctrl
      if (savedHotkey.includes('CmdOrCtrl') && savedHotkey.includes('Ctrl')) {
        savedHotkey = savedHotkey.replace(/\+Ctrl/g, '').replace(/Ctrl\+/g, '');
      }
      
      // Fix corrupted "CmdOrShift" (should be CmdOrCtrl+Shift)
      if (savedHotkey.includes('CmdOrShift')) {
        savedHotkey = savedHotkey.replace('CmdOrShift', 'CmdOrCtrl+Shift');
      }
      
      // Validate that the shortcut has proper format
      const validModifiers = ['CmdOrCtrl', 'Cmd', 'Ctrl', 'Shift', 'Alt'];
      const parts = savedHotkey.split('+');
      const isValid = parts.every(part => 
        validModifiers.includes(part) || 
        /^[A-Z0-9]$/.test(part) || 
        ['Space', 'Enter', 'Tab', 'Escape', 'Up', 'Down', 'Left', 'Right', 'Backspace', 'Delete'].includes(part)
      );
      
      if (!isValid) {
        // If invalid, reset to default
        savedHotkey = "CmdOrCtrl+Shift+Space";
      }
      
      localStorage.setItem('scout-hotkey', savedHotkey);
    }
    
    if (!hasInitialized) {
      // First time setup
      localStorage.setItem('scout-initialized', 'true');
      
      // If there's a saved hotkey from a previous version, use it
      if (savedHotkey) {
        setHotkey(savedHotkey);
        // Update backend with saved hotkey
        invoke("update_global_shortcut", { shortcut: savedHotkey }).catch(console.error);
      } else {
        // Otherwise, save the default
        const defaultHotkey = "CmdOrCtrl+Shift+Space";
        localStorage.setItem('scout-hotkey', defaultHotkey);
        setHotkey(defaultHotkey);
      }
    } else if (savedHotkey) {
      // Not first time, load the saved hotkey and update backend
      setHotkey(savedHotkey);
      // Update backend with saved hotkey on every app start
      invoke("update_global_shortcut", { shortcut: savedHotkey }).catch(err => {
        console.error("Failed to restore saved hotkey:", err);
        // If registration fails, reset to default
        const defaultHotkey = "CmdOrCtrl+Shift+Space";
        setHotkey(defaultHotkey);
        localStorage.setItem('scout-hotkey', defaultHotkey);
        invoke("update_global_shortcut", { shortcut: defaultHotkey }).catch(console.error);
      });
    }
    
    // Listen for global hotkey events
    const unsubscribe = listen('toggle-recording', async () => {
      // Debounce to prevent rapid toggles
      const now = Date.now();
      if (now - lastToggleTimeRef.current < 300) {
        return;
      }
      lastToggleTimeRef.current = now;
      
      // Check the actual recording state from the backend
      try {
        const recording = await invoke<boolean>("is_recording");
        if (recording) {
          stopRecording();
        } else {
          startRecording();
        }
      } catch (error) {
        console.error("Failed to check recording state:", error);
      }
    });
    
    // Listen for recording progress updates
    const unsubscribeProgress = listen('recording-progress', (event) => {
      const progress = event.payload as any;
      console.log("Recording progress:", progress);
      
      // Update UI based on progress
      if (progress.Complete) {
        // Recording complete, transcript available
        setIsProcessing(false);
        loadRecentTranscripts();
      } else if (progress.Failed) {
        // Recording failed
        setIsProcessing(false);
        console.error("Recording failed:", progress.Failed.error);
      } else if (progress.Processing || progress.Transcribing) {
        // Still processing
        setIsProcessing(true);
      }
    });
    
    // Listen for processing status updates from the background queue
    const unsubscribeProcessing = listen('processing-status', (event) => {
      const status = event.payload as any;
      console.log("Processing status:", status);
      
      // Update UI based on processing status
      if (status.Complete) {
        // Transcription complete, refresh the transcript list
        console.log("Transcription complete, refreshing transcript list");
        loadRecentTranscripts();
        setShowSuccess(true);
        setTimeout(() => setShowSuccess(false), 2000);
      } else if (status.Failed) {
        console.error("Processing failed:", status.Failed);
      }
    });
    
    return () => {
      unsubscribe.then(fn => fn());
      unsubscribeProgress.then(fn => fn());
      unsubscribeProcessing.then(fn => fn());
    };
  }, []); // Empty dependency array since we're checking state from backend

  useEffect(() => {
    let interval: number;
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
    console.log("Start recording clicked", { isProcessing, isStoppingRef: isStoppingRef.current });
    
    // Prevent starting if we're still processing
    if (isProcessing || isStoppingRef.current) {
      console.log("Cannot start - still processing or stopping");
      return;
    }
    
    // IMMEDIATELY update UI for instant feedback
    setIsRecording(true);
    setCurrentTranscript("");
    (window as any).__recordingStartTime = Date.now();
    
    // Start the backend recording asynchronously
    try {
      const filename = await invoke<string>("start_recording");
      setCurrentRecordingFile(filename);
      console.log("Recording started:", filename);
    } catch (error) {
      console.error("Failed to start recording:", error);
      // Revert UI state on error
      setIsRecording(false);
    }
  };

  const stopRecording = async () => {
    // Prevent multiple simultaneous stop attempts using a ref
    if (isStoppingRef.current) {
      return;
    }
    isStoppingRef.current = true;
    
    // IMMEDIATELY update UI for instant feedback
    setIsRecording(false);
    let recordingFile = currentRecordingFile;
    const duration = recordingDuration;
    
    // Process everything else asynchronously
    (async () => {
      try {
        // If we don't have a recording file (e.g., from hotkey toggle), get it from backend
        if (!recordingFile) {
          const backendFile = await invoke<string | null>("get_current_recording_file");
          recordingFile = backendFile || null;
        }
        
        // Stop the backend recording
        await invoke("stop_recording");
        
        // The processing queue will handle transcription and saving
        // Just show that we're done recording
        if (recordingFile) {
          console.log("Recording stopped, file will be processed:", recordingFile);
        }
      } catch (error) {
        console.error("Failed to stop recording:", error);
      } finally {
        setIsProcessing(false);
        // Always reset the stopping flag
        isStoppingRef.current = false;
      }
    })(); // Execute the async function immediately
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

  const copyTranscript = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      // Could show a toast notification here
    });
  };

  const confirmDelete = async () => {
    if (deleteConfirmation.isBulk) {
      try {
        await invoke("delete_transcripts", { ids: Array.from(selectedTranscripts) });
        setSelectedTranscripts(new Set());
        await loadRecentTranscripts();
      } catch (error) {
        console.error("Failed to delete transcripts:", error);
        alert(`Failed to delete transcripts: ${error}`);
      }
    } else if (deleteConfirmation.transcriptId !== null) {
      try {
        await invoke("delete_transcript", { id: deleteConfirmation.transcriptId });
        await loadRecentTranscripts();
      } catch (error) {
        console.error("Failed to delete transcript:", error);
        alert(`Failed to delete transcript: ${error}`);
      }
    }
    setDeleteConfirmation({ show: false, transcriptId: null, transcriptText: "", isBulk: false });
  };

  const showDeleteConfirmation = (id: number, text: string) => {
    setDeleteConfirmation({
      show: true,
      transcriptId: id,
      transcriptText: text.length > 100 ? text.substring(0, 100) + "..." : text,
      isBulk: false
    });
  };

  const showBulkDeleteConfirmation = () => {
    if (selectedTranscripts.size === 0) return;
    
    setDeleteConfirmation({
      show: true,
      transcriptId: null,
      transcriptText: `${selectedTranscripts.size} transcript(s)`,
      isBulk: true
    });
  };

  const exportTranscripts = async (format: 'json' | 'markdown' | 'text') => {
    try {
      const toExport = selectedTranscripts.size > 0 
        ? transcripts.filter(t => selectedTranscripts.has(t.id))
        : transcripts;
      
      if (toExport.length === 0) {
        alert('No transcripts to export');
        return;
      }

      const exported = await invoke<string>("export_transcripts", { 
        transcripts: toExport, 
        format 
      });
      
      // Create a download
      const blob = new Blob([exported], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `scout-transcripts-${new Date().toISOString().split('T')[0]}.${format === 'json' ? 'json' : format === 'markdown' ? 'md' : 'txt'}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to export transcripts:", error);
    }
  };

  const toggleTranscriptSelection = (id: number) => {
    const newSelected = new Set(selectedTranscripts);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedTranscripts(newSelected);
  };

  const selectAllTranscripts = () => {
    if (selectedTranscripts.size === transcripts.length) {
      setSelectedTranscripts(new Set());
    } else {
      setSelectedTranscripts(new Set(transcripts.map(t => t.id)));
    }
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
  
  const updateOverlayPosition = async (position: string) => {
    try {
      await invoke('set_overlay_position', { position });
      setOverlayPosition(position);
      localStorage.setItem('scout-overlay-position', position);
    } catch (error) {
      console.error("Failed to update overlay position:", error);
    }
  };

  const updateHotkey = async (newHotkey: string) => {
    try {
      setHotkeyUpdateStatus('idle');
      await invoke("update_global_shortcut", { shortcut: newHotkey });
      setHotkey(newHotkey);
      localStorage.setItem('scout-hotkey', newHotkey);
      setHotkeyUpdateStatus('success');
      
      // Reset status after 2 seconds
      setTimeout(() => {
        setHotkeyUpdateStatus('idle');
      }, 2000);
    } catch (error) {
      console.error("Failed to update hotkey:", error);
      setHotkeyUpdateStatus('error');
      
      // Reset status after 3 seconds
      setTimeout(() => {
        setHotkeyUpdateStatus('idle');
      }, 3000);
    }
  };

  const startCapturingHotkey = () => {
    setIsCapturingHotkey(true);
    setCapturedKeys([]);
  };

  const stopCapturingHotkey = () => {
    setIsCapturingHotkey(false);
    if (capturedKeys.length > 0) {
      // Convert captured keys to Tauri format
      const convertedKeys = capturedKeys.map(key => {
        // For cross-platform compatibility, convert Cmd to CmdOrCtrl when it's alone
        if (key === 'Cmd') return 'CmdOrCtrl';
        // CmdOrCtrl stays as is (already handled in capture)
        return key;
      });
      const newHotkey = convertedKeys.join('+');
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
      
      // Add all modifiers separately - don't treat Hyper as special
      // This allows Karabiner's Hyper key (Cmd+Ctrl+Alt+Shift) to work properly
      // Important: On macOS, when both Cmd and Ctrl are pressed, we only need CmdOrCtrl
      const hasCmd = e.metaKey;
      const hasCtrl = e.ctrlKey;
      
      if (hasCmd && hasCtrl) {
        // When both are pressed, just use CmdOrCtrl for Tauri compatibility
        keys.push('CmdOrCtrl');
      } else if (hasCmd) {
        keys.push('Cmd');
      } else if (hasCtrl) {
        keys.push('Ctrl');
      }
      
      if (e.shiftKey) keys.push('Shift');
      if (e.altKey) keys.push('Alt');
      
      // Add the main key
      if (e.key && !['Control', 'Shift', 'Alt', 'Meta', 'Command'].includes(e.key)) {
        let key = e.key;
        
        // Handle Escape specially to cancel capture
        if (key === 'Escape') {
          stopCapturingHotkey();
          return;
        }
        
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
          'Enter': 'Return',
          'Tab': 'Tab',
          'Backspace': 'Backspace',
          'Delete': 'Delete',
          'Home': 'Home',
          'End': 'End',
          'PageUp': 'PageUp',
          'PageDown': 'PageDown',
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
      
      // Only stop capturing when a non-modifier key is released
      // This allows capturing complex modifier combinations
      const isModifierKey = ['Control', 'Shift', 'Alt', 'Meta', 'Command'].includes(e.key);
      
      if (!isModifierKey && capturedKeys.length > 0) {
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
          disabled={isProcessing || isStoppingRef.current}
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
        <div className="transcripts-header">
          <h2>Transcripts</h2>
          {transcripts.length > 0 && (
            <div className="transcript-actions">
              <button 
                className="select-all-button"
                onClick={selectAllTranscripts}
              >
                {selectedTranscripts.size === transcripts.length ? 'Deselect All' : 'Select All'}
              </button>
              {selectedTranscripts.size > 0 && (
                <>
                  <button
                    className="delete-button"
                    onClick={showBulkDeleteConfirmation}
                  >
                    Delete ({selectedTranscripts.size})
                  </button>
                  <div className="export-menu">
                    <button className="export-button">Export</button>
                    <div className="export-options">
                      <button onClick={() => exportTranscripts('json')}>JSON</button>
                      <button onClick={() => exportTranscripts('markdown')}>Markdown</button>
                      <button onClick={() => exportTranscripts('text')}>Text</button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        {transcripts.length === 0 ? (
          <p className="no-transcripts">No transcripts yet. Start recording!</p>
        ) : (
          transcripts.map((transcript) => (
            <div 
              key={transcript.id} 
              className={`transcript-item ${selectedTranscripts.has(transcript.id) ? 'selected' : ''}`}
            >
              <input
                type="checkbox"
                className="transcript-checkbox"
                checked={selectedTranscripts.has(transcript.id)}
                onChange={() => toggleTranscriptSelection(transcript.id)}
              />
              <div className="transcript-content">
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
              <div className="transcript-item-actions">
                <button
                  className="copy-button"
                  onClick={() => copyTranscript(transcript.text)}
                  title="Copy transcript"
                >
                  Copy
                </button>
                <button
                  className="delete-item-button"
                  onClick={() => showDeleteConfirmation(transcript.id, transcript.text)}
                  title="Delete transcript"
                >
                  Delete
                </button>
              </div>
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
                {hotkeyUpdateStatus === 'success' && (
                  <p className="setting-success">✓ Shortcut updated successfully!</p>
                )}
                {hotkeyUpdateStatus === 'error' && (
                  <p className="setting-error">Failed to update shortcut. Please try a different combination.</p>
                )}
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
              
              <div className="setting-item">
                <label>Overlay Position</label>
                <div className="overlay-position-grid">
                  <button
                    className={`position-button ${overlayPosition === 'top-left' ? 'active' : ''}`}
                    onClick={() => updateOverlayPosition('top-left')}
                    title="Top Left"
                  >↖</button>
                  <button
                    className={`position-button ${overlayPosition === 'top-center' ? 'active' : ''}`}
                    onClick={() => updateOverlayPosition('top-center')}
                    title="Top Center"
                  >↑</button>
                  <button
                    className={`position-button ${overlayPosition === 'top-right' ? 'active' : ''}`}
                    onClick={() => updateOverlayPosition('top-right')}
                    title="Top Right"
                  >↗</button>
                  
                  <button
                    className={`position-button ${overlayPosition === 'left-center' ? 'active' : ''}`}
                    onClick={() => updateOverlayPosition('left-center')}
                    title="Left Center"
                  >←</button>
                  <button
                    className="position-button center" disabled
                  >●</button>
                  <button
                    className={`position-button ${overlayPosition === 'right-center' ? 'active' : ''}`}
                    onClick={() => updateOverlayPosition('right-center')}
                    title="Right Center"
                  >→</button>
                  
                  <button
                    className={`position-button ${overlayPosition === 'bottom-left' ? 'active' : ''}`}
                    onClick={() => updateOverlayPosition('bottom-left')}
                    title="Bottom Left"
                  >↙</button>
                  <button
                    className={`position-button ${overlayPosition === 'bottom-center' ? 'active' : ''}`}
                    onClick={() => updateOverlayPosition('bottom-center')}
                    title="Bottom Center"
                  >↓</button>
                  <button
                    className={`position-button ${overlayPosition === 'bottom-right' ? 'active' : ''}`}
                    onClick={() => updateOverlayPosition('bottom-right')}
                    title="Bottom Right"
                  >↘</button>
                </div>
                <p className="setting-hint">
                  Choose where the recording indicator appears on your screen
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteConfirmation.show && (
        <div className="delete-modal-overlay">
          <div className="delete-modal">
            <div className="delete-modal-header">
              <h3>Confirm Delete</h3>
            </div>
            <div className="delete-modal-body">
              <p>Are you sure you want to delete {deleteConfirmation.isBulk ? deleteConfirmation.transcriptText : 'this transcript'}?</p>
              {!deleteConfirmation.isBulk && (
                <div className="delete-preview">
                  "{deleteConfirmation.transcriptText}"
                </div>
              )}
              <p className="delete-warning">This action cannot be undone.</p>
            </div>
            <div className="delete-modal-footer">
              <button 
                className="cancel-button"
                onClick={() => setDeleteConfirmation({ show: false, transcriptId: null, transcriptText: "", isBulk: false })}
              >
                Cancel
              </button>
              <button 
                className="confirm-delete-button"
                onClick={confirmDelete}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;

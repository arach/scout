import { useState, useEffect, Fragment, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ModelManager } from "./components/ModelManager";
import { FirstRunSetup } from "./components/FirstRunSetup";
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
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    filename?: string;
    fileSize?: number;
    status: 'idle' | 'uploading' | 'queued' | 'processing' | 'converting' | 'transcribing';
    queuePosition?: number;
    progress?: number;
  }>({ status: 'idle' });
  const [showFirstRun, setShowFirstRun] = useState(false);

  useEffect(() => {
    // Check if we have any models
    const checkModels = async () => {
      try {
        const hasModel = await invoke<boolean>('has_any_model');
        if (!hasModel) {
          setShowFirstRun(true);
        }
      } catch (error) {
        console.error('Failed to check models:', error);
      }
    };
    checkModels();
  }, []);

  useEffect(() => {
    loadRecentTranscripts();
    
    // Log current model on startup
    invoke<string>('get_current_model').then(model => {
      console.log('🤖 Current active model:', model);
    }).catch(console.error);
    
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
    
    // Get the current shortcut from backend (source of truth)
    invoke<string>('get_current_shortcut').then(backendShortcut => {
      setHotkey(backendShortcut);
      // Save to localStorage for quick access
      localStorage.setItem('scout-hotkey', backendShortcut);
    }).catch(err => {
      console.error('Failed to get current shortcut:', err);
      // Fallback to localStorage if backend fails
      const savedHotkey = localStorage.getItem('scout-hotkey') || 'CmdOrCtrl+Shift+Space';
      setHotkey(savedHotkey);
    });
    
    // Mark as initialized
    if (!localStorage.getItem('scout-initialized')) {
      localStorage.setItem('scout-initialized', 'true');
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
        console.error("Recording failed:", progress.Failed);
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
      if (status.Queued) {
        setUploadProgress(prev => ({
          ...prev,
          status: 'queued',
          queuePosition: status.Queued.position
        }));
      } else if (status.Processing) {
        setUploadProgress(prev => ({
          ...prev,
          status: 'processing',
          filename: status.Processing.filename
        }));
      } else if (status.Converting) {
        setUploadProgress(prev => ({
          ...prev,
          status: 'converting',
          filename: status.Converting.filename
        }));
      } else if (status.Transcribing) {
        setUploadProgress(prev => ({
          ...prev,
          status: 'transcribing',
          filename: status.Transcribing.filename
        }));
      } else if (status.Complete) {
        // Transcription complete, refresh the transcript list
        console.log("Transcription complete, refreshing transcript list");
        loadRecentTranscripts();
        setShowSuccess(true);
        setTimeout(() => setShowSuccess(false), 2000);
        setUploadProgress({ status: 'idle' });
        setIsProcessing(false);
      } else if (status.Failed) {
        console.error("Processing failed:", status.Failed);
        setIsProcessing(false);
        setUploadProgress({ status: 'idle' });
        // Show error message to user
        alert(`Failed to process audio file: ${status.Failed.error || 'Unknown error'}`);
      }
    });
    
    // Listen for file upload complete events
    const unsubscribeFileUpload = listen('file-upload-complete', (event) => {
      const data = event.payload as any;
      console.log("File upload complete:", data);
      
      // Update upload progress with file info
      setUploadProgress(prev => ({
        ...prev,
        filename: data.originalName || data.filename,
        fileSize: data.size,
        status: 'queued'
      }));
    });
    
    // Set up Tauri file drop handling for the entire window
    let unsubscribeFileDrop: (() => void) | undefined;
    const setupFileDrop = async () => {
      const webview = getCurrentWebview();
      unsubscribeFileDrop = await webview.onDragDropEvent(async (event) => {
        console.log('File drop event:', event);
        
        if (event.payload.type === 'hover') {
          setIsDragging(true);
        } else if (event.payload.type === 'drop') {
          setIsDragging(false);
          
          const files = event.payload.paths;
          const audioFiles = files.filter((filePath: string) => {
            const extension = filePath.split('.').pop()?.toLowerCase();
            return ['wav', 'mp3', 'm4a', 'flac', 'ogg', 'webm'].includes(extension || '');
          });

          if (audioFiles.length > 0) {
            // Process the first audio file
            const filePath = audioFiles[0];
            console.log('Processing dropped file:', filePath);
            
            try {
              setIsProcessing(true);
              setShowSuccess(false);
              
              const filename = filePath.split('/').pop() || 'audio file';
              setUploadProgress({
                filename: filename,
                status: 'uploading',
                progress: 0
              });

              const queuedFilename = await invoke<string>('transcribe_file', { 
                filePath: filePath 
              });

              console.log('File queued for processing:', queuedFilename);
            } catch (error) {
              console.error('Failed to process dropped file:', error);
              alert(`Failed to process file: ${error}`);
              setIsProcessing(false);
            }
          } else if (files.length > 0) {
            // Non-audio files were dropped
            alert('Please drop audio files only (wav, mp3, m4a, flac, ogg, webm)');
            setIsProcessing(false);
          }
        } else if (event.payload.type === 'cancel') {
          setIsDragging(false);
        }
      });
    };
    
    setupFileDrop();
    
    return () => {
      unsubscribe.then(fn => fn());
      unsubscribeProgress.then(fn => fn());
      unsubscribeProcessing.then(fn => fn());
      unsubscribeFileUpload.then(fn => fn());
      if (unsubscribeFileDrop) {
        unsubscribeFileDrop();
      }
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

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
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

  const handleFileUpload = async () => {
    try {
      const filePath = await open({
        multiple: false,
        filters: [
          {
            name: 'Audio Files',
            extensions: ['wav', 'mp3', 'm4a', 'flac', 'ogg', 'webm']
          }
        ]
      });

      if (!filePath) return;

      setIsProcessing(true);
      setShowSuccess(false);

      // Get filename from path
      const filename = filePath.split('/').pop() || 'audio file';
      
      // Set initial upload state
      setUploadProgress({
        filename: filename,
        status: 'uploading',
        progress: 0
      });

      // Show upload started message
      console.log('Uploading file:', filePath);

      // Send file to backend for processing - filePath is already a string
      const queuedFilename = await invoke<string>('transcribe_file', { 
        filePath: filePath 
      });

      console.log('File queued for processing:', queuedFilename);
      
      // File is now queued, processing will happen in background
      // The progress updates will come through the existing event listeners
      
    } catch (error) {
      console.error('Failed to upload file:', error);
      alert(`Failed to upload file: ${error}`);
      setIsProcessing(false);
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

  if (showFirstRun) {
    return <FirstRunSetup onComplete={() => setShowFirstRun(false)} />;
  }

  return (
    <main className={`container ${isDragging ? 'drag-highlight' : ''}`}>
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
      
      <div 
        className={`recording-section ${isDragging ? 'dragging' : ''}`}
      >
        <div className="recording-controls">
          <button
            className={`record-button ${isRecording ? 'recording' : ''} ${isProcessing ? 'processing' : ''}`}
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isProcessing || isStoppingRef.current}
          >
            {isProcessing ? (
              <span>Processing...</span>
            ) : isRecording ? (
              <div className="recording-content">
                <div className="mini-waveform">
                  <span className="mini-wave"></span>
                  <span className="mini-wave"></span>
                  <span className="mini-wave"></span>
                </div>
                <span className="rec-timer">{formatDuration(recordingDuration)}</span>
              </div>
            ) : (
              <>
                <div className="record-circle" />
                <span>Start Recording</span>
              </>
            )}
          </button>
          
          <div className="upload-divider">or</div>
          
          <button
            className="upload-button"
            onClick={handleFileUpload}
            disabled={isProcessing}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span>Upload Audio</span>
          </button>
        </div>
        
        {isDragging && (
          <div className="drop-zone-overlay">
            <div className="drop-zone-content">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <p>Drop audio files here</p>
              <span className="drop-zone-formats">Supported: WAV, MP3, M4A, FLAC, OGG, WebM</span>
            </div>
          </div>
        )}
        
        {isRecording && (
          <div className="recording-indicator">
            <div className="waveform">
              <span className="wave"></span>
              <span className="wave"></span>
              <span className="wave"></span>
              <span className="wave"></span>
              <span className="wave"></span>
            </div>
          </div>
        )}
        
        <div className="hints-container">
          <p className="hotkey-hint">
            {hotkey.split('+').map((key, idx) => (
              <Fragment key={idx}>
                {idx > 0 && ' + '}
                <kbd>{key}</kbd>
              </Fragment>
            ))}
          </p>
          <p className="drag-hint">or drag & drop audio files</p>
        </div>
        
        {uploadProgress.status !== 'idle' && (
          <div className="upload-progress-container">
            <div className="upload-progress-header">
              <h3>Processing Upload</h3>
              {uploadProgress.filename && (
                <span className="upload-filename">{uploadProgress.filename}</span>
              )}
            </div>
            
            <div className="upload-progress-status">
              {uploadProgress.status === 'uploading' && (
                <>
                  <div className="spinner"></div>
                  <span>Uploading file...</span>
                </>
              )}
              {uploadProgress.status === 'queued' && (
                <>
                  <div className="spinner"></div>
                  <span>In queue{uploadProgress.queuePosition ? ` (position ${uploadProgress.queuePosition})` : ''}</span>
                </>
              )}
              {uploadProgress.status === 'processing' && (
                <>
                  <div className="spinner"></div>
                  <span>Processing audio file...</span>
                </>
              )}
              {uploadProgress.status === 'converting' && (
                <>
                  <div className="spinner"></div>
                  <span>Converting to WAV format...</span>
                </>
              )}
              {uploadProgress.status === 'transcribing' && (
                <>
                  <div className="spinner"></div>
                  <span>Transcribing speech to text...</span>
                </>
              )}
            </div>
            
            {uploadProgress.fileSize && (
              <div className="upload-file-info">
                <span>Size: {formatFileSize(uploadProgress.fileSize)}</span>
              </div>
            )}
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
          <div className="no-transcripts">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.3">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="22"/>
              <line x1="8" y1="22" x2="16" y2="22"/>
            </svg>
            <h3>No transcripts yet</h3>
            <p>Press {hotkey.split('+').join(' + ')} or click "Start Recording" to begin</p>
          </div>
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
                <p className="transcript-text">
                  {transcript.text === "[BLANK_AUDIO]" ? (
                    <span className="transcript-empty">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style={{ marginRight: '6px', verticalAlign: 'text-bottom' }}>
                        <path d="M8 1a7 7 0 100 14A7 7 0 008 1zM7 4h2v5H7V4zm0 6h2v2H7v-2z"/>
                      </svg>
                      No speech detected in recording
                    </span>
                  ) : (
                    transcript.text
                  )}
                </p>
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
              
              <div className="setting-item model-manager-section">
                <ModelManager />
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

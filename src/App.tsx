import { useState, useEffect, Fragment, useRef } from "react";
import { flushSync } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ModelManager } from "./components/ModelManager";
import { FirstRunSetup } from "./components/FirstRunSetup";
import { Sidebar } from "./components/Sidebar";
import { RecordView } from "./components/RecordView";
import { TranscriptsView } from "./components/TranscriptsView";
import { SettingsView } from "./components/SettingsView";
import "./App.css";

interface Transcript {
  id: number;
  text: string;
  duration_ms: number;
  created_at: string;
  metadata?: string;
  audio_path?: string;
  file_size?: number;
}

type View = 'record' | 'transcripts' | 'settings';

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
  const isRecordingRef = useRef(false); // Add ref to track recording state
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
  const [overlayType, setOverlayType] = useState<'tauri' | 'native'>('tauri');
  const [currentView, setCurrentView] = useState<View>('record');
  const [sessionStartTime] = useState(() => new Date().toISOString());
  const processingFileRef = useRef<string | null>(null); // Track file being processed to prevent duplicates

  // Keep ref in sync with state
  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

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
    
    // Check current model on startup
    invoke<string>('get_current_model').catch(console.error);
    
    // Listen for recording requests from native overlay
    const unsubscribeNativeStart = listen('native-overlay-start-recording', async () => {
      // Check the actual recording state from backend to avoid stale closure
      const isCurrentlyRecording = await invoke<boolean>("is_recording");
      if (!isCurrentlyRecording) {
        await startRecording();
      }
    });

    const unsubscribeNativeStop = listen('native-overlay-stop-recording', async () => {
      // Check the actual recording state from backend
      const isCurrentlyRecording = await invoke<boolean>("is_recording");
      if (isCurrentlyRecording) {
        await stopRecording();
      }
    });

    const unsubscribeNativeCancel = listen('native-overlay-cancel-recording', async () => {
      // Check the actual recording state from backend
      const isCurrentlyRecording = await invoke<boolean>("is_recording");
      if (isCurrentlyRecording) {
        // Cancel the recording without processing
        setIsRecording(false);
        isRecordingRef.current = false;
        await invoke('cancel_recording');
      }
    });
    
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
    
    // Load overlay type preference
    const savedOverlayType = localStorage.getItem('scout-overlay-type');
    if (savedOverlayType === 'native' || savedOverlayType === 'tauri') {
      setOverlayType(savedOverlayType);
    }
    
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
        loadRecentTranscripts();
        setShowSuccess(true);
        setTimeout(() => setShowSuccess(false), 2000);
        setUploadProgress({ status: 'idle' });
        setIsProcessing(false);
        processingFileRef.current = null; // Clear the processing file reference
        
        // Native overlay state is managed by the backend
      } else if (status.Failed) {
        console.error("Processing failed:", status.Failed);
        setIsProcessing(false);
        processingFileRef.current = null; // Clear the processing file reference
        setUploadProgress({ status: 'idle' });
        // Show error message to user
        alert(`Failed to process audio file: ${status.Failed.error || 'Unknown error'}`);
        
        // Native overlay state is managed by the backend
      }
    });
    
    // Listen for file upload complete events
    const unsubscribeFileUpload = listen('file-upload-complete', (event) => {
      const data = event.payload as any;
      // File upload complete
      
      // Update upload progress with file info
      setUploadProgress(prev => ({
        ...prev,
        filename: data.originalName || data.filename,
        fileSize: data.size,
        status: 'queued'
      }));
    });
    
    // Listen for recording state changes from backend
    const unsubscribeRecordingState = listen("recording-state-changed", (event: any) => {
      const { state, filename } = event.payload;
      
      if (state === "recording") {
        // Only update if not already recording (avoid unnecessary re-renders)
        if (!isRecordingRef.current) {
          setIsRecording(true);
          isRecordingRef.current = true;
          setCurrentTranscript("");
          setCurrentRecordingFile(filename || null);
          (window as any).__recordingStartTime = Date.now();
        }
      } else if (state === "stopped") {
        // Only update if currently recording (avoid unnecessary re-renders)
        if (isRecordingRef.current) {
          setIsRecording(false);
          isRecordingRef.current = false;
        }
      }
    });
    
    // Set up Tauri file drop handling for the entire window
    let unsubscribeFileDrop: (() => void) | undefined;
    const setupFileDrop = async () => {
      const webview = getCurrentWebview();
      unsubscribeFileDrop = await webview.onDragDropEvent(async (event) => {
        // Check the event type from the event name
        if (event.event === 'tauri://drag-over') {
          setIsDragging(true);
        } else if (event.event === 'tauri://drag-drop') {
          setIsDragging(false);
          
          const files = (event.payload as any).paths;
          
          // Check if we're already processing to prevent duplicates
          if (isProcessing) {
            return;
          }
          
          const audioFiles = files.filter((filePath: string) => {
            const extension = filePath.split('.').pop()?.toLowerCase();
            return ['wav', 'mp3', 'm4a', 'flac', 'ogg', 'webm'].includes(extension || '');
          });

          if (audioFiles.length > 0) {
            // Process the first audio file
            const filePath = audioFiles[0];
            
            // Check if we're already processing this specific file
            if (processingFileRef.current === filePath) {
              return;
            }
            
            try {
              // Mark this file as being processed
              processingFileRef.current = filePath;
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
            } catch (error) {
              console.error('Failed to process dropped file:', error);
              alert(`Failed to process file: ${error}`);
              setIsProcessing(false);
              processingFileRef.current = null;
            }
          } else if (files.length > 0) {
            // Non-audio files were dropped
            alert('Please drop audio files only (wav, mp3, m4a, flac, ogg, webm)');
            setIsProcessing(false);
          }
        } else if (event.event === 'tauri://drag-leave') {
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
      unsubscribeRecordingState.then(fn => fn());
      unsubscribeNativeStart.then(fn => fn());
      unsubscribeNativeStop.then(fn => fn());
      unsubscribeNativeCancel.then(fn => fn());
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
  
  // Periodically sync recording state with backend to ensure consistency
  useEffect(() => {
    const syncInterval = setInterval(async () => {
      try {
        const backendIsRecording = await invoke<boolean>("is_recording");
        if (backendIsRecording !== isRecordingRef.current) {
          setIsRecording(backendIsRecording);
          isRecordingRef.current = backendIsRecording;
          
          // If backend is recording but frontend wasn't aware, sync other state
          if (backendIsRecording && !isRecording) {
            setCurrentTranscript("");
            (window as any).__recordingStartTime = Date.now();
          }
        }
      } catch (error) {
        // Silent fail - state sync is not critical
      }
    }, 2000); // Check every 2 seconds to reduce overhead
    
    return () => clearInterval(syncInterval);
  }, []); // Remove isRecording dependency to avoid recreating interval

  const loadRecentTranscripts = async () => {
    try {
      const recent = await invoke<Transcript[]>("get_recent_transcripts", { limit: 10 });
      setTranscripts(recent);
    } catch (error) {
      console.error("Failed to load transcripts:", error);
    }
  };

  const startRecording = async () => {
    // Prevent starting if already recording
    if (isRecordingRef.current) {
      return;
    }
    
    // IMMEDIATELY update UI for instant feedback - using flushSync to force synchronous update
    flushSync(() => {
      setIsRecording(true);
      setCurrentTranscript("");
    });
    
    isRecordingRef.current = true;
    (window as any).__recordingStartTime = Date.now();
    
    // Start the backend recording asynchronously
    try {
      const filename = await invoke<string>("start_recording");
      setCurrentRecordingFile(filename);
      
      // Native overlay state is managed by the backend
      if (overlayType === 'native') {
        
        // Start audio level monitoring - ensure we don't have multiple intervals
        if ((window as any).__audioLevelInterval) {
          clearInterval((window as any).__audioLevelInterval);
        }
        
        const levelInterval = setInterval(async () => {
          try {
            await invoke<number>('get_audio_level');
            // Removed logging to reduce noise
          } catch (e) {
            // Silent fail - audio level monitoring is not critical
          }
        }, 100);
        
        // Store interval ID for cleanup
        (window as any).__audioLevelInterval = levelInterval;
      }
    } catch (error) {
      console.error("Failed to start recording:", error);
      // Revert UI state on error
      flushSync(() => {
        setIsRecording(false);
      });
      isRecordingRef.current = false;
    }
  };

  const stopRecording = async () => {
    // Prevent stopping if not recording
    if (!isRecordingRef.current) {
      return;
    }
    
    // Clear audio level monitoring if running
    if ((window as any).__audioLevelInterval) {
      clearInterval((window as any).__audioLevelInterval);
      (window as any).__audioLevelInterval = null;
    }
    
    // IMMEDIATELY update UI for instant feedback - using flushSync for synchronous update
    flushSync(() => {
      setIsRecording(false);
    });
    isRecordingRef.current = false;
    
    // Stop the backend recording without waiting
    invoke("stop_recording").catch(error => {
      console.error("Failed to stop recording:", error);
    });
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

      // Send file to backend for processing - filePath is already a string
      const queuedFilename = await invoke<string>('transcribe_file', { 
        filePath: filePath 
      });
      
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
  
  const updateOverlayType = async (type: 'tauri' | 'native') => {
    try {
      setOverlayType(type);
      localStorage.setItem('scout-overlay-type', type);
      // Notify backend about overlay type change
      await invoke('set_overlay_type', { overlayType: type });
      
      // If switching to native, show the native overlay
      if (type === 'native') {
        await invoke('show_native_overlay');
      } else {
        // If switching away from native, hide it
        await invoke('hide_native_overlay');
      }
    } catch (error) {
      console.error("Failed to update overlay type:", error);
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
    <div className="app-container">
      <Sidebar currentView={currentView} onViewChange={setCurrentView} />
      <main className={`container ${isDragging ? 'drag-highlight' : ''}`}>
        {currentView === 'record' && (
          <RecordView
            isRecording={isRecording}
            isProcessing={isProcessing}
            recordingDuration={recordingDuration}
            hotkey={hotkey}
            uploadProgress={uploadProgress}
            sessionTranscripts={transcripts
              .filter(t => new Date(t.created_at) >= new Date(sessionStartTime))
              .slice(-10)}
            startRecording={startRecording}
            stopRecording={stopRecording}
            handleFileUpload={handleFileUpload}
            formatDuration={formatDuration}
            formatFileSize={formatFileSize}
            showDeleteConfirmation={showDeleteConfirmation}
          />
        )}
        {currentView === 'transcripts' && (
          <TranscriptsView
            transcripts={transcripts}
            selectedTranscripts={selectedTranscripts}
            searchQuery={searchQuery}
            hotkey={hotkey}
            setSearchQuery={setSearchQuery}
            searchTranscripts={searchTranscripts}
            toggleTranscriptSelection={toggleTranscriptSelection}
            selectAllTranscripts={selectAllTranscripts}
            showBulkDeleteConfirmation={showBulkDeleteConfirmation}
            exportTranscripts={exportTranscripts}
            copyTranscript={copyTranscript}
            showDeleteConfirmation={showDeleteConfirmation}
            formatDuration={formatDuration}
            formatFileSize={formatFileSize}
          />
        )}
        {currentView === 'settings' && (
          <SettingsView
            hotkey={hotkey}
            isCapturingHotkey={isCapturingHotkey}
            hotkeyUpdateStatus={hotkeyUpdateStatus}
            vadEnabled={vadEnabled}
            overlayPosition={overlayPosition}
            overlayType={overlayType}
            stopCapturingHotkey={stopCapturingHotkey}
            startCapturingHotkey={startCapturingHotkey}
            updateHotkey={updateHotkey}
            toggleVAD={toggleVAD}
            updateOverlayPosition={updateOverlayPosition}
            updateOverlayType={updateOverlayType}
          />
        )}
        {isDragging && (
          <div className="drag-drop-overlay">
            <div className="drag-drop-backdrop" />
            <div className="drag-drop-container">
              <div className="drag-drop-border">
                <div className="drag-drop-content">
                  <div className="drag-drop-icon">
                    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M20 8V25M20 25L14 19M20 25L26 19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M10 32H30" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>
                    </svg>
                  </div>
                  <h2 className="drag-drop-title">Drop your audio files here</h2>
                  <p className="drag-drop-subtitle">Release to upload and transcribe</p>
                  <div className="drag-drop-formats">
                    <span className="format-badge">WAV</span>
                    <span className="format-badge">MP3</span>
                    <span className="format-badge">M4A</span>
                    <span className="format-badge">FLAC</span>
                    <span className="format-badge">OGG</span>
                    <span className="format-badge">WebM</span>
                  </div>
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
    </div>
  );
}

export default App;

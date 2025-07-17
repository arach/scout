import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { FirstRunSetup } from "./components/FirstRunSetup";
import { Sidebar, useSidebarState } from "./components/Sidebar";
import { RecordView } from "./components/RecordView";
import { TranscriptsView } from "./components/TranscriptsView";
import { SettingsView } from "./components/SettingsView";
import { ChevronRight, PanelLeftClose } from 'lucide-react';
import { useRecording } from './hooks/useRecording';
import { useSettings } from './hooks/useSettings';
import { useFileDrop } from './hooks/useFileDrop';
import { useTranscriptEvents } from './hooks/useTranscriptEvents';
import { useProcessingStatus } from './hooks/useProcessingStatus';
import { useNativeOverlay } from './hooks/useNativeOverlay';
import { DevTools } from './components/DevTools';
import { TranscriptionOverlay } from './components/TranscriptionOverlay';
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
  const { isExpanded: isSidebarExpanded, toggleExpanded: toggleSidebar } = useSidebarState();
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [vadEnabled, setVadEnabled] = useState(false);
  const [selectedMic, setSelectedMic] = useState<string>('Default microphone');
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCapturingHotkey, setIsCapturingHotkey] = useState(false);
  const [isCapturingPushToTalkHotkey, setIsCapturingPushToTalkHotkey] = useState(false);
  const [capturedKeys, setCapturedKeys] = useState<string[]>([]);
  const [selectedTranscripts, setSelectedTranscripts] = useState<Set<number>>(new Set());
  const [showTranscriptionOverlay, setShowTranscriptionOverlay] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    show: boolean;
    transcriptId: number | null;
    transcriptText: string;
    isBulk: boolean;
  }>({ show: false, transcriptId: null, transcriptText: "", isBulk: false });
  const [hotkeyUpdateStatus, setHotkeyUpdateStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [uploadProgress, setUploadProgress] = useState<{
    filename?: string;
    fileSize?: number;
    status: 'idle' | 'uploading' | 'queued' | 'processing' | 'converting' | 'transcribing';
    queuePosition?: number;
    progress?: number;
  }>({ status: 'idle' });
  const [showFirstRun, setShowFirstRun] = useState(false);
  const [currentView, setCurrentView] = useState<View>('record');
  const [sessionStartTime] = useState(() => new Date().toISOString());
  const processingFileRef = useRef<string | null>(null); // Track file being processed to prevent duplicates
  const keyboardMonitorAvailable = useRef(true);
  // const processingStartTimeRef = useRef<number>(0); // Unused variable
  
  // Use the settings hook
  const {
    overlayPosition,
    hotkey,
    pushToTalkHotkey,
    theme,
    soundEnabled,
    startSound,
    stopSound,
    successSound,
    completionSoundThreshold,
    llmSettings,
    autoCopy,
    autoPaste,
    setHotkey,
    setPushToTalkHotkey,
    updateOverlayPosition,
    updateTheme,
    toggleSoundEnabled,
    updateStartSound,
    updateStopSound,
    updateSuccessSound,
    updateCompletionSoundThreshold,
    updateLLMSettings,
    toggleAutoCopy,
    toggleAutoPaste,
  } = useSettings();

  // Use the recording hook
  const { 
    isRecording, 
    recordingStartTime, 
    audioLevel, 
    toggleRecording,
    startRecording,
    stopRecording,
    cancelRecording 
  } = useRecording({
    onTranscriptCreated: () => {
      if (currentView === 'record') {
        loadRecentTranscripts();
      }
    },
    onRecordingComplete: () => {
      // Don't show processing state for normal recording
      // Ring buffer transcribes in real-time, so transcription is already done
      // The transcript-created event will fire immediately
      // Only file uploads need the processing state
    },
    soundEnabled,
    selectedMic,
    vadEnabled,
    pushToTalkShortcut: pushToTalkHotkey
  });

  // Use the file drop hook
  const { isDragging } = useFileDrop({
    isProcessing,
    onFileDropped: async (filePath) => {
      try {
        setIsProcessing(true);
        const filename = filePath.split('/').pop() || 'audio file';
        setUploadProgress({
          filename: filename,
          status: 'uploading',
          progress: 0
        });

        await invoke<string>('transcribe_file', { 
          filePath: filePath 
        });
      } catch (error) {
        console.error('Failed to process dropped file:', error);
        alert(`Failed to process file: ${error}`);
        setIsProcessing(false);
        processingFileRef.current = null;
      }
    }
  });

  // Use the transcript events hook
  useTranscriptEvents({
    autoCopy,
    autoPaste,
    soundEnabled,
    completionSoundThreshold,
    setIsProcessing,
    setTranscripts,
    onTranscriptCreated: () => {
      if (currentView === 'record') {
        loadRecentTranscripts();
      }
    },
    onProcessingComplete: () => {
      // Force refresh to ensure UI is updated
      setTimeout(() => {
        loadRecentTranscripts();
      }, 50);
    },
    onRecordingCompleted: () => {
      // Force refresh
      setTimeout(() => {
        loadRecentTranscripts();
      }, 50);
    }
  });

  // Use the processing status hook
  useProcessingStatus({
    setUploadProgress,
    setIsProcessing,
    onProcessingComplete: () => {
      loadRecentTranscripts();
    }
  });

  // Use the native overlay hook
  useNativeOverlay({
    startRecording,
    stopRecording,
    cancelRecording
  });

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
    
    // One-time check of all audio devices
    const checkAudioDevices = async () => {
      try {
        const devices = await invoke<string[]>('get_audio_devices');
        console.log('🔊 Audio devices available:', devices);
      } catch (error) {
        console.error('🔊 Failed to get audio devices:', error);
      }
    };
    checkAudioDevices();
    
    // Clipboard settings are now loaded by useSettings hook
  }, []);

  useEffect(() => {
    let mounted = true;
    
    const init = async () => {
      if (!mounted) return;
      
      loadRecentTranscripts();
      
      // Check current model on startup
      invoke<string>('get_current_model').catch(console.error);
      
      // Subscribe to recording progress updates
      invoke('subscribe_to_progress').catch(console.error);
    };
    
    init();
    
    // Listen for global hotkey events
    const unsubscribe = listen('toggle-recording', async () => {
      if (!mounted) return;
      await toggleRecording();
    });
    
    // Listen for keyboard monitor unavailable event
    const unsubscribeKeyboardMonitor = listen('keyboard-monitor-unavailable', async (event) => {
      if (!mounted) return;
      console.warn('Keyboard monitor unavailable:', event.payload);
      keyboardMonitorAvailable.current = false;
    });

    return () => {
      mounted = false;
      unsubscribe.then(fn => fn()).catch(console.error);
      unsubscribeKeyboardMonitor.then(fn => fn()).catch(console.error);
    };
  }, []); // Empty dependency array since we're checking state from backend

  // Recording duration is now managed by the useRecording hook

  // Load appropriate transcripts based on current view
  useEffect(() => {
    if (currentView === 'transcripts') {
      loadAllTranscripts();
    } else if (currentView === 'record') {
      loadRecentTranscripts();
    }
  }, [currentView]);




  const loadRecentTranscripts = async () => {
    try {
      const recent = await invoke<Transcript[]>("get_recent_transcripts", { limit: 10 });
      setTranscripts(recent);
    } catch (error) {
      console.error("Failed to load transcripts:", error);
    }
  };

  const loadAllTranscripts = async () => {
    try {
      // Load more transcripts for the transcripts view
      const all = await invoke<Transcript[]>("get_recent_transcripts", { limit: 1000 });
      setTranscripts(all);
    } catch (error) {
      console.error("Failed to load all transcripts:", error);
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
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    // For very short durations, show milliseconds
    if (ms < 1000) {
      return `${ms}ms`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      // For 1-59 seconds, show decimal if there are significant milliseconds
      const decimal = ((ms % 1000) / 1000).toFixed(1).substring(1);
      if (ms % 1000 >= 100) {
        return `${seconds}${decimal}s`;
      }
      return `${seconds}s`;
    }
  };

  // Consistent timer format for recording - always show MM:SS.CS format (centiseconds)
  const formatRecordingTimer = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const centiseconds = Math.floor((ms % 1000) / 10); // Get centiseconds (00-99)
    
    // Always show MM:SS.CS format with leading zeros
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
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
      
      // Create a download with appropriate MIME type
      const mimeType = format === 'json' ? 'application/json' : 
                      format === 'markdown' ? 'text/markdown' : 
                      'text/plain';
      const blob = new Blob([exported], { type: mimeType });
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
  
  const toggleTranscriptGroupSelection = (ids: number[]) => {
    const newSelected = new Set(selectedTranscripts);
    const allSelected = ids.every(id => newSelected.has(id));
    
    if (allSelected) {
      // Deselect all in group
      ids.forEach(id => newSelected.delete(id));
    } else {
      // Select all in group
      ids.forEach(id => newSelected.add(id));
    }
    
    setSelectedTranscripts(newSelected);
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

      // Get filename from path
      const filename = filePath.split('/').pop() || 'audio file';
      
      // Set initial upload state
      setUploadProgress({
        filename: filename,
        status: 'uploading',
        progress: 0
      });

      // Send file to backend for processing - filePath is already a string
      await invoke<string>('transcribe_file', { 
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

  // All settings update functions are now handled by the useSettings hook
  

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

  const updatePushToTalkHotkey = async (newHotkey: string) => {
    try {
      await invoke("update_push_to_talk_shortcut", { shortcut: newHotkey });
      setPushToTalkHotkey(newHotkey);
      localStorage.setItem('scout-push-to-talk-hotkey', newHotkey);
    } catch (error) {
      console.error("Failed to update push-to-talk hotkey:", error);
    }
  };

  const startCapturingHotkey = () => {
    setIsCapturingHotkey(true);
    setCapturedKeys([]);
  };

  const startCapturingPushToTalkHotkey = () => {
    setIsCapturingPushToTalkHotkey(true);
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
      // Auto-save the hotkey like push-to-talk does
      updateHotkey(newHotkey);
    }
    setCapturedKeys([]);
  };

  const stopCapturingPushToTalkHotkey = () => {
    setIsCapturingPushToTalkHotkey(false);
    if (capturedKeys.length > 0) {
      const convertedKeys = capturedKeys.map(key => {
        if (key === 'Cmd') return 'CmdOrCtrl';
        return key;
      });
      const newHotkey = convertedKeys.join('+');
      updatePushToTalkHotkey(newHotkey);
    }
    setCapturedKeys([]);
  };

  useEffect(() => {
    if (!isCapturingHotkey && !isCapturingPushToTalkHotkey) return;

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
  }, [isCapturingHotkey, isCapturingPushToTalkHotkey, capturedKeys]);

  // Add escape key handler for canceling recordings
  useEffect(() => {
    const handleEscapeKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isRecording) {
        e.preventDefault();
        cancelRecording();
      }
    };

    window.addEventListener('keydown', handleEscapeKey);
    return () => window.removeEventListener('keydown', handleEscapeKey);
  }, [isRecording]);


  if (showFirstRun) {
    return <FirstRunSetup onComplete={() => setShowFirstRun(false)} />;
  }

  return (
    <div className="app-container">
      <Sidebar currentView={currentView} onViewChange={setCurrentView} isExpanded={isSidebarExpanded} />
      <main className={`container ${isDragging ? 'drag-highlight' : ''}`}>
        <button
          className="sidebar-toggle-main"
          onClick={toggleSidebar}
          aria-label={isSidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
          title={isSidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {isSidebarExpanded ? <PanelLeftClose size={14} /> : <ChevronRight size={14} />}
        </button>
        {currentView === 'record' && (
          <RecordView
            isRecording={isRecording}
            isProcessing={isProcessing}
            recordingStartTime={recordingStartTime}
            hotkey={hotkey}
            pushToTalkHotkey={pushToTalkHotkey}
            uploadProgress={uploadProgress}
            sessionTranscripts={transcripts
              .filter(t => new Date(t.created_at) >= new Date(sessionStartTime))
              .slice(-10)}
            selectedMic={selectedMic}
            onMicChange={setSelectedMic}
            audioLevel={audioLevel}
            startRecording={startRecording}
            stopRecording={stopRecording}
            cancelRecording={cancelRecording}
            handleFileUpload={handleFileUpload}
            formatDuration={formatDuration}
            formatRecordingTimer={formatRecordingTimer}
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
            toggleTranscriptGroupSelection={toggleTranscriptGroupSelection}
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
            pushToTalkHotkey={pushToTalkHotkey}
            isCapturingPushToTalkHotkey={isCapturingPushToTalkHotkey}
            vadEnabled={vadEnabled}
            overlayPosition={overlayPosition}
            autoCopy={autoCopy}
            autoPaste={autoPaste}
            theme={theme}
            soundEnabled={soundEnabled}
            startSound={startSound}
            stopSound={stopSound}
            successSound={successSound}
            completionSoundThreshold={completionSoundThreshold}
            llmSettings={llmSettings}
            stopCapturingHotkey={stopCapturingHotkey}
            startCapturingHotkey={startCapturingHotkey}
            startCapturingPushToTalkHotkey={startCapturingPushToTalkHotkey}
            stopCapturingPushToTalkHotkey={stopCapturingPushToTalkHotkey}
            toggleVAD={toggleVAD}
            updateOverlayPosition={updateOverlayPosition}
            toggleAutoCopy={toggleAutoCopy}
            toggleAutoPaste={toggleAutoPaste}
            updateTheme={updateTheme}
            toggleSoundEnabled={toggleSoundEnabled}
            updateStartSound={updateStartSound}
            updateStopSound={updateStopSound}
            updateSuccessSound={updateSuccessSound}
            updateCompletionSoundThreshold={updateCompletionSoundThreshold}
            updateLLMSettings={updateLLMSettings}
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

      {/* Global Dev Tools - Context Aware */}
      <DevTools
        currentView={currentView}
        // Recording context
        audioLevel={audioLevel}
        selectedMic={selectedMic}
        isRecording={isRecording}
        isProcessing={isProcessing}
        // Transcripts context
        transcripts={transcripts}
        searchQuery={searchQuery}
        selectedTranscripts={selectedTranscripts}
        // Settings context
        vadEnabled={vadEnabled}
        hotkey={hotkey}
        pushToTalkHotkey={pushToTalkHotkey}
        // App info
        appVersion="0.1.0"
        // Transcription overlay
        showTranscriptionOverlay={showTranscriptionOverlay}
        onToggleTranscriptionOverlay={setShowTranscriptionOverlay}
      />

      {/* Transcription Overlay */}
      <TranscriptionOverlay
        isVisible={showTranscriptionOverlay}
        isRecording={isRecording}
        audioLevel={audioLevel}
        onClose={() => setShowTranscriptionOverlay(false)}
        onSaveEdits={(editedText) => {
          console.log('Saved edited transcript:', editedText);
          // TODO: Save edited transcript
        }}
        onDiscardEdits={() => {
          console.log('Discarded transcript edits');
        }}
      />
    </div>
  );
}

export default App;

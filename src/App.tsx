import { useState, useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { FirstRunSetup } from "./components/FirstRunSetup";
import { Sidebar, useSidebarState } from "./components/Sidebar";
import { RecordView } from "./components/RecordView";
import { TranscriptsView } from "./components/TranscriptsView";
import { SettingsView } from "./components/SettingsView";
import { ChevronRight, PanelLeftClose } from 'lucide-react';
import { LLMSettings as LLMSettingsType } from './types/llm';
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
  const [isRecording, setIsRecording] = useState(false);
  const [, setCurrentRecordingFile] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [, setCurrentTranscript] = useState<string>("");
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [vadEnabled, setVadEnabled] = useState(false);
  const [selectedMic, setSelectedMic] = useState<string>('Default microphone');
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [, setShowSuccess] = useState(false);
  const [hotkey, setHotkey] = useState("CmdOrCtrl+Shift+Space");
  const [pushToTalkHotkey, setPushToTalkHotkey] = useState("CmdOrCtrl+Shift+P");
  const [isCapturingHotkey, setIsCapturingHotkey] = useState(false);
  const [isCapturingPushToTalkHotkey, setIsCapturingPushToTalkHotkey] = useState(false);
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
  const [autoCopy, setAutoCopy] = useState(false);
  const [autoPaste, setAutoPaste] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  const [audioLevel, setAudioLevel] = useState(0);
  const audioTargetRef = useRef(0);
  const audioCurrentRef = useRef(0);
  const processingFileRef = useRef<string | null>(null); // Track file being processed to prevent duplicates
  const lastPushToTalkTimeRef = useRef(0);
  const isStartingRecording = useRef(false); // Prevent multiple simultaneous start attempts
  const pushToTalkTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pushToTalkStartTimeRef = useRef<number>(0);
  const keyboardMonitorAvailable = useRef(true);
  const processingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const processingStartTimeRef = useRef<number>(0);
  
  // Sound settings state
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [startSound, setStartSound] = useState('Glass');
  const [stopSound, setStopSound] = useState('Glass');
  const [successSound, setSuccessSound] = useState('Pop');
  const [completionSoundThreshold, setCompletionSoundThreshold] = useState(1000);

  // LLM settings state
  const [llmSettings, setLLMSettings] = useState<{
    enabled: boolean;
    model_id: string;
    temperature: number;
    max_tokens: number;
    auto_download_model: boolean;
    enabled_prompts: string[];
  }>({
    enabled: false,
    model_id: 'tinyllama-1.1b',
    temperature: 0.7,
    max_tokens: 200,
    auto_download_model: false,
    enabled_prompts: ['summarize', 'bullet_points', 'action_items', 'fix_grammar']
  });

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
    
    // Load auto-copy and auto-paste settings
    const loadClipboardSettings = async () => {
      try {
        const [copyEnabled, pasteEnabled] = await Promise.all([
          invoke<boolean>('is_auto_copy_enabled'),
          invoke<boolean>('is_auto_paste_enabled')
        ]);
        setAutoCopy(copyEnabled);
        setAutoPaste(pasteEnabled);
        console.log('Clipboard settings loaded - auto-copy:', copyEnabled, 'auto-paste:', pasteEnabled);
      } catch (error) {
        console.error('Failed to load clipboard settings:', error);
      }
    };
    loadClipboardSettings();
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
    
    // Get the current shortcuts from backend (source of truth)
    invoke<string>('get_current_shortcut').then(backendShortcut => {
      setHotkey(backendShortcut);
      localStorage.setItem('scout-hotkey', backendShortcut);
    }).catch(err => {
      console.error('Failed to get current shortcut:', err);
      const savedHotkey = localStorage.getItem('scout-hotkey') || 'CmdOrCtrl+Shift+Space';
      setHotkey(savedHotkey);
    });
    
    invoke<string>('get_push_to_talk_shortcut').then(backendShortcut => {
      setPushToTalkHotkey(backendShortcut);
      localStorage.setItem('scout-push-to-talk-hotkey', backendShortcut);
    }).catch(err => {
      console.error('Failed to get push-to-talk shortcut:', err);
      const savedHotkey = localStorage.getItem('scout-push-to-talk-hotkey') || 'CmdOrCtrl+Shift+P';
      setPushToTalkHotkey(savedHotkey);
    });
    
    // Load overlay type preference
    const savedOverlayType = localStorage.getItem('scout-overlay-type');
    if (savedOverlayType === 'native' || savedOverlayType === 'tauri') {
      setOverlayType(savedOverlayType);
    }
    
    // Load theme preference
    const savedTheme = localStorage.getItem('scout-theme');
    if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system') {
      setTheme(savedTheme);
    }
    
    // Load sound settings
    invoke<boolean>('is_sound_enabled').then(enabled => {
      setSoundEnabled(enabled);
    }).catch(console.error);
    
    invoke<{ startSound: string; stopSound: string; successSound: string }>('get_sound_settings').then(settings => {
      setStartSound(settings.startSound);
      setStopSound(settings.stopSound);
      setSuccessSound(settings.successSound);
    }).catch(console.error);
    
    // Load settings from backend
    invoke<any>('get_settings').then(settings => {
      if (settings?.ui?.completion_sound_threshold_ms) {
        setCompletionSoundThreshold(settings.ui.completion_sound_threshold_ms);
      }
      if (settings?.llm) {
        setLLMSettings({
          enabled: settings.llm.enabled || false,
          model_id: settings.llm.model_id || 'tinyllama-1.1b',
          temperature: settings.llm.temperature || 0.7,
          max_tokens: settings.llm.max_tokens || 200,
          auto_download_model: settings.llm.auto_download_model || false,
          enabled_prompts: settings.llm.enabled_prompts || ['summarize', 'bullet_points', 'action_items', 'fix_grammar']
        });
      }
    }).catch(console.error);
    
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
    
    // Listen for push-to-talk events
    const unsubscribePushToTalk = listen('push-to-talk-pressed', async () => {
      // Debounce to prevent rapid push-to-talk triggers
      const now = Date.now();
      if (now - lastPushToTalkTimeRef.current < 500) { // 500ms debounce for push-to-talk
        console.log('Push-to-talk ignored due to debouncing');
        return;
      }
      lastPushToTalkTimeRef.current = now;
      
      try {
        const recording = await invoke<boolean>("is_recording");
        console.log('Push-to-talk triggered, currently recording:', recording);
        
        if (recording) {
          // If already recording, stop immediately (second press)
          console.log('Stopping push-to-talk recording (manual stop)');
          stopRecording();
        } else {
          // Start recording
          console.log('Starting push-to-talk recording');
          startRecording();
          
          // Track when push-to-talk started
          pushToTalkStartTimeRef.current = Date.now();
          
          // If keyboard monitor is not available, use a fallback timer
          if (!keyboardMonitorAvailable.current) {
            console.log('Using fallback timer for push-to-talk (30 seconds max)');
            
            // Clear any existing timeout
            if (pushToTalkTimeoutRef.current) {
              clearTimeout(pushToTalkTimeoutRef.current);
            }
            
            // Set a maximum recording time of 30 seconds for push-to-talk without key release detection
            pushToTalkTimeoutRef.current = setTimeout(() => {
              console.log('Push-to-talk timeout reached, stopping recording');
              stopRecording();
              pushToTalkTimeoutRef.current = null;
            }, 30000);
          }
        }
      } catch (error) {
        console.error("Failed to handle push-to-talk:", error);
      }
    });
    
    // Listen for push-to-talk release events
    const unsubscribePushToTalkRelease = listen('push-to-talk-released', async () => {
      console.log('🔔 Push-to-talk key released at', new Date().toISOString());
      
      // Clear any fallback timeout
      if (pushToTalkTimeoutRef.current) {
        clearTimeout(pushToTalkTimeoutRef.current);
        pushToTalkTimeoutRef.current = null;
      }
      
      try {
        const recording = await invoke<boolean>("is_recording");
        console.log('🎯 Is recording check:', recording);
        if (recording || isRecordingRef.current) {
          const recordingDuration = Date.now() - pushToTalkStartTimeRef.current;
          console.log(`🛍️ Stopping recording on push-to-talk release (duration: ${recordingDuration}ms)`);
          stopRecording();
        } else {
          console.log('🔍 Not recording, ignoring key release');
        }
      } catch (error) {
        console.error("❌ Failed to handle push-to-talk release:", error);
        // Try to stop anyway if we think we're recording
        if (isRecordingRef.current) {
          console.log('🆘 Attempting emergency stop due to error');
          stopRecording();
        }
      }
    });
    
    // Listen for recording progress updates
    const unsubscribeProgress = listen('recording-progress', (event) => {
      const progress = event.payload as any;
      console.log('Recording progress update:', progress);
      
      // Update UI based on progress
      if (progress.Complete) {
        // Recording complete, transcript available
        console.log('🎯 Clearing processing state from recording-progress Complete');
        if (processingTimeoutRef.current) {
          clearTimeout(processingTimeoutRef.current);
          processingTimeoutRef.current = null;
        }
        setIsProcessing(false);
        loadRecentTranscripts();
      } else if (progress.Failed) {
        // Recording failed
        console.log('❌ Clearing processing state from recording-progress Failed');
        if (processingTimeoutRef.current) {
          clearTimeout(processingTimeoutRef.current);
          processingTimeoutRef.current = null;
        }
        setIsProcessing(false);
        console.error("Recording failed:", progress.Failed);
      } else if (progress.Processing || progress.Transcribing) {
        // Still processing
        setIsProcessing(true);
      } else if (progress.Idle) {
        // Recording has stopped, but processing might continue in background
        console.log('Recording workflow is idle');
        // For Idle state after Stopping, also clear processing  
        console.log('🎯 Clearing processing state from recording-progress Idle');
        if (processingTimeoutRef.current) {
          clearTimeout(processingTimeoutRef.current);
          processingTimeoutRef.current = null;
        }
        setIsProcessing(false);
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
        if (processingTimeoutRef.current) {
          clearTimeout(processingTimeoutRef.current);
          processingTimeoutRef.current = null;
        }
        setIsProcessing(false);
        processingFileRef.current = null; // Clear the processing file reference
        
        // Native overlay state is managed by the backend
      } else if (status.Failed) {
        console.error("Processing failed:", status.Failed);
        if (processingTimeoutRef.current) {
          clearTimeout(processingTimeoutRef.current);
          processingTimeoutRef.current = null;
        }
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

              await invoke<string>('transcribe_file', { 
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
    
    console.log('🔔 Setting up transcript-created listener at', new Date().toISOString());
    
    // Listen for transcript-created events (pub/sub for real-time updates)
    const unsubscribeTranscriptCreated = listen('transcript-created', async (event) => {
      const newTranscript = event.payload as Transcript;
      console.log('📝 Transcript created event received at', new Date().toISOString(), ':', {
        id: newTranscript.id,
        textLength: newTranscript.text?.length || 0,
        duration: newTranscript.duration_ms
      });
      
      // Add the new transcript to the list
      setTranscripts(prev => {
        // Check if transcript already exists (by id)
        const exists = prev.some(t => t.id === newTranscript.id);
        if (exists) return prev;
        
        // Add new transcript at the beginning and keep only recent ones
        return [newTranscript, ...prev].slice(0, 100);
      });
      
      // Clear processing state immediately - transcription is done
      console.log('🎯 Clearing processing state from transcript-created at', new Date().toISOString());
      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current);
        processingTimeoutRef.current = null;
      }
      setIsProcessing(false);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 2000);
      
      // Handle auto-copy if enabled
      if (autoCopy && newTranscript.text) {
        try {
          await navigator.clipboard.writeText(newTranscript.text);
          console.log('Transcript auto-copied to clipboard');
        } catch (error) {
          console.error('Failed to auto-copy transcript:', error);
        }
      }
      
      // Handle auto-paste if enabled
      if (autoPaste && newTranscript.text) {
        try {
          // First copy to clipboard
          await navigator.clipboard.writeText(newTranscript.text);
          // Then paste using Tauri command
          await invoke('paste_text');
          console.log('Transcript auto-pasted');
        } catch (error) {
          console.error('Failed to auto-paste transcript:', error);
        }
      }
      
      // Play success sound if enabled and transcript meets threshold
      const duration = newTranscript.duration_ms || 0;
      if (soundEnabled && duration >= completionSoundThreshold) {
        try {
          await invoke('play_success_sound');
        } catch (error) {
          console.error('Failed to play success sound:', error);
        }
      }
    });
    
    // Listen for performance metrics events (for debugging)
    const unsubscribePerformanceMetrics = listen('performance-metrics-recorded', async (event) => {
      const metrics = event.payload as any;
      console.log('Performance Metrics:', {
        recording_duration: `${metrics.recording_duration_ms}ms`,
        transcription_time: `${metrics.transcription_time_ms}ms`, 
        user_perceived_latency: metrics.user_perceived_latency_ms ? `${metrics.user_perceived_latency_ms}ms` : 'N/A',
        queue_time: `${metrics.processing_queue_time_ms}ms`,
        model: metrics.model_used,
      });
    });
    
    // Listen for keyboard monitor unavailable event
    const unsubscribeKeyboardMonitor = listen('keyboard-monitor-unavailable', async (event) => {
      console.warn('Keyboard monitor unavailable:', event.payload);
      keyboardMonitorAvailable.current = false;
      
      // Optionally show a notification to the user
      // You could add a toast notification here if you have a notification system
    });
    
    // Listen for processing-complete event as a backup to transcript-created
    const unsubscribeProcessingComplete = listen('processing-complete', async (event) => {
      const transcript = event.payload as Transcript;
      console.log('🏁 Processing complete event received at', new Date().toISOString(), 'transcript:', transcript.id);
      
      // Clear processing state immediately
      console.log('🎯 Clearing processing state from processing-complete at', new Date().toISOString());
      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current);
        processingTimeoutRef.current = null;
      }
      setIsProcessing(false);
      setShowSuccess(true);
      
      // Ensure transcript is in the list
      setTranscripts(prev => {
        const exists = prev.some(t => t.id === transcript.id);
        if (exists) return prev;
        return [transcript, ...prev].slice(0, 100);
      });
      
      // Force refresh to ensure UI is updated
      setTimeout(() => {
        loadRecentTranscripts();
      }, 50);
    });
    
    // Listen for recording-completed event as another backup
    const unsubscribeRecordingCompleted = listen('recording-completed', async (_event) => {
      console.log('🏁 Recording-completed event received at', new Date().toISOString());
      
      // Clear processing state immediately
      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current);
        processingTimeoutRef.current = null;
      }
      setIsProcessing(false);
      
      // Force refresh
      setTimeout(() => {
        loadRecentTranscripts();
      }, 50);
    });

    return () => {
      unsubscribe.then(fn => fn());
      unsubscribePushToTalk.then(fn => fn());
      unsubscribePushToTalkRelease.then(fn => fn());
      unsubscribeProgress.then(fn => fn());
      unsubscribeProcessing.then(fn => fn());
      unsubscribeFileUpload.then(fn => fn());
      unsubscribeRecordingState.then(fn => fn());
      unsubscribeNativeStart.then(fn => fn());
      unsubscribeNativeStop.then(fn => fn());
      unsubscribeNativeCancel.then(fn => fn());
      unsubscribeTranscriptCreated.then(fn => fn());
      unsubscribePerformanceMetrics.then(fn => fn());
      unsubscribeKeyboardMonitor.then(fn => fn());
      unsubscribeProcessingComplete.then(fn => fn());
      unsubscribeRecordingCompleted.then(fn => fn());
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
      }, 100) as unknown as number;
    } else {
      setRecordingDuration(0);
    }
    
    return () => {
      clearInterval(interval);
    };
  }, [isRecording]);

  // Load appropriate transcripts based on current view
  useEffect(() => {
    if (currentView === 'transcripts') {
      loadAllTranscripts();
    } else if (currentView === 'record') {
      loadRecentTranscripts();
    }
  }, [currentView]);

  // Smooth audio level monitoring with organic motion
  useEffect(() => {
    if (currentView !== 'record') return;
    
    let interval: number;
    let animationFrame: number;
    let isActive = true;
    
    // Smooth interpolation with organic random motion
    const animate = () => {
      if (!isActive) return;
      
      const target = audioTargetRef.current;
      const current = audioCurrentRef.current;
      const diff = target - current;
      
      // Very fast movement toward target for immediate response
      const speed = 0.3; // Much faster for more direct, immediate feel
      let newLevel = current + (diff * speed);
      
      // Add organic motion when there's audio - more vibrant
      if (target > 0.02) {
        // Layered organic motion for more natural feel
        const flutter = (Math.random() - 0.5) * target * 0.12; // Increased flutter
        const shimmer = Math.sin(Date.now() * 0.007) * target * 0.04; // Fast shimmer
        const pulse = Math.sin(Date.now() * 0.003) * target * 0.06; // Slower pulse
        newLevel += flutter + shimmer + pulse;
      }
      
      // More pronounced breathing when silent - makes it feel alive
      const breathingMotion = Math.sin(Date.now() * 0.0015) * 0.015; // Slightly stronger
      newLevel += breathingMotion;
      
      // Natural capping at 1.0, no artificial bounds
      audioCurrentRef.current = Math.max(0, Math.min(newLevel, 1.0));
      setAudioLevel(audioCurrentRef.current);
      animationFrame = requestAnimationFrame(animate);
    };
    
    const startMonitoring = async () => {
      try {
        // Start monitoring first
        await invoke('start_audio_level_monitoring', { 
          deviceName: selectedMic === 'Default microphone' ? null : selectedMic 
        });
        
        // Start smooth animation
        animate();
        
        // Sample every 150ms for maximum responsiveness - let it rip!
        interval = setInterval(async () => {
          try {
            const level = await invoke<number>('get_current_audio_level');
            
            // More voracious processing like before
            let processed = 0;
            if (level > 0.12) {
              processed = (level - 0.12) * 1.5; // More amplification
            }
            
            // Add bit of raw signal for organic movement
            processed += level * 0.08; // More jitter for liveliness
            
            // Set target - animation will smoothly move toward it
            audioTargetRef.current = Math.min(processed, 1.0);
          } catch (error) {
            console.error('Audio level polling failed:', error);
            audioTargetRef.current = 0;
          }
        }, 150) as unknown as number;
      } catch (error) {
        console.error('Failed to start audio monitoring:', error);
      }
    };
    
    startMonitoring();
    
    return () => {
      isActive = false;
      if (interval) clearInterval(interval);
      if (animationFrame) cancelAnimationFrame(animationFrame);
      invoke('stop_audio_level_monitoring').catch(() => {});
      audioTargetRef.current = 0;
      audioCurrentRef.current = 0;
      setAudioLevel(0);
    };
  }, [currentView, selectedMic]);


  // Periodically sync recording state with backend to ensure consistency
  useEffect(() => {
    const syncInterval = setInterval(async () => {
      try {
        // Skip sync if we're in the middle of processing or starting/stopping
        if (isProcessing || isStartingRecording.current) {
          return;
        }
        
        const backendIsRecording = await invoke<boolean>("is_recording");
        
        // Only sync if there's a real mismatch and we're not in a transitional state
        if (backendIsRecording !== isRecordingRef.current && !isProcessing) {
          console.log(`📊 State sync: backend=${backendIsRecording}, frontend=${isRecordingRef.current}`);
          
          // Only sync from backend to frontend, never restart recording automatically
          if (!backendIsRecording && isRecordingRef.current) {
            // Backend stopped but frontend still thinks it's recording
            setIsRecording(false);
            isRecordingRef.current = false;
            setIsProcessing(false); // Clear any stuck processing state
          } else if (backendIsRecording && !isRecordingRef.current) {
            // Backend is recording but frontend doesn't know - this is OK during transitions
            // Don't automatically sync this case as it could cause loops
            console.log('⚠️ Backend recording but frontend not aware - skipping auto-sync to prevent loops');
          }
        }
      } catch (error) {
        // Silent fail - state sync is not critical
      }
    }, 2000); // Check every 2 seconds to reduce overhead
    
    return () => clearInterval(syncInterval);
  }, [isProcessing]); // Add isProcessing dependency

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

  const startRecording = async () => {
    // Prevent starting if already recording or in the process of starting
    if (isRecordingRef.current || isStartingRecording.current) {
      console.log('Start recording blocked - already recording or starting');
      return;
    }
    
    isStartingRecording.current = true;
    
    // IMMEDIATELY update UI for instant feedback - using flushSync to force synchronous update
    flushSync(() => {
      setIsRecording(true);
      setCurrentTranscript("");
    });
    
    isRecordingRef.current = true;
    (window as any).__recordingStartTime = Date.now();
    
    // Start the backend recording asynchronously
    try {
      const filename = await invoke<string>("start_recording", { 
        deviceName: selectedMic === 'Default microphone' ? null : selectedMic 
      });
      setCurrentRecordingFile(filename);
      isStartingRecording.current = false; // Reset flag on success
      
      // Native overlay state is managed by the backend
      if (overlayType === 'native') {
        
      }
    } catch (error) {
      console.error("Failed to start recording:", error);
      // Revert UI state on error
      flushSync(() => {
        setIsRecording(false);
      });
      isRecordingRef.current = false;
      isStartingRecording.current = false; // Reset flag on error
    }
  };

  const stopRecording = async () => {
    // Prevent stopping if not recording
    if (!isRecordingRef.current) {
      return;
    }
    
    // Clear any push-to-talk timeout
    if (pushToTalkTimeoutRef.current) {
      clearTimeout(pushToTalkTimeoutRef.current);
      pushToTalkTimeoutRef.current = null;
    }
    
    // Clear the starting flag to prevent any race conditions
    isStartingRecording.current = false;
    
    // IMMEDIATELY update UI for instant feedback - using flushSync for synchronous update
    flushSync(() => {
      setIsRecording(false);
    });
    isRecordingRef.current = false;
    
    // Set processing state immediately
    setIsProcessing(true);
    processingStartTimeRef.current = Date.now();
    console.log("🎬 Set processing state to true at", new Date().toISOString());
    
    // Add a timeout to prevent getting stuck in processing state
    processingTimeoutRef.current = setTimeout(() => {
      console.warn("⚠️ Processing timeout - clearing processing state after 10 seconds");
      setIsProcessing(false);
      processingTimeoutRef.current = null;
    }, 10000); // 10 second timeout
    
    // Stop the backend recording and wait for result
    try {
      console.log("🛑 Calling stop_recording...");
      const result = await invoke("stop_recording");
      console.log("✅ Recording stopped, result:", result);
      console.log("📊 Result type:", typeof result);
      console.log("📊 Result keys:", result ? Object.keys(result) : 'null');
      
      // If we got a transcript immediately (ring buffer strategy), handle it
      if (result && (result as any).transcript) {
        console.log("📝 Got immediate transcript from ring buffer:", {
          transcript: (result as any).transcript?.substring(0, 100) + '...',
          transcriptLength: (result as any).transcript?.length,
          filename: (result as any).filename,
          duration_ms: (result as any).duration_ms
        });
        // Clear the processing state immediately since transcription is done
        if (processingTimeoutRef.current) {
          clearTimeout(processingTimeoutRef.current);
          processingTimeoutRef.current = null;
        }
        setIsProcessing(false);
        setShowSuccess(true);
        
        // Force refresh transcripts in case event was missed
        setTimeout(() => {
          console.log('🔄 Force refreshing transcripts after immediate result');
          loadRecentTranscripts();
        }, 100);
        // Clear processing state immediately - transcription is done
        console.log("🎯 Clearing processing state immediately at", new Date().toISOString());
        setIsProcessing(false);
        setShowSuccess(true);
        // The transcript-created event will update the transcript list
      } else {
        console.log("⏳ No immediate transcript, waiting for processing events...");
        // We'll stay in processing state until we get a transcript-created or processing-status event
        // The timeout will clear the state if we don't get an event within 10 seconds
      }
    } catch (error) {
      console.error("❌ Failed to stop recording:", error);
      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current);
        processingTimeoutRef.current = null;
      }
      setIsProcessing(false); // Reset processing state on error
    }
  };

  const cancelRecording = async () => {
    // Prevent canceling if not recording
    if (!isRecordingRef.current) {
      return;
    }
    
    
    // IMMEDIATELY update UI for instant feedback
    flushSync(() => {
      setIsRecording(false);
    });
    isRecordingRef.current = false;
    
    // Cancel the backend recording without processing
    invoke("cancel_recording").catch(error => {
      console.error("Failed to cancel recording:", error);
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
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
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

  const toggleAutoCopy = async () => {
    try {
      const newState = !autoCopy;
      await invoke("set_auto_copy", { enabled: newState });
      setAutoCopy(newState);
    } catch (error) {
      console.error("Failed to toggle auto-copy:", error);
    }
  };

  const toggleAutoPaste = async () => {
    try {
      const newState = !autoPaste;
      await invoke("set_auto_paste", { enabled: newState });
      setAutoPaste(newState);
    } catch (error) {
      console.error("Failed to toggle auto-paste:", error);
    }
  };

  
  const updateTheme = (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme);
    localStorage.setItem('scout-theme', newTheme);
  };

  const toggleSoundEnabled = async () => {
    try {
      const newState = !soundEnabled;
      await invoke("set_sound_enabled", { enabled: newState });
      setSoundEnabled(newState);
    } catch (error) {
      console.error("Failed to toggle sound:", error);
    }
  };

  const updateStartSound = async (sound: string) => {
    try {
      await invoke("set_start_sound", { sound });
      setStartSound(sound);
    } catch (error) {
      console.error("Failed to update start sound:", error);
    }
  };

  const updateStopSound = async (sound: string) => {
    try {
      await invoke("set_stop_sound", { sound });
      setStopSound(sound);
    } catch (error) {
      console.error("Failed to update stop sound:", error);
    }
  };

  const updateSuccessSound = async (sound: string) => {
    try {
      await invoke("set_success_sound", { sound });
      setSuccessSound(sound);
    } catch (error) {
      console.error("Failed to update success sound:", error);
    }
  };

  const updateCompletionSoundThreshold = async (threshold: number) => {
    try {
      // Update the settings with the new threshold
      await invoke("update_settings", { 
        settings: { 
          ui: { 
            completion_sound_threshold_ms: threshold 
          } 
        } 
      });
      setCompletionSoundThreshold(threshold);
    } catch (error) {
      console.error("Failed to update completion sound threshold:", error);
    }
  };

  const updateLLMSettings = async (updates: Partial<LLMSettingsType>) => {
    try {
      const newSettings = { ...llmSettings, ...updates };
      
      // Update backend with all LLM settings
      await invoke('update_llm_settings', {
        enabled: newSettings.enabled,
        modelId: newSettings.model_id,
        temperature: newSettings.temperature,
        maxTokens: newSettings.max_tokens,
        enabledPrompts: newSettings.enabled_prompts
      });
      
      // Update state
      setLLMSettings(newSettings);
    } catch (error) {
      console.error("Failed to update LLM settings:", error);
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
            recordingDuration={recordingDuration}
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
    </div>
  );
}

export default App;

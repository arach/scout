import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { invokeTyped, tauriApi } from '../types/tauri';
import { loggers } from '../utils/logger';
import { safeEventListen, cleanupListeners } from "../lib/safeEventListener";
import { open } from "@tauri-apps/plugin-dialog";
import { OnboardingFlow } from "./OnboardingFlow";
import { Sidebar, useSidebarState } from "./Sidebar";
import { RecordView } from "./RecordView";
import { TranscriptsView } from "./TranscriptsView";
import { SettingsView } from "./SettingsView";
import { AudioErrorBoundary, TranscriptionErrorBoundary, SettingsErrorBoundary } from './ErrorBoundary';
import { ChevronRight, PanelLeftClose } from 'lucide-react';
import { useRecording } from '../hooks/useRecording';
import { useSettings } from '../hooks/useSettings';
import { useFileDrop } from '../hooks/useFileDrop';
import { useTranscriptEvents } from '../hooks/useTranscriptEvents';
import { useProcessingStatus } from '../hooks/useProcessingStatus';
import { useNativeOverlay } from '../hooks/useNativeOverlay';
import { DevTools } from './DevTools';
import { TranscriptionOverlay } from './TranscriptionOverlay';
import { useAudioContext } from '../contexts/AudioContext';
import { useTranscriptContext } from '../contexts/TranscriptContext';
import { useUIContext } from '../contexts/UIContext';

/**
 * Main application content component (extracted from App.tsx)
 * Maintains 100% feature parity while using new context architecture
 */
export function AppContent() {
  const { isExpanded: isSidebarExpanded, toggleExpanded: toggleSidebar } = useSidebarState();
  
  // Context state
  const { selectedMic, setSelectedMic } = useAudioContext();
  const { 
    transcripts, 
    searchQuery, 
    selectedTranscripts, 
    isProcessing, 
    sessionStartTime,
    setTranscripts, 
    setSearchQuery, 
    setSelectedTranscripts, 
    setIsProcessing 
  } = useTranscriptContext();
  const { 
    currentView, 
    showTranscriptionOverlay, 
    showFirstRun, 
    isCapturingHotkey, 
    isCapturingPushToTalkHotkey, 
    deleteConfirmation, 
    hotkeyUpdateStatus, 
    uploadProgress,
    setCurrentView, 
    setShowTranscriptionOverlay, 
    setShowFirstRun, 
    setIsCapturingHotkey, 
    setIsCapturingPushToTalkHotkey, 
    setDeleteConfirmation, 
    setUploadProgress 
  } = useUIContext();

  // Local refs
  const processingFileRef = useRef<string | null>(null);

  // Settings hook
  const {
    overlayPosition,
    overlayTreatment,
    hotkey,
    pushToTalkHotkey,
    theme,
    selectedTheme,
    soundEnabled,
    startSound,
    stopSound,
    successSound,
    completionSoundThreshold,
    llmSettings,
    autoCopy,
    autoPaste,
    updateOverlayPosition,
    updateOverlayTreatment,
    updateTheme,
    updateSelectedTheme,
    toggleSoundEnabled,
    updateStartSound,
    updateStopSound,
    updateSuccessSound,
    updateCompletionSoundThreshold,
    updateLLMSettings,
    toggleAutoCopy,
    toggleAutoPaste,
  } = useSettings();

  // Load transcripts functions
  const loadRecentTranscripts = useCallback(async () => {
    try {
      const recent = await tauriApi.getRecentTranscripts({ limit: 10 });
      setTranscripts(recent);
    } catch (error) {
      console.error("Failed to load transcripts:", error);
    }
  }, [setTranscripts]);

  const loadAllTranscripts = useCallback(async () => {
    try {
      const all = await tauriApi.getRecentTranscripts({ limit: 1000 });
      setTranscripts(all);
    } catch (error) {
      console.error("Failed to load all transcripts:", error);
    }
  }, [setTranscripts]);

  // Memoized callback functions
  const onTranscriptCreatedCallback = useCallback(() => {
    if (currentView === 'record') {
      loadRecentTranscripts();
    }
  }, [currentView, loadRecentTranscripts]);

  const onRecordingCompleteCallback = useCallback(() => {
    // Ring buffer transcribes in real-time, so transcription is already done
  }, []);

  const onProcessingCompleteCallback = useCallback(() => {
    setTimeout(() => {
      loadRecentTranscripts();
    }, 50);
  }, [loadRecentTranscripts]);

  const onRecordingCompletedCallback = useCallback(() => {
    setTimeout(() => {
      loadRecentTranscripts();
    }, 50);
  }, [loadRecentTranscripts]);

  // Track if we're on the final onboarding step to enable shortcuts
  const [isOnboardingTourStep, setIsOnboardingTourStep] = useState(false);

  const onRecordingStartCallback = useCallback(() => {
    // If recording starts during onboarding tour step, complete onboarding
    if (showFirstRun && isOnboardingTourStep) {
      localStorage.setItem('scout-onboarding-complete', 'true');
      setShowFirstRun(false);
      setCurrentView('record');
    }
  }, [showFirstRun, isOnboardingTourStep]);

  // Recording hook
  const { 
    isRecording, 
    recordingStartTime, 
    toggleRecording,
    startRecording,
    stopRecording,
    cancelRecording 
  } = useRecording({
    onTranscriptCreated: showFirstRun ? undefined : onTranscriptCreatedCallback,
    onRecordingComplete: showFirstRun ? undefined : onRecordingCompleteCallback,
    onRecordingStart: onRecordingStartCallback, // Always pass the callback to handle onboarding
    soundEnabled,
    selectedMic,
    pushToTalkShortcut: (showFirstRun && !isOnboardingTourStep) ? '' : pushToTalkHotkey, // Enable shortcuts only on tour step
    isRecordViewActive: !showFirstRun && currentView === 'record'
  });

  // File drop hook
  const { isDragging } = useFileDrop({
    isProcessing,
    onFileDropped: useCallback(async (filePath: string) => {
      try {
        setIsProcessing(true);
        const filename = filePath.split('/').pop() || 'audio file';
        setUploadProgress({
          filename: filename,
          status: 'uploading',
          progress: 0
        });

        await invokeTyped<string>('transcribe_file', { 
          filePath: filePath 
        });
      } catch (error) {
        console.error('Failed to process dropped file:', error);
        alert(`Failed to process file: ${error}`);
        setIsProcessing(false);
        processingFileRef.current = null;
      }
    }, [setIsProcessing, setUploadProgress])
  });

  // Hooks (only when not showing onboarding)
  useTranscriptEvents({
    soundEnabled,
    completionSoundThreshold,
    setIsProcessing: showFirstRun ? undefined : setIsProcessing,
    setTranscripts: showFirstRun ? undefined : setTranscripts,
    onTranscriptCreated: showFirstRun ? undefined : onTranscriptCreatedCallback,
    onProcessingComplete: showFirstRun ? undefined : onProcessingCompleteCallback,
    onRecordingCompleted: showFirstRun ? undefined : onRecordingCompletedCallback
  });

  useProcessingStatus({
    setUploadProgress: showFirstRun ? () => {} : (progress) => {
      if (typeof progress === 'function') {
        setUploadProgress(prev => progress(prev));
      } else {
        setUploadProgress(progress);
      }
    },
    setIsProcessing: showFirstRun ? () => {} : setIsProcessing,
    onProcessingComplete: showFirstRun ? undefined : onProcessingCompleteCallback
  });

  useNativeOverlay({
    startRecording: showFirstRun ? async () => {} : startRecording,
    stopRecording: showFirstRun ? async () => {} : stopRecording,
    cancelRecording: showFirstRun ? async () => {} : cancelRecording
  });

  // Computed values with memoization
  const sessionTranscripts = useMemo(() => 
    transcripts
      .filter(t => new Date(t.created_at) >= new Date(sessionStartTime))
      .slice(-10),
    [transcripts, sessionStartTime]
  );

  // Utility functions
  const formatDuration = useCallback((ms: number): string => {
    if (ms < 1000) return '< 1s';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}:${(minutes % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
    } else if (minutes > 0) {
      return `${minutes}:${(seconds % 60).toString().padStart(2, '0')}`;
    } else {
      return `${seconds}s`;
    }
  }, []);

  const formatRecordingTimer = useCallback((ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }, []);

  const formatFileSize = useCallback((bytes?: number): string => {
    if (!bytes) return 'Unknown';
    const kb = bytes / 1024;
    const mb = kb / 1024;
    if (mb >= 1) {
      return `${mb.toFixed(1)} MB`;
    } else {
      return `${kb.toFixed(1)} KB`;
    }
  }, []);

  // Event handlers
  const handleFileUpload = useCallback(async () => {
    try {
      const result = await open({
        multiple: false,
        filters: [{
          name: 'Audio',
          extensions: ['wav', 'mp3', 'flac', 'm4a', 'ogg', 'webm']
        }]
      });
      if (result) {
        try {
          setIsProcessing(true);
          const filename = result.split('/').pop() || 'audio file';
          setUploadProgress({
            filename: filename,
            status: 'uploading',
            progress: 0
          });
          
          await invokeTyped<string>('transcribe_file', { 
            filePath: result 
          });
        } catch (error) {
          console.error('Failed to process selected file:', error);
          alert(`Failed to process file: ${error}`);
          setIsProcessing(false);
          processingFileRef.current = null;
        }
      }
    } catch (error) {
      console.error('Failed to open file dialog:', error);
    }
  }, [setIsProcessing, setUploadProgress]);

  const showDeleteConfirmation = useCallback((id: number, text: string) => {
    setDeleteConfirmation({
      show: true,
      transcriptId: id,
      transcriptText: text,
      isBulk: false
    });
  }, [setDeleteConfirmation]);

  const showBulkDeleteConfirmation = useCallback(() => {
    setDeleteConfirmation({
      show: true,
      transcriptId: null,
      transcriptText: `${selectedTranscripts.size} transcript${selectedTranscripts.size > 1 ? 's' : ''}`,
      isBulk: true
    });
  }, [selectedTranscripts.size, setDeleteConfirmation]);

  const handleDeleteTranscript = useCallback(async (id: number) => {
    try {
      await tauriApi.deleteTranscript({ id });
      setTranscripts(prev => prev.filter(t => t.id !== id));
      setSelectedTranscripts((prev: Set<number>) => {
        const newSet = new Set(prev);
        newSet.delete(id);
        return newSet;
      });
    } catch (error) {
      console.error('Failed to delete transcript:', error);
    }
  }, [setTranscripts, setSelectedTranscripts]);

  const handleBulkDelete = useCallback(async () => {
    for (const id of selectedTranscripts) {
      await handleDeleteTranscript(id);
    }
    setSelectedTranscripts(new Set());
  }, [selectedTranscripts, handleDeleteTranscript, setSelectedTranscripts]);

  const confirmDelete = useCallback(async () => {
    if (deleteConfirmation.isBulk) {
      await handleBulkDelete();
    } else if (deleteConfirmation.transcriptId) {
      await handleDeleteTranscript(deleteConfirmation.transcriptId);
    }
    setDeleteConfirmation({ show: false, transcriptId: null, transcriptText: "", isBulk: false });
  }, [deleteConfirmation, handleBulkDelete, handleDeleteTranscript, setDeleteConfirmation]);

  // Transcript management functions
  const searchTranscripts = useCallback(async () => {
    if (!searchQuery.trim()) {
      loadAllTranscripts();
      return;
    }
    try {
      const results = await tauriApi.searchTranscripts({ query: searchQuery });
      setTranscripts(results);
    } catch (error) {
      console.error('Failed to search transcripts:', error);
    }
  }, [searchQuery, loadAllTranscripts, setTranscripts]);

  const toggleTranscriptSelection = useCallback((id: number) => {
    setSelectedTranscripts((prev: Set<number>) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }, [setSelectedTranscripts]);

  const toggleTranscriptGroupSelection = useCallback((ids: number[]) => {
    setSelectedTranscripts((prev: Set<number>) => {
      const newSet = new Set(prev);
      const allSelected = ids.every(id => newSet.has(id));
      if (allSelected) {
        ids.forEach(id => newSet.delete(id));
      } else {
        ids.forEach(id => newSet.add(id));
      }
      return newSet;
    });
  }, [setSelectedTranscripts]);

  const selectAllTranscripts = useCallback(() => {
    setSelectedTranscripts(new Set(transcripts.map(t => t.id)));
  }, [transcripts, setSelectedTranscripts]);

  const exportTranscripts = useCallback(async (format: 'json' | 'markdown' | 'text') => {
    try {
      await tauriApi.exportTranscripts({ format, transcriptIds: Array.from(selectedTranscripts) });
    } catch (error) {
      console.error('Failed to export transcripts:', error);
    }
  }, [selectedTranscripts]);

  const copyTranscript = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error('Failed to copy transcript:', error);
    }
  }, []);

  // Effects
  useEffect(() => {
    const checkOnboarding = async () => {
      try {
        const onboardingComplete = localStorage.getItem('scout-onboarding-complete');
        if (!onboardingComplete) {
          setShowFirstRun(true);
        }
      } catch (error) {
        console.error('Failed to check onboarding:', error);
      }
    };
    checkOnboarding();
    
    const checkAudioDevices = async () => {
      try {
        const devices = await tauriApi.getAudioDevices();
        loggers.audio.debug('Audio devices available', { count: devices.length, devices });
      } catch (error) {
        console.error('🔊 Failed to get audio devices:', error);
      }
    };
    checkAudioDevices();
  }, [setShowFirstRun]);

  useEffect(() => {
    if (showFirstRun) return;
    
    let mounted = true;
    const cleanupFunctions: Array<() => void> = [];
    
    const init = async () => {
      if (!mounted) return;
      
      if (currentView === 'transcripts') {
        loadAllTranscripts();
      } else if (currentView === 'record') {
        loadRecentTranscripts();
      }
      
      tauriApi.getCurrentModel().catch(console.error);
      tauriApi.subscribeToProgress().catch(console.error);
    };
    
    init();
    
    // Global hotkey listener
    safeEventListen('toggle-recording', async () => {
      if (!mounted || showFirstRun) return;
      await toggleRecording();
    }).then(cleanup => {
      if (cleanup) cleanupFunctions.push(cleanup);
    }).catch(console.error);

    // File dialog listener
    safeEventListen('open-file-dialog', async () => {
      if (!mounted || showFirstRun) return;
      await handleFileUpload();
    }).then(cleanup => {
      if (cleanup) cleanupFunctions.push(cleanup);
    }).catch(console.error);
    
    return () => {
      mounted = false;
      cleanupListeners(cleanupFunctions);
    };
  }, [showFirstRun, currentView, loadAllTranscripts, loadRecentTranscripts, toggleRecording, handleFileUpload]);

  // Show onboarding if needed
  if (showFirstRun) {
    return (
      <div className="app-container">
        <OnboardingFlow
          onComplete={() => {
            localStorage.setItem('scout-onboarding-complete', 'true');
            setShowFirstRun(false);
          }}
          onStepChange={(step) => {
            setIsOnboardingTourStep(step === 'tour');
          }}
        />
      </div>
    );
  }

  return (
    <div className="app-container">
      <Sidebar
        currentView={currentView}
        onViewChange={setCurrentView}
        isExpanded={isSidebarExpanded}
      />
      
      <main className={`app-main ${!isSidebarExpanded ? 'sidebar-collapsed' : ''}`}>
        <div className="view-header">
          <div className="view-header-left">
            {!isSidebarExpanded && (
              <button
                className="sidebar-toggle-button"
                onClick={toggleSidebar}
                title="Show Sidebar"
              >
                <ChevronRight size={16} />
              </button>
            )}
          </div>
          <div className="view-header-right">
            {isSidebarExpanded && (
              <button
                className="sidebar-close-button"
                onClick={toggleSidebar}
                title="Hide Sidebar"
              >
                <PanelLeftClose size={16} />
              </button>
            )}
          </div>
        </div>

        {currentView === 'record' && (
          <AudioErrorBoundary>
            <RecordView
              isRecording={isRecording}
              isProcessing={isProcessing}
              recordingStartTime={recordingStartTime}
              hotkey={hotkey}
              pushToTalkHotkey={pushToTalkHotkey}
              uploadProgress={uploadProgress}
              sessionTranscripts={sessionTranscripts}
              selectedMic={selectedMic}
              onMicChange={setSelectedMic}
              startRecording={startRecording}
              stopRecording={stopRecording}
              cancelRecording={cancelRecording}
              handleFileUpload={handleFileUpload}
              formatDuration={formatDuration}
              formatRecordingTimer={formatRecordingTimer}
              showDeleteConfirmation={showDeleteConfirmation}
            />
          </AudioErrorBoundary>
        )}
        {currentView === 'transcripts' && (
          <TranscriptionErrorBoundary>
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
          </TranscriptionErrorBoundary>
        )}
        {currentView === 'settings' && (
          <SettingsErrorBoundary>
            <SettingsView
              hotkey={hotkey}
              isCapturingHotkey={isCapturingHotkey}
              hotkeyUpdateStatus={hotkeyUpdateStatus}
              pushToTalkHotkey={pushToTalkHotkey}
              isCapturingPushToTalkHotkey={isCapturingPushToTalkHotkey}
              overlayPosition={overlayPosition}
              overlayTreatment={overlayTreatment}
              autoCopy={autoCopy}
              autoPaste={autoPaste}
              theme={theme}
              selectedTheme={selectedTheme}
              soundEnabled={soundEnabled}
              startSound={startSound}
              stopSound={stopSound}
              successSound={successSound}
              completionSoundThreshold={completionSoundThreshold}
              llmSettings={llmSettings}
              stopCapturingHotkey={() => setIsCapturingHotkey(false)}
              startCapturingHotkey={() => setIsCapturingHotkey(true)}
              startCapturingPushToTalkHotkey={() => setIsCapturingPushToTalkHotkey(true)}
              stopCapturingPushToTalkHotkey={() => setIsCapturingPushToTalkHotkey(false)}
              updateOverlayPosition={updateOverlayPosition}
              updateOverlayTreatment={updateOverlayTreatment}
              toggleAutoCopy={toggleAutoCopy}
              toggleAutoPaste={toggleAutoPaste}
              updateTheme={updateTheme}
              updateSelectedTheme={updateSelectedTheme}
              toggleSoundEnabled={toggleSoundEnabled}
              updateStartSound={updateStartSound}
              updateStopSound={updateStopSound}
              updateSuccessSound={updateSuccessSound}
              updateCompletionSoundThreshold={updateCompletionSoundThreshold}
              updateLLMSettings={updateLLMSettings}
            />
          </SettingsErrorBoundary>
        )}

        {/* File drop overlay */}
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

        {/* Delete confirmation modal */}
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

      {/* Dev Tools */}
      <DevTools
        currentView={currentView}
        selectedMic={selectedMic}
        isRecording={isRecording}
        isProcessing={isProcessing}
        transcripts={transcripts}
        searchQuery={searchQuery}
        selectedTranscripts={selectedTranscripts}
        hotkey={hotkey}
        pushToTalkHotkey={pushToTalkHotkey}
        appVersion="0.1.0"
        showTranscriptionOverlay={showTranscriptionOverlay}
        onToggleTranscriptionOverlay={setShowTranscriptionOverlay}
      />

      {/* Transcription Overlay */}
      {showTranscriptionOverlay && (
        <TranscriptionOverlay
          isVisible={showTranscriptionOverlay}
          isRecording={isRecording}
          onClose={() => setShowTranscriptionOverlay(false)}
          onSaveEdits={(editedText) => {
            loggers.ui.info('Saved edited transcript', { length: editedText.length });
          }}
          onDiscardEdits={() => {
            loggers.ui.debug('Discarded transcript edits');
          }}
        />
      )}
    </div>
  );
}
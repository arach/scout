import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';

type View = 'record' | 'transcripts' | 'settings' | 'settings-v2' | 'stats' | 'dictionary' | 'webhooks';

interface DeleteConfirmation {
  show: boolean;
  transcriptId: number | null;
  transcriptText: string;
  isBulk: boolean;
}

interface UploadProgress {
  filename?: string;
  fileSize?: number;
  status: 'idle' | 'uploading' | 'queued' | 'processing' | 'converting' | 'transcribing';
  queuePosition?: number;
  progress?: number;
}

interface UIContextState {
  currentView: View;
  showTranscriptionOverlay: boolean;
  showFirstRun: boolean;
  isCapturingHotkey: boolean;
  isCapturingPushToTalkHotkey: boolean;
  capturedKeys: string[];
  deleteConfirmation: DeleteConfirmation;
  hotkeyUpdateStatus: 'idle' | 'success' | 'error';
  uploadProgress: UploadProgress;
  selectedTranscriptId: number | null;
}

interface UIContextActions {
  setCurrentView: (view: View) => void;
  setShowTranscriptionOverlay: (show: boolean) => void;
  setShowFirstRun: (show: boolean) => void;
  setIsCapturingHotkey: (capturing: boolean) => void;
  setIsCapturingPushToTalkHotkey: (capturing: boolean) => void;
  setCapturedKeys: (keys: string[]) => void;
  setDeleteConfirmation: (confirmation: DeleteConfirmation) => void;
  setHotkeyUpdateStatus: (status: 'idle' | 'success' | 'error') => void;
  setUploadProgress: (progress: UploadProgress | ((prev: UploadProgress) => UploadProgress)) => void;
  showDeleteDialog: (transcriptId: number, transcriptText: string, isBulk?: boolean) => void;
  hideDeleteDialog: () => void;
  setSelectedTranscriptId: (id: number | null) => void;
  navigateToTranscript: (transcriptId: number) => void;
}

interface UIContextValue extends UIContextState, UIContextActions {}

const UIContext = createContext<UIContextValue | undefined>(undefined);

interface UIProviderProps {
  children: ReactNode;
}

export function UIProvider({ children }: UIProviderProps) {
  // Initialize with default view first, then load from localStorage asynchronously
  const [currentView, setCurrentView] = useState<View>('record');
  const [showTranscriptionOverlay, setShowTranscriptionOverlay] = useState(false);
  const [showFirstRun, setShowFirstRun] = useState(false);
  const [isCapturingHotkey, setIsCapturingHotkey] = useState(false);
  const [isCapturingPushToTalkHotkey, setIsCapturingPushToTalkHotkey] = useState(false);
  const [capturedKeys, setCapturedKeys] = useState<string[]>([]);
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmation>({
    show: false,
    transcriptId: null,
    transcriptText: "",
    isBulk: false
  });
  const [hotkeyUpdateStatus, setHotkeyUpdateStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>({ status: 'idle' });
  const [selectedTranscriptId, setSelectedTranscriptId] = useState<number | null>(null);

  // Load saved view from localStorage asynchronously after initial render
  useEffect(() => {
    // Use requestIdleCallback if available, otherwise setTimeout
    const loadSavedView = () => {
      try {
        const savedView = localStorage.getItem('scout-current-view');
        if (savedView && ['record', 'transcripts', 'settings', 'stats', 'dictionary', 'webhooks'].includes(savedView)) {
          setCurrentView(savedView as View);
        }
      } catch (error) {
        console.warn('Failed to load saved view from localStorage:', error);
      }
    };

    if ('requestIdleCallback' in window) {
      requestIdleCallback(loadSavedView);
    } else {
      setTimeout(loadSavedView, 0);
    }
  }, []);

  const handleSetCurrentView = useCallback((view: View) => {
    setCurrentView(view);
    localStorage.setItem('scout-current-view', view);
  }, []);

  const handleSetShowTranscriptionOverlay = useCallback((show: boolean) => {
    setShowTranscriptionOverlay(show);
  }, []);

  const handleSetShowFirstRun = useCallback((show: boolean) => {
    setShowFirstRun(show);
  }, []);

  const handleSetIsCapturingHotkey = useCallback((capturing: boolean) => {
    setIsCapturingHotkey(capturing);
  }, []);

  const handleSetIsCapturingPushToTalkHotkey = useCallback((capturing: boolean) => {
    setIsCapturingPushToTalkHotkey(capturing);
  }, []);

  const handleSetCapturedKeys = useCallback((keys: string[]) => {
    setCapturedKeys(keys);
  }, []);

  const handleSetDeleteConfirmation = useCallback((confirmation: DeleteConfirmation) => {
    setDeleteConfirmation(confirmation);
  }, []);

  const handleSetHotkeyUpdateStatus = useCallback((status: 'idle' | 'success' | 'error') => {
    setHotkeyUpdateStatus(status);
  }, []);

  const handleSetUploadProgress = useCallback((progress: UploadProgress | ((prev: UploadProgress) => UploadProgress)) => {
    if (typeof progress === 'function') {
      setUploadProgress(progress);
    } else {
      setUploadProgress(progress);
    }
  }, []);

  const showDeleteDialog = useCallback((transcriptId: number, transcriptText: string, isBulk: boolean = false) => {
    setDeleteConfirmation({
      show: true,
      transcriptId,
      transcriptText,
      isBulk
    });
  }, []);

  const hideDeleteDialog = useCallback(() => {
    setDeleteConfirmation({
      show: false,
      transcriptId: null,
      transcriptText: "",
      isBulk: false
    });
  }, []);

  const handleSetSelectedTranscriptId = useCallback((id: number | null) => {
    setSelectedTranscriptId(id);
  }, []);

  const navigateToTranscript = useCallback((transcriptId: number) => {
    setSelectedTranscriptId(transcriptId);
    setCurrentView('transcripts');
    localStorage.setItem('scout-current-view', 'transcripts');
  }, []);

  const value: UIContextValue = {
    // State
    currentView,
    showTranscriptionOverlay,
    showFirstRun,
    isCapturingHotkey,
    isCapturingPushToTalkHotkey,
    capturedKeys,
    deleteConfirmation,
    hotkeyUpdateStatus,
    uploadProgress,
    selectedTranscriptId,
    // Actions
    setCurrentView: handleSetCurrentView,
    setShowTranscriptionOverlay: handleSetShowTranscriptionOverlay,
    setShowFirstRun: handleSetShowFirstRun,
    setIsCapturingHotkey: handleSetIsCapturingHotkey,
    setIsCapturingPushToTalkHotkey: handleSetIsCapturingPushToTalkHotkey,
    setCapturedKeys: handleSetCapturedKeys,
    setDeleteConfirmation: handleSetDeleteConfirmation,
    setHotkeyUpdateStatus: handleSetHotkeyUpdateStatus,
    setUploadProgress: handleSetUploadProgress,
    showDeleteDialog,
    hideDeleteDialog,
    setSelectedTranscriptId: handleSetSelectedTranscriptId,
    navigateToTranscript,
  };

  return (
    <UIContext.Provider value={value}>
      {children}
    </UIContext.Provider>
  );
}

// Add display name for better debugging
UIProvider.displayName = 'UIProvider';

// Export the hook with a stable function reference for Fast Refresh
export const useUIContext = (): UIContextValue => {
  const context = useContext(UIContext);
  if (context === undefined) {
    throw new Error('useUIContext must be used within a UIProvider');
  }
  return context;
};

export type { View, DeleteConfirmation, UploadProgress };
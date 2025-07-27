import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

type View = 'record' | 'transcripts' | 'settings' | 'stats';

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
}

interface UIContextValue extends UIContextState, UIContextActions {}

const UIContext = createContext<UIContextValue | undefined>(undefined);

interface UIProviderProps {
  children: ReactNode;
}

export function UIProvider({ children }: UIProviderProps) {
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

  const handleSetCurrentView = useCallback((view: View) => {
    setCurrentView(view);
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
  };

  return (
    <UIContext.Provider value={value}>
      {children}
    </UIContext.Provider>
  );
}

export function useUIContext(): UIContextValue {
  const context = useContext(UIContext);
  if (context === undefined) {
    throw new Error('useUIContext must be used within a UIProvider');
  }
  return context;
}

export type { View, DeleteConfirmation, UploadProgress };
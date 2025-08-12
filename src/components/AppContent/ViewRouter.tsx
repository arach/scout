import { memo, lazy, Suspense } from 'react';
import { AudioErrorBoundary, TranscriptionErrorBoundary, SettingsErrorBoundary } from '../ErrorBoundary';
import { RecordView } from '../RecordView';

// Lazy load heavy components that aren't needed immediately
const TranscriptsView = lazy(() => import('../TranscriptsView').then(m => ({ default: m.TranscriptsView })));
const SettingsView = lazy(() => import('../SettingsViewV2').then(m => ({ default: m.SettingsViewV2 })));
const StatsView = lazy(() => import('../StatsView').then(m => ({ default: m.StatsView })));
const Dictionary = lazy(() => import('../Dictionary'));
import type { ViewType } from './types';

interface ViewRouterProps {
  currentView: ViewType;
  // RecordView props
  isRecording: boolean;
  isProcessing: boolean;
  recordingStartTime: number | null;
  hotkey: string;
  pushToTalkHotkey: string;
  uploadProgress: any;
  sessionTranscripts: any[];
  selectedMic: string;
  onMicChange: (mic: string) => void;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  cancelRecording: () => Promise<void>;
  handleFileUpload: () => Promise<void>;
  formatDuration: (ms: number) => string;
  formatRecordingTimer: (ms: number) => string;
  showDeleteConfirmation: (id: number, text: string) => void;
  navigateToTranscript: (transcriptId: number) => void;
  // TranscriptsView props
  transcripts: any[];
  selectedTranscripts: Set<number>;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  searchTranscripts: () => Promise<void>;
  toggleTranscriptSelection: (id: number) => void;
  toggleTranscriptGroupSelection: (ids: number[]) => void;
  selectAllTranscripts: () => void;
  showBulkDeleteConfirmation: () => void;
  exportTranscripts: (format: 'json' | 'markdown' | 'text') => Promise<void>;
  copyTranscript: (text: string) => Promise<void>;
  formatFileSize: (bytes?: number) => string;
}

export const ViewRouter = memo<ViewRouterProps>(({
  currentView,
  // RecordView props
  isRecording,
  isProcessing,
  recordingStartTime,
  hotkey,
  pushToTalkHotkey,
  uploadProgress,
  sessionTranscripts,
  selectedMic,
  onMicChange,
  startRecording,
  stopRecording,
  cancelRecording,
  handleFileUpload,
  formatDuration,
  formatRecordingTimer,
  showDeleteConfirmation,
  navigateToTranscript,
  // TranscriptsView props
  transcripts,
  selectedTranscripts,
  searchQuery,
  setSearchQuery,
  searchTranscripts,
  toggleTranscriptSelection,
  toggleTranscriptGroupSelection,
  selectAllTranscripts,
  showBulkDeleteConfirmation,
  exportTranscripts,
  copyTranscript,
  formatFileSize,
}) => {
  switch (currentView) {
    case 'record':
      return (
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
            onMicChange={onMicChange}
            startRecording={startRecording}
            stopRecording={stopRecording}
            cancelRecording={cancelRecording}
            handleFileUpload={handleFileUpload}
            formatDuration={formatDuration}
            formatRecordingTimer={formatRecordingTimer}
            showDeleteConfirmation={showDeleteConfirmation}
            navigateToTranscript={navigateToTranscript}
          />
        </AudioErrorBoundary>
      );
    case 'transcripts':
      return (
        <TranscriptionErrorBoundary>
          <Suspense fallback={<div style={{ padding: '20px', textAlign: 'center' }}>Loading transcripts...</div>}>
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
          </Suspense>
        </TranscriptionErrorBoundary>
      );
    case 'settings':
      return (
        <SettingsErrorBoundary>
          <Suspense fallback={<div style={{ padding: '20px', textAlign: 'center' }}>Loading settings...</div>}>
            <SettingsView />
          </Suspense>
        </SettingsErrorBoundary>
      );
    case 'stats':
      return (
        <Suspense fallback={<div style={{ padding: '20px', textAlign: 'center' }}>Loading stats...</div>}>
          <StatsView />
        </Suspense>
      );
    case 'dictionary':
      return (
        <Suspense fallback={<div style={{ padding: '20px', textAlign: 'center' }}>Loading dictionary...</div>}>
          <Dictionary />
        </Suspense>
      );
    default:
      return null;
  }
});

ViewRouter.displayName = 'ViewRouter';
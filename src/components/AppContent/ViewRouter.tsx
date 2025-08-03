import { memo } from 'react';
import { AudioErrorBoundary, TranscriptionErrorBoundary, SettingsErrorBoundary } from '../ErrorBoundary';
import { RecordView } from '../RecordView';
import { TranscriptsView } from '../TranscriptsView';
import { SettingsView } from '../SettingsView';
import { StatsView } from '../StatsView';
import Dictionary from '../Dictionary';
import type { ViewType } from './types';

interface ViewRouterProps {
  currentView: ViewType;
  // RecordView props
  isRecording: boolean;
  isStopping: boolean;
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
  isStopping,
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
            isStopping={isStopping}
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
          />
        </AudioErrorBoundary>
      );
    case 'transcripts':
      return (
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
      );
    case 'settings':
      return (
        <SettingsErrorBoundary>
          <SettingsView />
        </SettingsErrorBoundary>
      );
    case 'stats':
      return <StatsView />;
    case 'dictionary':
      return <Dictionary />;
    default:
      return null;
  }
});

ViewRouter.displayName = 'ViewRouter';
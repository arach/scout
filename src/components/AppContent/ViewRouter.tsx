import { memo } from 'react';
import { AudioErrorBoundary, TranscriptionErrorBoundary, SettingsErrorBoundary } from '../ErrorBoundary';
import { RecordView } from '../RecordView';
import { TranscriptsView } from '../TranscriptsView';
import { SettingsView } from '../SettingsView';
import { StatsView } from '../StatsView';
import Dictionary from '../Dictionary';
import type { ViewType } from './types';
import type { ThemeVariant } from '../../themes/types';

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
  // SettingsView props
  isCapturingHotkey: boolean;
  hotkeyUpdateStatus?: any;
  isCapturingPushToTalkHotkey: boolean;
  overlayPosition: any;
  overlayTreatment: any;
  autoCopy: boolean;
  autoPaste: boolean;
  theme: 'system' | 'light' | 'dark';
  selectedTheme: ThemeVariant | undefined;
  soundEnabled: boolean;
  startSound: string;
  stopSound: string;
  successSound: string;
  completionSoundThreshold: number;
  llmSettings: any;
  stopCapturingHotkey: () => void;
  startCapturingHotkey: () => void;
  startCapturingPushToTalkHotkey: () => void;
  stopCapturingPushToTalkHotkey: () => void;
  updateOverlayPosition: (position: any) => void;
  updateOverlayTreatment: (treatment: any) => void;
  toggleAutoCopy: () => void;
  toggleAutoPaste: () => void;
  updateTheme: (theme: string) => void;
  updateSelectedTheme: (theme: string) => void;
  toggleSoundEnabled: () => void;
  updateStartSound: (sound: string) => void;
  updateStopSound: (sound: string) => void;
  updateSuccessSound: (sound: string) => void;
  updateCompletionSoundThreshold: (threshold: number) => void;
  updateLLMSettings: (settings: any) => void;
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
  // SettingsView props
  isCapturingHotkey,
  hotkeyUpdateStatus,
  isCapturingPushToTalkHotkey,
  overlayPosition,
  overlayTreatment,
  autoCopy,
  autoPaste,
  theme,
  selectedTheme,
  soundEnabled,
  startSound,
  stopSound,
  successSound,
  completionSoundThreshold,
  llmSettings,
  stopCapturingHotkey,
  startCapturingHotkey,
  startCapturingPushToTalkHotkey,
  stopCapturingPushToTalkHotkey,
  updateOverlayPosition,
  updateOverlayTreatment,
  toggleAutoCopy,
  toggleAutoPaste,
  updateTheme,
  updateSelectedTheme,
  toggleSoundEnabled,
  updateStartSound,
  updateStopSound,
  updateSuccessSound,
  updateCompletionSoundThreshold,
  updateLLMSettings,
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
            stopCapturingHotkey={stopCapturingHotkey}
            startCapturingHotkey={startCapturingHotkey}
            startCapturingPushToTalkHotkey={startCapturingPushToTalkHotkey}
            stopCapturingPushToTalkHotkey={stopCapturingPushToTalkHotkey}
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
import React, { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { ThemeProvider } from '../themes/ThemeProvider';
import { AppProviders } from '../contexts/AppProviders';

// Custom render function that includes providers
const AllTheProviders = ({ children }: { children: React.ReactNode }) => {
  return (
    <ThemeProvider>
      <AppProviders>
        {children}
      </AppProviders>
    </ThemeProvider>
  );
};

const customRender = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) => render(ui, { wrapper: AllTheProviders, ...options });

// Mock factory functions for common test data
export const createMockTranscript = (overrides = {}) => ({
  id: 1,
  text: 'Sample transcript text',
  audio_path: '/path/to/audio.wav',
  created_at: new Date().toISOString(),
  duration: 5000,
  file_size: 1024,
  ...overrides,
});

export const createMockAudioContext = () => ({
  selectedMic: 'Default microphone',
  vadEnabled: false,
  audioLevel: 0,
  setSelectedMic: vi.fn(),
  setVadEnabled: vi.fn(),
});

export const createMockTranscriptContext = () => ({
  transcripts: [],
  searchQuery: '',
  selectedTranscripts: new Set<number>(),
  isProcessing: false,
  sessionStartTime: new Date().toISOString(),
  setTranscripts: vi.fn(),
  setSearchQuery: vi.fn(),
  setSelectedTranscripts: vi.fn(),
  setIsProcessing: vi.fn(),
  addTranscript: vi.fn(),
  removeTranscript: vi.fn(),
  clearSelectedTranscripts: vi.fn(),
  toggleTranscriptSelection: vi.fn(),
  toggleTranscriptGroupSelection: vi.fn(),
  selectAllTranscripts: vi.fn(),
});

export const createMockUIContext = () => ({
  currentView: 'record' as const,
  showTranscriptionOverlay: false,
  showFirstRun: false,
  isCapturingHotkey: false,
  isCapturingPushToTalkHotkey: false,
  capturedKeys: [],
  deleteConfirmation: {
    show: false,
    transcriptId: null,
    transcriptText: '',
    isBulk: false,
  },
  hotkeyUpdateStatus: 'idle' as const,
  uploadProgress: { status: 'idle' as const },
  setCurrentView: vi.fn(),
  setShowTranscriptionOverlay: vi.fn(),
  setShowFirstRun: vi.fn(),
  setIsCapturingHotkey: vi.fn(),
  setIsCapturingPushToTalkHotkey: vi.fn(),
  setCapturedKeys: vi.fn(),
  setDeleteConfirmation: vi.fn(),
  setHotkeyUpdateStatus: vi.fn(),
  setUploadProgress: vi.fn(),
  showDeleteDialog: vi.fn(),
  hideDeleteDialog: vi.fn(),
});

// Utility to wait for async operations
export const waitForAsync = () => new Promise(resolve => setTimeout(resolve, 0));

// Helper to create a mock file
export const createMockFile = (name = 'test.wav', type = 'audio/wav') => {
  const file = new File([''], name, { type });
  return file;
};

// Helper for testing error boundaries
export const ThrowError = ({ shouldThrow = false }: { shouldThrow?: boolean }) => {
  if (shouldThrow) {
    throw new Error('Test error');
  }
  return <div>No error</div>;
};

// re-export everything
export * from '@testing-library/react';
export { customRender as render };

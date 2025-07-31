import React, { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { vi } from 'vitest';
import { AppProviders } from '../contexts/AppProviders';
import { Transcript } from '../types/transcript';

// Mock Tauri API functions
export const mockTauriApi = {
  invoke: vi.fn(),
  isRecording: vi.fn().mockResolvedValue(false),
  startRecording: vi.fn().mockResolvedValue('recording-started'),
  stopRecording: vi.fn().mockResolvedValue(undefined),
  cancelRecording: vi.fn().mockResolvedValue(undefined),
  getRecentTranscripts: vi.fn().mockResolvedValue([]),
  searchTranscripts: vi.fn().mockResolvedValue([]),
  deleteTranscript: vi.fn().mockResolvedValue(undefined),
  exportTranscripts: vi.fn().mockResolvedValue(undefined),
  playStartSound: vi.fn().mockResolvedValue(undefined),
  playStopSound: vi.fn().mockResolvedValue(undefined),
  getSettings: vi.fn().mockResolvedValue({}),
  updateSettings: vi.fn().mockResolvedValue(undefined),
  getAudioDevices: vi.fn().mockResolvedValue([{
    id: 'default',
    name: 'Default microphone',
    is_default: true,
  }]),
  getAudioLevel: vi.fn().mockResolvedValue(0),
};

// Sample transcript data for testing
export const createMockTranscript = (overrides: Partial<Transcript> = {}): Transcript => ({
  id: 1,
  text: 'This is a test transcript',
  created_at: new Date().toISOString(),
  duration_ms: 5000,
  audio_path: '/path/to/audio.wav',
  file_size: 1024000,
  metadata: JSON.stringify({
    model_used: 'whisper-base',
    processing_type: 'full'
  }),
  ...overrides,
});

export const createMockTranscripts = (count: number): Transcript[] => {
  return Array.from({ length: count }, (_, i) => createMockTranscript({
    id: i + 1,
    text: `This is test transcript ${i + 1}`,
    created_at: new Date(Date.now() - i * 3600000).toISOString(), // Stagger by hours
  }));
};

// Mock settings data
export const createMockSettings = () => ({
  recording: {
    hotkey: 'CmdOrCtrl+Shift+R',
    pushToTalkHotkey: 'CmdOrCtrl+Space',
    selectedMicrophone: 'Default microphone',
    soundEnabled: true,
    autoStop: false,
    autoStopDuration: 30,
  },
  transcription: {
    model: 'whisper-base',
    language: 'auto',
  },
  ui: {
    theme: 'vscode',
    showOverlay: true,
    overlayPosition: 'top-right',
  },
  llm: {
    enabled: false,
    provider: 'openai',
    apiKey: '',
    model: 'gpt-3.5-turbo',
  },
});

// Custom render function that includes providers
const AllTheProviders = ({ children }: { children: React.ReactNode }) => {
  return (
    <AppProviders>
      {children}
    </AppProviders>
  );
};

const customRender = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) => render(ui, { wrapper: AllTheProviders, ...options });

// Re-export everything
export * from '@testing-library/react';
export { customRender as render };

// Helper functions for common test patterns
export const waitForLoadingToFinish = () => {
  // Wait for any loading states to complete
  return new Promise(resolve => setTimeout(resolve, 0));
};

export const fireKeyboardEvent = (element: Element, key: string, options: any = {}) => {
  const event = new KeyboardEvent('keydown', {
    key,
    code: key,
    bubbles: true,
    ...options,
  });
  element.dispatchEvent(event);
};

// Mock event listener functions
export const mockEventListeners = {
  recording: {
    'recording-state-changed': vi.fn(),
    'recording-progress': vi.fn(),
    'push-to-talk-pressed': vi.fn(),
    'push-to-talk-released': vi.fn(),
    'processing-complete': vi.fn(),
  },
  audio: {
    'audio-level': vi.fn(),
  },
};

// Mock contexts
export const mockRecordingContext = {
  state: {
    isRecording: false,
    isStarting: false,
  },
  canStartRecording: vi.fn().mockReturnValue(true),
  setRecording: vi.fn(),
  setStarting: vi.fn(),
  reset: vi.fn(),
};

export const mockSettingsContext = {
  state: createMockSettings(),
  actions: {
    updateRecordingSettings: vi.fn(),
    updateTranscriptionSettings: vi.fn(),
    updateUISettings: vi.fn(),
    updateLLMSettings: vi.fn(),
    loadSettings: vi.fn(),
  },
};

export const mockAudioContext = {
  audioLevel: 0,
  isMonitoring: false,
  startMonitoring: vi.fn(),
  stopMonitoring: vi.fn(),
};

import { vi } from 'vitest';

// Mock the Tauri API modules
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockImplementation((command: string) => {
    switch (command) {
      case 'is_recording':
        return Promise.resolve(false);
      case 'start_recording':
        return Promise.resolve('recording-started');
      case 'stop_recording':
        return Promise.resolve();
      case 'cancel_recording':
        return Promise.resolve();
      case 'get_recent_transcripts':
        return Promise.resolve([]);
      case 'search_transcripts':
        return Promise.resolve([]);
      case 'delete_transcript':
        return Promise.resolve();
      case 'export_transcripts':
        return Promise.resolve();
      case 'get_settings':
        return Promise.resolve({});
      case 'update_settings':
        return Promise.resolve();
      case 'get_audio_devices':
        return Promise.resolve([{
          id: 'default',
          name: 'Default microphone',
          is_default: true,
        }]);
      case 'play_start_sound':
        return Promise.resolve();
      case 'play_stop_sound':
        return Promise.resolve();
      case 'get_audio_level':
        return Promise.resolve(0);
      default:
        return Promise.resolve();
    }
  }),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockImplementation(() => {
    // Return a cleanup function
    return Promise.resolve(() => {});
  }),
  emit: vi.fn().mockResolvedValue(undefined),
  once: vi.fn().mockResolvedValue(undefined),
}));

// Mock the custom hooks
vi.mock('../hooks/useRecording', () => ({
  useRecording: vi.fn().mockReturnValue({
    isRecording: false,
    recordingStartTime: null,
    toggleRecording: vi.fn(),
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    cancelRecording: vi.fn(),
  }),
}));

vi.mock('../hooks/useTranscriptManagement', () => ({
  useTranscriptManagement: vi.fn().mockReturnValue({
    loadRecentTranscripts: vi.fn().mockResolvedValue([]),
    loadAllTranscripts: vi.fn().mockResolvedValue([]),
    deleteTranscript: vi.fn().mockResolvedValue(true),
    searchTranscripts: vi.fn().mockResolvedValue([]),
    exportTranscripts: vi.fn().mockResolvedValue(true),
    copyTranscript: vi.fn().mockResolvedValue(true),
  }),
}));

vi.mock('../hooks/useSettings', () => ({
  useSettings: vi.fn().mockReturnValue({
    state: {
      recording: {
        hotkey: 'CmdOrCtrl+Shift+R',
        pushToTalkHotkey: 'CmdOrCtrl+Space',
        selectedMicrophone: 'Default microphone',
        soundEnabled: true,
      },
      ui: {
        theme: 'vscode',
      },
    },
    actions: {
      updateRecordingSettings: vi.fn(),
      updateUISettings: vi.fn(),
    },
  }),
}));

// Mock audio level context
vi.mock('../contexts/AudioContext', () => ({
  useAudioLevel: vi.fn().mockReturnValue(0),
  AudioProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock recording context
vi.mock('../contexts/RecordingContext', () => ({
  useRecordingContext: vi.fn().mockReturnValue({
    state: {
      isRecording: false,
      isStarting: false,
    },
    canStartRecording: vi.fn().mockReturnValue(true),
    setRecording: vi.fn(),
    setStarting: vi.fn(),
    reset: vi.fn(),
  }),
  RecordingProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock settings context
vi.mock('../contexts/SettingsContext', () => ({
  useSettings: vi.fn().mockReturnValue({
    state: {
      recording: {
        hotkey: 'CmdOrCtrl+Shift+R',
        pushToTalkHotkey: 'CmdOrCtrl+Space',
        selectedMicrophone: 'Default microphone',
        soundEnabled: true,
      },
      ui: {
        theme: 'vscode',
      },
    },
    actions: {
      updateRecordingSettings: vi.fn(),
      updateUISettings: vi.fn(),
    },
  }),
  SettingsProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock theme context
vi.mock('../themes/useTheme', () => ({
  useTheme: vi.fn().mockReturnValue({
    currentTheme: 'vscode',
    setTheme: vi.fn(),
    themes: ['vscode', 'terminal', 'minimal'],
  }),
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => {
  const MockIcon = ({ size, className, ...props }: any) => (
    <div data-testid="mock-icon" className={className} {...props} style={{ width: size, height: size }} />
  );
  
  return {
    Settings: MockIcon,
    Mic: MockIcon,
    Monitor: MockIcon,
    Palette: MockIcon,
    Brain: MockIcon,
    Sparkles: MockIcon,
    FolderOpen: MockIcon,
    ChevronDown: MockIcon,
    Play: MockIcon,
    Pause: MockIcon,
    Stop: MockIcon,
    Search: MockIcon,
    Download: MockIcon,
    Trash2: MockIcon,
    Copy: MockIcon,
    X: MockIcon,
  };
});

// Mock CSS modules
vi.mock('*.module.css', () => ({
  default: {},
}));

// Export mocks for use in tests
export const mocks = {
  invoke: vi.mocked(vi.fn()),
  listen: vi.mocked(vi.fn()),
  useRecording: vi.mocked(vi.fn()),
  useTranscriptManagement: vi.mocked(vi.fn()),
  useSettings: vi.mocked(vi.fn()),
};

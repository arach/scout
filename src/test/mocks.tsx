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
      case 'get_overlay_position':
        return Promise.resolve('top-right');
      case 'set_overlay_position':
        return Promise.resolve();
      case 'get_current_shortcut':
        return Promise.resolve('CmdOrCtrl+Shift+R');
      case 'get_push_to_talk_shortcut':
        return Promise.resolve('CmdOrCtrl+Space');
      case 'set_overlay_treatment':
        return Promise.resolve();
      case 'is_sound_enabled':
        return Promise.resolve(true);
      case 'get_sound_settings':
        return Promise.resolve({
          startSound: 'start.wav',
          stopSound: 'stop.wav',
          successSound: 'success.wav'
        });
      case 'get_output_directory':
        return Promise.resolve('/tmp/scout-output');
      case 'get_transcript_template':
        return Promise.resolve('{{text}}');
      case 'get_llm_settings':
        return Promise.resolve({
          provider: 'openai',
          model: 'gpt-4',
          apiKey: '',
          enabled: false
        });
      case 'is_auto_copy_enabled':
        return Promise.resolve(false);
      case 'is_auto_paste_enabled':
        return Promise.resolve(false);
      case 'set_start_sound':
        return Promise.resolve();
      case 'set_stop_sound':
        return Promise.resolve();
      case 'set_success_sound':
        return Promise.resolve();
      case 'update_completion_sound_threshold':
        return Promise.resolve();
      case 'update_llm_settings':
        return Promise.resolve();
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

// Note: Hooks and contexts are mocked individually in test files to avoid conflicts

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

// Mock both useSettings hooks to prevent async loading issues
vi.mock('../hooks/useSettings', () => ({
  useSettings: vi.fn().mockReturnValue({
    overlayPosition: 'top-right',
    overlayTreatment: 'particles', 
    hotkey: 'CmdOrCtrl+Shift+R',
    pushToTalkHotkey: 'CmdOrCtrl+Space',
    theme: 'system',
    selectedTheme: 'vscode',
    soundEnabled: true,
    startSound: 'start.wav',
    stopSound: 'stop.wav', 
    successSound: 'success.wav',
    completionSoundThreshold: 3000,
    llmSettings: {
      enabled: false,
      model_id: 'tinyllama-1.1b',
      temperature: 0.7,
      max_tokens: 200,
      auto_download_model: false,
      enabled_prompts: ['summarize', 'bullet_points', 'action_items', 'fix_grammar']
    },
    autoCopy: false,
    autoPaste: false,
    setHotkey: vi.fn(),
    setPushToTalkHotkey: vi.fn(),
    updateOverlayPosition: vi.fn(),
    updateOverlayTreatment: vi.fn(),
    updateTheme: vi.fn(),
    updateSelectedTheme: vi.fn(),
    toggleSoundEnabled: vi.fn(),
    updateStartSound: vi.fn(),
    updateStopSound: vi.fn(),
    updateSuccessSound: vi.fn(),
    updateCompletionSoundThreshold: vi.fn(),
    updateLLMSettings: vi.fn(),
    toggleAutoCopy: vi.fn(),
    toggleAutoPaste: vi.fn(),
    settings: {
      overlayPosition: 'top-right',
      overlayTreatment: 'particles',
      hotkey: 'CmdOrCtrl+Shift+R',
      pushToTalkHotkey: 'CmdOrCtrl+Space',
      theme: 'system',
      selectedTheme: 'vscode',
      soundEnabled: true,
      startSound: 'start.wav',
      stopSound: 'stop.wav',
      successSound: 'success.wav',
      completionSoundThreshold: 3000,
      llmSettings: {
        enabled: false,
        model_id: 'tinyllama-1.1b',
        temperature: 0.7,
        max_tokens: 200,
        auto_download_model: false,
        enabled_prompts: ['summarize', 'bullet_points', 'action_items', 'fix_grammar']
      },
      autoCopy: false,
      autoPaste: false,
    },
    updateSettings: vi.fn(),
  }),
}));

// Create a comprehensive mock that completely bypasses the async loading
vi.mock('../hooks/useSettingsContext', () => {
  const mockUseSettings = vi.fn().mockReturnValue({
    overlayPosition: 'top-right',
    overlayTreatment: 'particles', 
    hotkey: 'CmdOrCtrl+Shift+R',
    pushToTalkHotkey: 'CmdOrCtrl+Space',
    theme: 'system',
    selectedTheme: 'vscode',
    soundEnabled: true,
    startSound: 'start.wav',
    stopSound: 'stop.wav', 
    successSound: 'success.wav',
    completionSoundThreshold: 3000,
    llmSettings: {
      enabled: false,
      model_id: 'tinyllama-1.1b',
      temperature: 0.7,
      max_tokens: 200,
      auto_download_model: false,
      enabled_prompts: ['summarize', 'bullet_points', 'action_items', 'fix_grammar']
    },
    autoCopy: false,
    autoPaste: false,
    setHotkey: vi.fn(),
    setPushToTalkHotkey: vi.fn(),
    updateOverlayPosition: vi.fn().mockResolvedValue(undefined),
    updateOverlayTreatment: vi.fn().mockResolvedValue(undefined),
    updateTheme: vi.fn(),
    updateSelectedTheme: vi.fn(),
    toggleSoundEnabled: vi.fn().mockResolvedValue(undefined),
    updateStartSound: vi.fn().mockResolvedValue(undefined),
    updateStopSound: vi.fn().mockResolvedValue(undefined),
    updateSuccessSound: vi.fn().mockResolvedValue(undefined),
    updateCompletionSoundThreshold: vi.fn().mockResolvedValue(undefined),
    updateLLMSettings: vi.fn().mockResolvedValue(undefined),
    toggleAutoCopy: vi.fn().mockResolvedValue(undefined),
    toggleAutoPaste: vi.fn().mockResolvedValue(undefined),
    settings: {
      overlayPosition: 'top-right',
      overlayTreatment: 'particles',
      hotkey: 'CmdOrCtrl+Shift+R',
      pushToTalkHotkey: 'CmdOrCtrl+Space',
      theme: 'system',
      selectedTheme: 'vscode',
      soundEnabled: true,
      startSound: 'start.wav',
      stopSound: 'stop.wav',
      successSound: 'success.wav',
      completionSoundThreshold: 3000,
      llmSettings: {
        enabled: false,
        model_id: 'tinyllama-1.1b',
        temperature: 0.7,
        max_tokens: 200,
        auto_download_model: false,
        enabled_prompts: ['summarize', 'bullet_points', 'action_items', 'fix_grammar']
      },
      autoCopy: false,
      autoPaste: false,
    },
    updateSettings: vi.fn(),
  });
  
  return {
    useSettings: mockUseSettings,
  };
});

// Mock ThemeProvider to prevent useSettings from being called
vi.mock('../themes/ThemeProvider', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mock-theme-provider">{children}</div>
  ),
}));

// Export mocks for use in tests
export const mocks = {
  invoke: vi.mocked(vi.fn()),
  listen: vi.mocked(vi.fn()),
  useRecording: vi.mocked(vi.fn()),
  useTranscriptManagement: vi.mocked(vi.fn()),
  useSettings: vi.mocked(vi.fn()),
};

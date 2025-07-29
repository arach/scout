import { ReactNode } from 'react';
import { RecordingProvider } from './RecordingContext';
import { AudioProvider } from './AudioContext';
import { TranscriptProvider } from './TranscriptContext';
import { UIProvider } from './UIContext';
import { SettingsProvider, SettingsState } from './SettingsContext';
import { ThemeProvider } from '../themes/ThemeProvider';

interface AppProvidersProps {
  children: ReactNode;
}

// Default initial settings
const initialSettings: SettingsState = {
  shortcuts: {
    hotkey: 'CmdOrCtrl+Shift+Space',
    pushToTalkHotkey: 'CmdOrCtrl+Shift+P',
    isCapturingHotkey: false,
    isCapturingPushToTalkHotkey: false,
    hotkeyUpdateStatus: 'idle'
  },
  clipboard: {
    autoCopy: false,
    autoPaste: false
  },
  sound: {
    soundEnabled: true,
    startSound: 'Glass',
    stopSound: 'Glass',
    successSound: 'Pop',
    completionSoundThreshold: 1000
  },
  ui: {
    overlayPosition: 'top-center',
    overlayTreatment: 'particles',
    theme: 'system',
    selectedTheme: undefined
  },
  llm: {
    enabled: false,
    model_id: 'tinyllama-1.1b',
    temperature: 0.7,
    max_tokens: 200,
    auto_download_model: false,
    enabled_prompts: ['summarize', 'bullet_points', 'action_items', 'fix_grammar']
  }
};

/**
 * Combined provider component that wraps the app with all necessary contexts
 * in the correct hierarchical order for optimal performance and data flow
 */
export function AppProviders({ children }: AppProvidersProps) {
  return (
    <AudioProvider>
      <TranscriptProvider>
        <SettingsProvider initialSettings={initialSettings}>
          <ThemeProvider>
            <UIProvider>
              <RecordingProvider>
                {children}
              </RecordingProvider>
            </UIProvider>
          </ThemeProvider>
        </SettingsProvider>
      </TranscriptProvider>
    </AudioProvider>
  );
}
import React, { createContext, useContext, useReducer, useMemo } from 'react';
import { LLMSettings } from '../types/llm';
import { ThemeVariant } from '../themes/types';

// Types
export type OverlayPosition = 
  | 'top-left' | 'top-center' | 'top-right'
  | 'left-center' | 'right-center'
  | 'bottom-left' | 'bottom-center' | 'bottom-right';

export type OverlayTreatment = 
  | 'particles' | 'pulsingDot' | 'animatedWaveform' 
  | 'gradientOrb' | 'floatingBubbles';

export type SoundType = 'start' | 'stop' | 'success';

export interface ShortcutSettings {
  hotkey: string;
  pushToTalkHotkey: string;
  isCapturingHotkey: boolean;
  isCapturingPushToTalkHotkey: boolean;
  hotkeyUpdateStatus: 'idle' | 'success' | 'error';
}

export interface ClipboardSettings {
  autoCopy: boolean;
  autoPaste: boolean;
}

export interface SoundSettings {
  soundEnabled: boolean;
  startSound: string;
  stopSound: string;
  successSound: string;
  completionSoundThreshold: number;
}

export interface UISettings {
  overlayPosition: OverlayPosition;
  overlayTreatment: OverlayTreatment;
  theme: 'light' | 'dark' | 'system';
  selectedTheme?: ThemeVariant;
}

export interface SettingsState {
  shortcuts: ShortcutSettings;
  clipboard: ClipboardSettings;
  sound: SoundSettings;
  ui: UISettings;
  llm: LLMSettings;
}

// Action Types
export type SettingsAction =
  | { type: 'UPDATE_HOTKEY'; payload: string }
  | { type: 'UPDATE_PUSH_TO_TALK_HOTKEY'; payload: string }
  | { type: 'SET_CAPTURING_HOTKEY'; payload: boolean }
  | { type: 'SET_CAPTURING_PUSH_TO_TALK'; payload: boolean }
  | { type: 'UPDATE_CAPTURED_HOTKEY'; payload: string }
  | { type: 'UPDATE_CAPTURED_PUSH_TO_TALK_HOTKEY'; payload: string }
  | { type: 'SET_HOTKEY_UPDATE_STATUS'; payload: 'idle' | 'success' | 'error' }
  | { type: 'TOGGLE_AUTO_COPY' }
  | { type: 'TOGGLE_AUTO_PASTE' }
  | { type: 'TOGGLE_SOUND_ENABLED' }
  | { type: 'UPDATE_SOUND'; payload: { type: SoundType; sound: string } }
  | { type: 'UPDATE_COMPLETION_THRESHOLD'; payload: number }
  | { type: 'UPDATE_OVERLAY_POSITION'; payload: OverlayPosition }
  | { type: 'UPDATE_OVERLAY_TREATMENT'; payload: OverlayTreatment }
  | { type: 'UPDATE_THEME'; payload: 'light' | 'dark' | 'system' }
  | { type: 'UPDATE_SELECTED_THEME'; payload: ThemeVariant }
  | { type: 'UPDATE_LLM_SETTINGS'; payload: Partial<LLMSettings> };

// Reducer
function settingsReducer(state: SettingsState, action: SettingsAction): SettingsState {
  switch (action.type) {
    case 'UPDATE_HOTKEY':
      return {
        ...state,
        shortcuts: { ...state.shortcuts, hotkey: action.payload }
      };
    
    case 'UPDATE_PUSH_TO_TALK_HOTKEY':
      return {
        ...state,
        shortcuts: { ...state.shortcuts, pushToTalkHotkey: action.payload }
      };
    
    case 'UPDATE_CAPTURED_HOTKEY':
      return {
        ...state,
        shortcuts: { 
          ...state.shortcuts, 
          hotkey: action.payload,
          isCapturingHotkey: false,
          hotkeyUpdateStatus: 'success'
        }
      };
    
    case 'UPDATE_CAPTURED_PUSH_TO_TALK_HOTKEY':
      return {
        ...state,
        shortcuts: { 
          ...state.shortcuts, 
          pushToTalkHotkey: action.payload,
          isCapturingPushToTalkHotkey: false,
          hotkeyUpdateStatus: 'success'
        }
      };
    
    case 'SET_CAPTURING_HOTKEY':
      return {
        ...state,
        shortcuts: { ...state.shortcuts, isCapturingHotkey: action.payload }
      };
    
    case 'SET_CAPTURING_PUSH_TO_TALK':
      return {
        ...state,
        shortcuts: { ...state.shortcuts, isCapturingPushToTalkHotkey: action.payload }
      };
    
    case 'SET_HOTKEY_UPDATE_STATUS':
      return {
        ...state,
        shortcuts: { ...state.shortcuts, hotkeyUpdateStatus: action.payload }
      };
    
    case 'TOGGLE_AUTO_COPY':
      return {
        ...state,
        clipboard: { ...state.clipboard, autoCopy: !state.clipboard.autoCopy }
      };
    
    case 'TOGGLE_AUTO_PASTE':
      return {
        ...state,
        clipboard: { ...state.clipboard, autoPaste: !state.clipboard.autoPaste }
      };
    
    case 'TOGGLE_SOUND_ENABLED':
      return {
        ...state,
        sound: { ...state.sound, soundEnabled: !state.sound.soundEnabled }
      };
    
    case 'UPDATE_SOUND':
      return {
        ...state,
        sound: {
          ...state.sound,
          [`${action.payload.type}Sound`]: action.payload.sound
        }
      };
    
    case 'UPDATE_COMPLETION_THRESHOLD':
      return {
        ...state,
        sound: { ...state.sound, completionSoundThreshold: action.payload }
      };
    
    case 'UPDATE_OVERLAY_POSITION':
      return {
        ...state,
        ui: { ...state.ui, overlayPosition: action.payload }
      };
    
    case 'UPDATE_OVERLAY_TREATMENT':
      return {
        ...state,
        ui: { ...state.ui, overlayTreatment: action.payload }
      };
    
    case 'UPDATE_THEME':
      return {
        ...state,
        ui: { ...state.ui, theme: action.payload }
      };
    
    case 'UPDATE_SELECTED_THEME':
      return {
        ...state,
        ui: { ...state.ui, selectedTheme: action.payload }
      };
    
    case 'UPDATE_LLM_SETTINGS':
      return {
        ...state,
        llm: { ...state.llm, ...action.payload }
      };
    
    default:
      return state;
  }
}

// Context
interface SettingsContextValue {
  state: SettingsState;
  dispatch: React.Dispatch<SettingsAction>;
  actions: {
    updateHotkey: (hotkey: string) => void;
    updatePushToTalkHotkey: (hotkey: string) => void;
    startCapturingHotkey: () => void;
    stopCapturingHotkey: () => void;
    startCapturingPushToTalkHotkey: () => void;
    stopCapturingPushToTalkHotkey: () => void;
    toggleAutoCopy: () => void;
    toggleAutoPaste: () => void;
    toggleSoundEnabled: () => void;
    updateStartSound: (sound: string) => void;
    updateStopSound: (sound: string) => void;
    updateSuccessSound: (sound: string) => void;
    updateCompletionSoundThreshold: (threshold: number) => void;
    updateOverlayPosition: (position: OverlayPosition) => void;
    updateOverlayTreatment: (treatment: OverlayTreatment) => void;
    updateTheme: (theme: 'light' | 'dark' | 'system') => void;
    updateSelectedTheme: (theme: ThemeVariant) => void;
    updateLLMSettings: (settings: Partial<LLMSettings>) => void;
  };
}

const SettingsContext = createContext<SettingsContextValue | undefined>(undefined);

// Provider Props
interface SettingsProviderProps {
  children: React.ReactNode;
  initialSettings: SettingsState;
}

// Provider Component
export function SettingsProvider({ children, initialSettings }: SettingsProviderProps) {
  const [state, dispatch] = useReducer(settingsReducer, initialSettings);

  // Memoized action creators
  const actions = useMemo(() => ({
    updateHotkey: (hotkey: string) => dispatch({ type: 'UPDATE_HOTKEY', payload: hotkey }),
    updatePushToTalkHotkey: (hotkey: string) => dispatch({ type: 'UPDATE_PUSH_TO_TALK_HOTKEY', payload: hotkey }),
    startCapturingHotkey: () => dispatch({ type: 'SET_CAPTURING_HOTKEY', payload: true }),
    stopCapturingHotkey: () => dispatch({ type: 'SET_CAPTURING_HOTKEY', payload: false }),
    startCapturingPushToTalkHotkey: () => dispatch({ type: 'SET_CAPTURING_PUSH_TO_TALK', payload: true }),
    stopCapturingPushToTalkHotkey: () => dispatch({ type: 'SET_CAPTURING_PUSH_TO_TALK', payload: false }),
    toggleAutoCopy: () => dispatch({ type: 'TOGGLE_AUTO_COPY' }),
    toggleAutoPaste: () => dispatch({ type: 'TOGGLE_AUTO_PASTE' }),
    toggleSoundEnabled: () => dispatch({ type: 'TOGGLE_SOUND_ENABLED' }),
    updateStartSound: (sound: string) => dispatch({ type: 'UPDATE_SOUND', payload: { type: 'start', sound } }),
    updateStopSound: (sound: string) => dispatch({ type: 'UPDATE_SOUND', payload: { type: 'stop', sound } }),
    updateSuccessSound: (sound: string) => dispatch({ type: 'UPDATE_SOUND', payload: { type: 'success', sound } }),
    updateCompletionSoundThreshold: (threshold: number) => dispatch({ type: 'UPDATE_COMPLETION_THRESHOLD', payload: threshold }),
    updateOverlayPosition: (position: OverlayPosition) => dispatch({ type: 'UPDATE_OVERLAY_POSITION', payload: position }),
    updateOverlayTreatment: (treatment: OverlayTreatment) => dispatch({ type: 'UPDATE_OVERLAY_TREATMENT', payload: treatment }),
    updateTheme: (theme: 'light' | 'dark' | 'system') => dispatch({ type: 'UPDATE_THEME', payload: theme }),
    updateSelectedTheme: (theme: ThemeVariant) => dispatch({ type: 'UPDATE_SELECTED_THEME', payload: theme }),
    updateLLMSettings: (settings: Partial<LLMSettings>) => dispatch({ type: 'UPDATE_LLM_SETTINGS', payload: settings }),
  }), []);

  const value = useMemo(() => ({
    state,
    dispatch,
    actions
  }), [state, actions]);

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

// Hook
export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}

// Alias for backwards compatibility
export const useSettingsContext = useSettings;
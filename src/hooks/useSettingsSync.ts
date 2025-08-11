import { useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSettings } from '../contexts/SettingsContext';

/**
 * Hook to synchronize ALL settings between frontend and backend
 */
export function useSettingsSync() {
  const { state, dispatch } = useSettings();
  const isInitialLoad = useRef(true);
  const previousState = useRef(state);

  // Load ALL settings from backend on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const backendSettings = await invoke<any>('get_settings');
        console.log('Loading settings from backend:', backendSettings);
        
        // Update frontend state with ALL backend settings
        if (backendSettings.ui) {
          // Clipboard settings
          if (backendSettings.ui.auto_copy !== undefined) {
            dispatch({ type: 'SET_AUTO_COPY', payload: backendSettings.ui.auto_copy });
          }
          if (backendSettings.ui.auto_paste !== undefined) {
            dispatch({ type: 'SET_AUTO_PASTE', payload: backendSettings.ui.auto_paste });
          }
          
          // Sound settings
          if (backendSettings.ui.sound_enabled !== undefined) {
            dispatch({ type: 'SET_SOUND_ENABLED', payload: backendSettings.ui.sound_enabled });
          }
          if (backendSettings.ui.start_sound) {
            dispatch({ type: 'UPDATE_SOUND', payload: { type: 'start', sound: backendSettings.ui.start_sound } });
          }
          if (backendSettings.ui.stop_sound) {
            dispatch({ type: 'UPDATE_SOUND', payload: { type: 'stop', sound: backendSettings.ui.stop_sound } });
          }
          if (backendSettings.ui.success_sound) {
            dispatch({ type: 'UPDATE_SOUND', payload: { type: 'success', sound: backendSettings.ui.success_sound } });
          }
          if (backendSettings.ui.completion_sound_threshold_ms !== undefined) {
            dispatch({ type: 'UPDATE_COMPLETION_THRESHOLD', payload: backendSettings.ui.completion_sound_threshold_ms });
          }
          
          // Hotkey settings
          if (backendSettings.ui.hotkey) {
            dispatch({ type: 'UPDATE_HOTKEY', payload: backendSettings.ui.hotkey });
          }
          if (backendSettings.ui.push_to_talk_hotkey) {
            dispatch({ type: 'UPDATE_PUSH_TO_TALK_HOTKEY', payload: backendSettings.ui.push_to_talk_hotkey });
          }
          
          // Overlay settings
          if (backendSettings.ui.overlay_position) {
            dispatch({ type: 'UPDATE_OVERLAY_POSITION', payload: backendSettings.ui.overlay_position });
          }
          // Note: overlay_treatment is not in backend, keeping frontend default
          
          // Theme settings
          if (backendSettings.ui.theme) {
            dispatch({ type: 'UPDATE_THEME', payload: backendSettings.ui.theme });
          }
          
          // Profanity filter settings (backend has these but frontend doesn't use them yet)
          // TODO: Add profanity filter support to frontend
          // if (backendSettings.ui.profanity_filter_enabled !== undefined) {
          //   dispatch({ type: 'SET_PROFANITY_FILTER', payload: backendSettings.ui.profanity_filter_enabled });
          // }
          
          // Foundation Models settings (backend has these but frontend doesn't use them yet)
          // TODO: Add foundation models settings to frontend state
        }
        
        // Model settings (Whisper models)
        if (backendSettings.models) {
          // TODO: Add model settings to frontend state
          // Currently these are managed separately through the model manager
          console.log('Model settings from backend:', backendSettings.models);
        }
        
        // Processing settings
        if (backendSettings.processing) {
          // TODO: Add processing settings to frontend if needed
          console.log('Processing settings from backend:', backendSettings.processing);
        }
        
        // Audio settings
        if (backendSettings.audio) {
          // TODO: Add audio device settings to frontend if needed
          console.log('Audio settings from backend:', backendSettings.audio);
        }
        
        // LLM settings
        if (backendSettings.llm) {
          dispatch({ type: 'UPDATE_LLM_SETTINGS', payload: backendSettings.llm });
        }
        
        isInitialLoad.current = false;
      } catch (error) {
        console.error('Failed to load settings from backend:', error);
        isInitialLoad.current = false;
      }
    };

    loadSettings();
  }, [dispatch]);

  // Save the entire settings object to backend when it changes
  useEffect(() => {
    // Skip the initial load to avoid saving before loading
    if (isInitialLoad.current) {
      return;
    }

    const saveSettings = async () => {
      try {
        // Create backend-compatible settings object
        const backendSettings = {
          ui: {
            auto_copy: state.clipboard.autoCopy,
            auto_paste: state.clipboard.autoPaste,
            sound_enabled: state.sound.soundEnabled,
            start_sound: state.sound.startSound,
            stop_sound: state.sound.stopSound,
            success_sound: state.sound.successSound,
            completion_sound_threshold_ms: state.sound.completionSoundThreshold,
            hotkey: state.shortcuts.hotkey,
            push_to_talk_hotkey: state.shortcuts.pushToTalkHotkey,
            overlay_position: state.ui.overlayPosition,
            overlay_treatment: state.ui.overlayTreatment,
            theme: state.ui.theme,
          },
          llm: state.llm,
        };

        // Update entire settings object
        await invoke('update_settings', { newSettings: backendSettings });
        console.log('Settings synced to backend:', backendSettings);
      } catch (error) {
        console.error('Failed to sync settings to backend:', error);
      }
    };

    // Debounce saves to avoid too many calls
    const timeoutId = setTimeout(saveSettings, 500);
    return () => clearTimeout(timeoutId);
  }, [state]);

  // Individual setting sync functions (for immediate updates)
  const syncAutoCopy = useCallback(async (enabled: boolean) => {
    try {
      await invoke('set_auto_copy', { enabled });
      console.log('Auto-copy synced:', enabled);
    } catch (error) {
      console.error('Failed to sync auto-copy:', error);
    }
  }, []);

  const syncAutoPaste = useCallback(async (enabled: boolean) => {
    try {
      await invoke('set_auto_paste', { enabled });
      console.log('Auto-paste synced:', enabled);
    } catch (error) {
      console.error('Failed to sync auto-paste:', error);
    }
  }, []);

  const syncSoundEnabled = useCallback(async (enabled: boolean) => {
    try {
      await invoke('set_sound_enabled', { enabled });
      console.log('Sound enabled synced:', enabled);
    } catch (error) {
      console.error('Failed to sync sound enabled:', error);
    }
  }, []);

  return { 
    syncAutoCopy,
    syncAutoPaste,
    syncSoundEnabled,
  };
}
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
          if (backendSettings.ui.overlay_treatment) {
            dispatch({ type: 'UPDATE_OVERLAY_TREATMENT', payload: backendSettings.ui.overlay_treatment });
          }
          
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

  // Save specific settings to backend when they change
  // We'll use individual watchers instead of watching the entire state
  // to avoid excessive saves
  
  // Auto-copy changes
  useEffect(() => {
    if (isInitialLoad.current) return;
    
    const syncAutoCopy = async () => {
      try {
        await invoke('set_auto_copy', { enabled: state.clipboard.autoCopy });
        console.log('Auto-copy synced:', state.clipboard.autoCopy);
      } catch (error) {
        console.error('Failed to sync auto-copy:', error);
      }
    };
    
    const timeoutId = setTimeout(syncAutoCopy, 300);
    return () => clearTimeout(timeoutId);
  }, [state.clipboard.autoCopy]);
  
  // Auto-paste changes
  useEffect(() => {
    if (isInitialLoad.current) return;
    
    const syncAutoPaste = async () => {
      try {
        await invoke('set_auto_paste', { enabled: state.clipboard.autoPaste });
        console.log('Auto-paste synced:', state.clipboard.autoPaste);
      } catch (error) {
        console.error('Failed to sync auto-paste:', error);
      }
    };
    
    const timeoutId = setTimeout(syncAutoPaste, 300);
    return () => clearTimeout(timeoutId);
  }, [state.clipboard.autoPaste]);
  
  // Sound enabled changes
  useEffect(() => {
    if (isInitialLoad.current) return;
    
    const syncSoundEnabled = async () => {
      try {
        await invoke('set_sound_enabled', { enabled: state.sound.soundEnabled });
        console.log('Sound enabled synced:', state.sound.soundEnabled);
      } catch (error) {
        console.error('Failed to sync sound enabled:', error);
      }
    };
    
    const timeoutId = setTimeout(syncSoundEnabled, 300);
    return () => clearTimeout(timeoutId);
  }, [state.sound.soundEnabled]);

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
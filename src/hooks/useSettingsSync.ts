import { useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSettings } from '../contexts/SettingsContext';

/**
 * Simplified hook to load settings from backend on mount
 * Settings are saved directly when UI components change them
 */
export function useSettingsSync() {
  const { dispatch } = useSettings();

  // Load settings from backend once on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const backendSettings = await invoke<any>('get_settings');
        console.log('Loading settings from backend:', backendSettings);
        
        // Update frontend state with backend settings
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
        }
        
        // LLM settings
        if (backendSettings.llm) {
          dispatch({ type: 'UPDATE_LLM_SETTINGS', payload: backendSettings.llm });
        }
      } catch (error) {
        console.error('Failed to load settings from backend:', error);
      }
    };

    loadSettings();
  }, [dispatch]);

  // Provide sync functions that components can call directly when they change settings
  const syncAutoCopy = useCallback(async (enabled: boolean) => {
    try {
      await invoke('set_auto_copy', { enabled });
    } catch (error) {
      console.error('Failed to sync auto-copy:', error);
    }
  }, []);

  const syncAutoPaste = useCallback(async (enabled: boolean) => {
    try {
      await invoke('set_auto_paste', { enabled });
    } catch (error) {
      console.error('Failed to sync auto-paste:', error);
    }
  }, []);

  const syncSoundEnabled = useCallback(async (enabled: boolean) => {
    try {
      await invoke('set_sound_enabled', { enabled });
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
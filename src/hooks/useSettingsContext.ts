import { useSettings as useSettingsContextHook } from '../contexts/SettingsContext';
import { useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { LLMSettings } from '../types/llm';
import { ThemeVariant } from '../themes/types';

/**
 * Bridge hook that adapts the new SettingsContext to match the existing useSettings API
 * This ensures backward compatibility while using the new context-based architecture
 */
export function useSettings() {
  const { state, actions } = useSettingsContextHook();

  // Load settings from backend on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        // Load overlay position
        const savedPosition = localStorage.getItem('scout-overlay-position');
        if (savedPosition) {
          actions.updateOverlayPosition(savedPosition as any);
          invoke('set_overlay_position', { position: savedPosition }).catch(console.error);
        } else {
          const pos = await invoke<string>('get_overlay_position');
          actions.updateOverlayPosition(pos as any);
        }

        // Load keyboard shortcuts
        const backendShortcut = await invoke<string>('get_current_shortcut');
        actions.updateHotkey(backendShortcut);
        localStorage.setItem('scout-hotkey', backendShortcut);

        const pushToTalkShortcut = await invoke<string>('get_push_to_talk_shortcut');
        actions.updatePushToTalkHotkey(pushToTalkShortcut);
        localStorage.setItem('scout-push-to-talk-hotkey', pushToTalkShortcut);

        // Load theme preference
        const savedTheme = localStorage.getItem('scout-theme');
        if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system') {
          actions.updateTheme(savedTheme);
        }

        // Load selected theme variant
        const savedSelectedTheme = localStorage.getItem('scout-selected-theme');
        if (savedSelectedTheme) {
          actions.updateSelectedTheme(savedSelectedTheme as ThemeVariant);
        }

        // Load overlay treatment
        const savedOverlayTreatment = localStorage.getItem('scout-overlay-treatment');
        if (savedOverlayTreatment) {
          actions.updateOverlayTreatment(savedOverlayTreatment as any);
          invoke('set_overlay_treatment', { treatment: savedOverlayTreatment }).catch(console.error);
        } else {
          invoke('set_overlay_treatment', { treatment: 'particles' }).catch(console.error);
        }

        // Load sound settings
        const soundEnabled = await invoke<boolean>('is_sound_enabled');
        if (!soundEnabled && state.sound.soundEnabled) {
          actions.toggleSoundEnabled();
        } else if (soundEnabled && !state.sound.soundEnabled) {
          actions.toggleSoundEnabled();
        }

        const soundSettings = await invoke<{ startSound: string; stopSound: string; successSound: string }>('get_sound_settings');
        actions.updateStartSound(soundSettings.startSound);
        actions.updateStopSound(soundSettings.stopSound);
        actions.updateSuccessSound(soundSettings.successSound);

        // Load general settings
        const settings = await invoke<any>('get_settings');
        if (settings?.ui?.completion_sound_threshold_ms) {
          actions.updateCompletionSoundThreshold(settings.ui.completion_sound_threshold_ms);
        }
        if (settings?.llm) {
          actions.updateLLMSettings({
            enabled: settings.llm.enabled || false,
            model_id: settings.llm.model_id || 'tinyllama-1.1b',
            temperature: settings.llm.temperature || 0.7,
            max_tokens: settings.llm.max_tokens || 200,
            auto_download_model: settings.llm.auto_download_model || false,
            enabled_prompts: settings.llm.enabled_prompts || ['summarize', 'bullet_points', 'action_items', 'fix_grammar']
          });
        }

        // Load clipboard settings
        const [copyEnabled, pasteEnabled] = await Promise.all([
          invoke<boolean>('is_auto_copy_enabled'),
          invoke<boolean>('is_auto_paste_enabled')
        ]);
        if (copyEnabled !== state.clipboard.autoCopy) {
          actions.toggleAutoCopy();
        }
        if (pasteEnabled !== state.clipboard.autoPaste) {
          actions.toggleAutoPaste();
        }

        // Mark as initialized
        if (!localStorage.getItem('scout-initialized')) {
          localStorage.setItem('scout-initialized', 'true');
        }
      } catch (error) {
        console.error('Failed to load settings:', error);
      }
    };

    loadSettings();
  }, []); // Only run once on mount

  // Enhanced update functions that sync with backend
  const updateOverlayPosition = useCallback(async (position: string) => {
    actions.updateOverlayPosition(position as any);
    localStorage.setItem('scout-overlay-position', position);
    try {
      await invoke('set_overlay_position', { position });
    } catch (error) {
      console.error('Failed to update overlay position:', error);
    }
  }, [actions]);

  const updateTheme = useCallback((newTheme: 'light' | 'dark' | 'system') => {
    actions.updateTheme(newTheme);
    localStorage.setItem('scout-theme', newTheme);
  }, [actions]);

  const updateSelectedTheme = useCallback((themeVariant: ThemeVariant) => {
    actions.updateSelectedTheme(themeVariant);
    localStorage.setItem('scout-selected-theme', themeVariant);
  }, [actions]);

  const updateOverlayTreatment = useCallback(async (treatment: string) => {
    actions.updateOverlayTreatment(treatment as any);
    localStorage.setItem('scout-overlay-treatment', treatment);
    try {
      await invoke('set_overlay_treatment', { treatment });
    } catch (error) {
      console.error('Failed to update overlay treatment:', error);
    }
  }, [actions]);

  const toggleSoundEnabled = useCallback(async () => {
    actions.toggleSoundEnabled();
    try {
      await invoke('set_sound_enabled', { enabled: !state.sound.soundEnabled });
    } catch (error) {
      console.error('Failed to update sound enabled:', error);
    }
  }, [actions, state.sound.soundEnabled]);

  const updateStartSound = useCallback(async (sound: string) => {
    actions.updateStartSound(sound);
    try {
      await invoke('set_start_sound', { sound });
    } catch (error) {
      console.error('Failed to update start sound:', error);
    }
  }, [actions]);

  const updateStopSound = useCallback(async (sound: string) => {
    actions.updateStopSound(sound);
    try {
      await invoke('set_stop_sound', { sound });
    } catch (error) {
      console.error('Failed to update stop sound:', error);
    }
  }, [actions]);

  const updateSuccessSound = useCallback(async (sound: string) => {
    actions.updateSuccessSound(sound);
    try {
      await invoke('set_success_sound', { sound });
    } catch (error) {
      console.error('Failed to update success sound:', error);
    }
  }, [actions]);

  const updateCompletionSoundThreshold = useCallback(async (threshold: number) => {
    actions.updateCompletionSoundThreshold(threshold);
    try {
      await invoke('update_completion_sound_threshold', { thresholdMs: threshold });
    } catch (error) {
      console.error('Failed to update completion sound threshold:', error);
    }
  }, [actions]);

  const updateLLMSettings = useCallback(async (updates: Partial<LLMSettings>) => {
    actions.updateLLMSettings(updates);
    try {
      await invoke('update_llm_settings', { settings: { ...state.llm, ...updates } });
    } catch (error) {
      console.error('Failed to update LLM settings:', error);
    }
  }, [actions, state.llm]);

  const toggleAutoCopy = useCallback(async () => {
    actions.toggleAutoCopy();
    try {
      await invoke('set_auto_copy_enabled', { enabled: !state.clipboard.autoCopy });
    } catch (error) {
      console.error('Failed to update auto-copy:', error);
    }
  }, [actions, state.clipboard.autoCopy]);

  const toggleAutoPaste = useCallback(async () => {
    actions.toggleAutoPaste();
    try {
      await invoke('set_auto_paste_enabled', { enabled: !state.clipboard.autoPaste });
    } catch (error) {
      console.error('Failed to update auto-paste:', error);
    }
  }, [actions, state.clipboard.autoPaste]);

  // Return API matching the existing useSettings hook
  return {
    // State
    overlayPosition: state.ui.overlayPosition,
    overlayTreatment: state.ui.overlayTreatment,
    hotkey: state.shortcuts.hotkey,
    pushToTalkHotkey: state.shortcuts.pushToTalkHotkey,
    theme: state.ui.theme,
    selectedTheme: state.ui.selectedTheme,
    soundEnabled: state.sound.soundEnabled,
    startSound: state.sound.startSound,
    stopSound: state.sound.stopSound,
    successSound: state.sound.successSound,
    completionSoundThreshold: state.sound.completionSoundThreshold,
    llmSettings: state.llm,
    autoCopy: state.clipboard.autoCopy,
    autoPaste: state.clipboard.autoPaste,
    
    // Setters (for hotkey capture)
    setHotkey: actions.updateHotkey,
    setPushToTalkHotkey: actions.updatePushToTalkHotkey,
    
    // Update functions
    updateOverlayPosition,
    updateOverlayTreatment,
    updateTheme,
    updateSelectedTheme,
    toggleSoundEnabled,
    updateStartSound,
    updateStopSound,
    updateSuccessSound,
    updateCompletionSoundThreshold,
    updateLLMSettings,
    toggleAutoCopy,
    toggleAutoPaste,
    
    // Convenience method for theme provider
    settings: {
      overlayPosition: state.ui.overlayPosition,
      overlayTreatment: state.ui.overlayTreatment,
      hotkey: state.shortcuts.hotkey,
      pushToTalkHotkey: state.shortcuts.pushToTalkHotkey,
      theme: state.ui.theme,
      selectedTheme: state.ui.selectedTheme,
      soundEnabled: state.sound.soundEnabled,
      startSound: state.sound.startSound,
      stopSound: state.sound.stopSound,
      successSound: state.sound.successSound,
      completionSoundThreshold: state.sound.completionSoundThreshold,
      llmSettings: state.llm,
      autoCopy: state.clipboard.autoCopy,
      autoPaste: state.clipboard.autoPaste,
    },
    updateSettings: (updates: Partial<any>) => {
      // Simple update wrapper for compatibility
      Object.entries(updates).forEach(([key, value]) => {
        if (key === 'selectedTheme' && value) {
          updateSelectedTheme(value as ThemeVariant);
        }
      });
    },
  };
}
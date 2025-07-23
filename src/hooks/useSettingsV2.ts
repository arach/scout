import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { LLMSettings } from '../types/llm';
import { ThemeVariant } from '../themes/types';

interface SettingsV2 {
  // UI Settings
  overlayPosition: string;
  hotkey: string;
  pushToTalkHotkey: string;
  theme: 'light' | 'dark' | 'system';
  selectedTheme?: ThemeVariant;
  
  // Sound Settings
  soundEnabled: boolean;
  startSound: string;
  stopSound: string;
  successSound: string;
  completionSoundThreshold: number;
  
  // LLM Settings
  llmSettings: LLMSettings;
  
  // Clipboard Settings
  autoCopy: boolean;
  autoPaste: boolean;
  
  // New overlay settings
  overlayOpacity?: number;
  overlayFontSize?: number;
  overlayCompact?: boolean;
}

const defaultSettings: SettingsV2 = {
  overlayPosition: 'top-center',
  hotkey: 'CmdOrCtrl+Shift+Space',
  pushToTalkHotkey: 'CmdOrCtrl+Shift+P',
  theme: 'system',
  soundEnabled: true,
  startSound: 'Glass',
  stopSound: 'Glass',
  successSound: 'Pop',
  completionSoundThreshold: 1000,
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
  overlayOpacity: 0.8,
  overlayFontSize: 13,
  overlayCompact: false,
};

export function useSettingsV2() {
  const [settings, setSettings] = useState<SettingsV2>(defaultSettings);
  const [isLoading, setIsLoading] = useState(true);

  // Load all settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        // Load from localStorage first (faster)
        const savedSettings = localStorage.getItem('scout-settings-v2');
        if (savedSettings) {
          const parsed = JSON.parse(savedSettings);
          setSettings({ ...defaultSettings, ...parsed });
        }

        // Then sync with backend
        const backendSettings = await loadBackendSettings();
        const merged = { ...defaultSettings, ...settings, ...backendSettings };
        setSettings(merged);
        localStorage.setItem('scout-settings-v2', JSON.stringify(merged));
      } catch (error) {
        console.error('Failed to load settings:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadSettings();
  }, []);

  // Load settings from backend
  const loadBackendSettings = async (): Promise<Partial<SettingsV2>> => {
    const result: Partial<SettingsV2> = {};

    try {
      // Load keyboard shortcuts
      const [shortcut, pttShortcut] = await Promise.all([
        invoke<string>('get_current_shortcut').catch(() => null),
        invoke<string>('get_push_to_talk_shortcut').catch(() => null),
      ]);
      
      if (shortcut) result.hotkey = shortcut;
      if (pttShortcut) result.pushToTalkHotkey = pttShortcut;

      // Load sound settings
      const [soundEnabled, soundSettings] = await Promise.all([
        invoke<boolean>('is_sound_enabled').catch(() => true),
        invoke<{ startSound: string; stopSound: string; successSound: string }>('get_sound_settings').catch(() => null),
      ]);
      
      result.soundEnabled = soundEnabled;
      if (soundSettings) {
        result.startSound = soundSettings.startSound;
        result.stopSound = soundSettings.stopSound;
        result.successSound = soundSettings.successSound;
      }

      // Load other settings
      const generalSettings = await invoke<any>('get_settings').catch(() => null);
      if (generalSettings) {
        if (generalSettings.ui?.completion_sound_threshold_ms) {
          result.completionSoundThreshold = generalSettings.ui.completion_sound_threshold_ms;
        }
        if (generalSettings.llm) {
          result.llmSettings = {
            enabled: generalSettings.llm.enabled || false,
            model_id: generalSettings.llm.model_id || 'tinyllama-1.1b',
            temperature: generalSettings.llm.temperature || 0.7,
            max_tokens: generalSettings.llm.max_tokens || 200,
            auto_download_model: generalSettings.llm.auto_download_model || false,
            enabled_prompts: generalSettings.llm.enabled_prompts || defaultSettings.llmSettings.enabled_prompts,
          };
        }
      }

      // Load clipboard settings
      const [autoCopy, autoPaste] = await Promise.all([
        invoke<boolean>('is_auto_copy_enabled').catch(() => false),
        invoke<boolean>('is_auto_paste_enabled').catch(() => false),
      ]);
      
      result.autoCopy = autoCopy;
      result.autoPaste = autoPaste;

    } catch (error) {
      console.error('Error loading backend settings:', error);
    }

    return result;
  };

  // Generic update function
  const updateSettings = useCallback(async (updates: Partial<SettingsV2>) => {
    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);
    localStorage.setItem('scout-settings-v2', JSON.stringify(newSettings));

    // Sync specific settings to backend
    const promises: Promise<any>[] = [];

    if ('overlayPosition' in updates && updates.overlayPosition) {
      promises.push(invoke('set_overlay_position', { position: updates.overlayPosition }));
    }

    if ('soundEnabled' in updates && updates.soundEnabled !== undefined) {
      promises.push(invoke('set_sound_enabled', { enabled: updates.soundEnabled }));
    }

    if ('startSound' in updates && updates.startSound) {
      promises.push(invoke('set_start_sound', { sound: updates.startSound }));
    }

    if ('stopSound' in updates && updates.stopSound) {
      promises.push(invoke('set_stop_sound', { sound: updates.stopSound }));
    }

    if ('successSound' in updates && updates.successSound) {
      promises.push(invoke('set_success_sound', { sound: updates.successSound }));
    }

    if ('completionSoundThreshold' in updates && updates.completionSoundThreshold !== undefined) {
      promises.push(invoke('update_completion_sound_threshold', { thresholdMs: updates.completionSoundThreshold }));
    }

    if ('llmSettings' in updates && updates.llmSettings) {
      promises.push(invoke('update_llm_settings', { settings: updates.llmSettings }));
    }

    if ('autoCopy' in updates && updates.autoCopy !== undefined) {
      promises.push(invoke('set_auto_copy_enabled', { enabled: updates.autoCopy }));
    }

    if ('autoPaste' in updates && updates.autoPaste !== undefined) {
      promises.push(invoke('set_auto_paste_enabled', { enabled: updates.autoPaste }));
    }

    // Execute all backend updates in parallel
    await Promise.allSettled(promises);
  }, [settings]);

  // Convenience methods
  const updateTheme = useCallback((theme: 'light' | 'dark' | 'system') => {
    updateSettings({ theme });
  }, [updateSettings]);

  const setSelectedTheme = useCallback((selectedTheme: ThemeVariant) => {
    updateSettings({ selectedTheme });
  }, [updateSettings]);

  const toggleSoundEnabled = useCallback(() => {
    updateSettings({ soundEnabled: !settings.soundEnabled });
  }, [settings.soundEnabled, updateSettings]);

  const toggleAutoCopy = useCallback(() => {
    updateSettings({ autoCopy: !settings.autoCopy });
  }, [settings.autoCopy, updateSettings]);

  const toggleAutoPaste = useCallback(() => {
    updateSettings({ autoPaste: !settings.autoPaste });
  }, [settings.autoPaste, updateSettings]);

  return {
    settings,
    isLoading,
    updateSettings,
    
    // Legacy compatibility methods
    ...settings,
    setHotkey: (hotkey: string) => setSettings(s => ({ ...s, hotkey })),
    setPushToTalkHotkey: (pushToTalkHotkey: string) => setSettings(s => ({ ...s, pushToTalkHotkey })),
    
    updateOverlayPosition: (position: string) => updateSettings({ overlayPosition: position }),
    updateTheme,
    setSelectedTheme,
    toggleSoundEnabled,
    updateStartSound: (sound: string) => updateSettings({ startSound: sound }),
    updateStopSound: (sound: string) => updateSettings({ stopSound: sound }),
    updateSuccessSound: (sound: string) => updateSettings({ successSound: sound }),
    updateCompletionSoundThreshold: (threshold: number) => updateSettings({ completionSoundThreshold: threshold }),
    updateLLMSettings: (updates: Partial<LLMSettings>) => updateSettings({ llmSettings: { ...settings.llmSettings, ...updates } }),
    toggleAutoCopy,
    toggleAutoPaste,
  };
}
import { useState, useEffect } from 'react';
import { tauriApi } from '../types/tauri';
import { LLMSettings } from '../types/llm';
import type { ThemeVariant } from '../themes/types';

// Commented out unused interface
// interface Settings {
//   overlayPosition: string;
//   hotkey: string;
//   pushToTalkHotkey: string;
//   theme: 'light' | 'dark' | 'system';
//   soundEnabled: boolean;
//   startSound: string;
//   stopSound: string;
//   successSound: string;
//   completionSoundThreshold: number;
//   llmSettings: LLMSettings;
//   autoCopy: boolean;
//   autoPaste: boolean;
// }

export function useSettings() {
  // UI Settings
  const [overlayPosition, setOverlayPosition] = useState<string>('top-center');
  const [overlayTreatment, setOverlayTreatment] = useState<string>('particles'); // Default to particles
  const [hotkey, setHotkey] = useState("CmdOrCtrl+Shift+Space");
  const [pushToTalkHotkey, setPushToTalkHotkey] = useState("CmdOrCtrl+Shift+P");
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  const [selectedTheme, setSelectedTheme] = useState<ThemeVariant | undefined>(undefined);
  
  // Sound Settings
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [startSound, setStartSound] = useState('Glass');
  const [stopSound, setStopSound] = useState('Glass');
  const [successSound, setSuccessSound] = useState('Pop');
  const [completionSoundThreshold, setCompletionSoundThreshold] = useState(1000);
  
  // LLM Settings
  const [llmSettings, setLLMSettings] = useState<LLMSettings>({
    enabled: false,
    model_id: 'tinyllama-1.1b',
    temperature: 0.7,
    max_tokens: 200,
    auto_download_model: false,
    enabled_prompts: ['summarize', 'bullet_points', 'action_items', 'fix_grammar']
  });
  
  // Clipboard Settings
  const [autoCopy, setAutoCopy] = useState(false);
  const [autoPaste, setAutoPaste] = useState(false);

  // Initialize all settings from backend/localStorage
  useEffect(() => {
    const loadSettings = async () => {
      // Load overlay position
      const savedPosition = localStorage.getItem('scout-overlay-position');
      if (savedPosition) {
        setOverlayPosition(savedPosition);
        tauriApi.setOverlayPosition({ position: savedPosition }).catch(console.error);
      } else {
        // Get current position from backend
        try {
          const pos = await tauriApi.getOverlayPosition();
          setOverlayPosition(pos);
        } catch (error) {
          console.error('Failed to get overlay position:', error);
        }
      }
      
      // Load keyboard shortcuts
      try {
        const backendShortcut = await tauriApi.getCurrentShortcut();
        setHotkey(backendShortcut);
        localStorage.setItem('scout-hotkey', backendShortcut);
      } catch (err) {
        console.error('Failed to get current shortcut:', err);
        const savedHotkey = localStorage.getItem('scout-hotkey') || 'CmdOrCtrl+Shift+Space';
        setHotkey(savedHotkey);
      }
      
      try {
        const backendShortcut = await tauriApi.getPushToTalkShortcut();
        setPushToTalkHotkey(backendShortcut);
        localStorage.setItem('scout-push-to-talk-hotkey', backendShortcut);
      } catch (err) {
        console.error('Failed to get push-to-talk shortcut:', err);
        const savedHotkey = localStorage.getItem('scout-push-to-talk-hotkey') || 'CmdOrCtrl+Shift+P';
        setPushToTalkHotkey(savedHotkey);
      }
      
      // Load theme preference
      const savedTheme = localStorage.getItem('scout-theme');
      if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system') {
        setTheme(savedTheme);
      }
      
      // Load selected theme variant
      const savedSelectedTheme = localStorage.getItem('scout-selected-theme');
      if (savedSelectedTheme) {
        setSelectedTheme(savedSelectedTheme as ThemeVariant);
      }
      
      // Load overlay treatment
      const savedOverlayTreatment = localStorage.getItem('scout-overlay-treatment');
      if (savedOverlayTreatment) {
        setOverlayTreatment(savedOverlayTreatment);
        // Set the overlay treatment on the native overlay
        tauriApi.setOverlayTreatment({ treatment: savedOverlayTreatment }).catch(console.error);
      } else {
        // Set default treatment
        tauriApi.setOverlayTreatment({ treatment: 'particles' }).catch(console.error);
      }
      
      // Load sound settings
      try {
        const enabled = await tauriApi.isSoundEnabled();
        setSoundEnabled(enabled);
      } catch (error) {
        console.error('Failed to get sound enabled state:', error);
      }
      
      try {
        const settings = await tauriApi.getSoundSettings();
        setStartSound(settings.startSound);
        setStopSound(settings.stopSound);
        setSuccessSound(settings.successSound);
      } catch (error) {
        console.error('Failed to get sound settings:', error);
      }
      
      // Load general settings from backend
      try {
        const settings = await tauriApi.getSettings();
        if (settings?.ui?.completion_sound_threshold_ms) {
          setCompletionSoundThreshold(settings.ui.completion_sound_threshold_ms);
        }
        if (settings?.llm) {
          setLLMSettings({
            enabled: settings.llm.enabled || false,
            model_id: settings.llm.model_id || 'tinyllama-1.1b',
            temperature: settings.llm.temperature || 0.7,
            max_tokens: settings.llm.max_tokens || 200,
            auto_download_model: settings.llm.auto_download_model || false,
            enabled_prompts: settings.llm.enabled_prompts || ['summarize', 'bullet_points', 'action_items', 'fix_grammar']
          });
        }
      } catch (error) {
        console.error('Failed to get settings:', error);
      }
      
      // Load clipboard settings
      try {
        const [copyEnabled, pasteEnabled] = await Promise.all([
          tauriApi.isAutoCopyEnabled(),
          tauriApi.isAutoPasteEnabled()
        ]);
        setAutoCopy(copyEnabled);
        setAutoPaste(pasteEnabled);
      } catch (error) {
        console.error('Failed to load clipboard settings:', error);
      }
      
      // Mark as initialized
      if (!localStorage.getItem('scout-initialized')) {
        localStorage.setItem('scout-initialized', 'true');
      }
    };
    
    loadSettings();
  }, []);

  // Update functions that also sync with backend
  const updateOverlayPosition = async (position: string) => {
    setOverlayPosition(position);
    localStorage.setItem('scout-overlay-position', position);
    try {
      await tauriApi.setOverlayPosition({ position });
    } catch (error) {
      console.error('Failed to update overlay position:', error);
    }
  };

  const updateTheme = (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme);
    localStorage.setItem('scout-theme', newTheme);
  };

  const updateSelectedTheme = (themeVariant: ThemeVariant) => {
    setSelectedTheme(themeVariant);
    localStorage.setItem('scout-selected-theme', themeVariant);
  };

  const updateOverlayTreatment = async (treatment: string) => {
    setOverlayTreatment(treatment);
    localStorage.setItem('scout-overlay-treatment', treatment);
    try {
      await tauriApi.setOverlayTreatment({ treatment });
    } catch (error) {
      console.error('Failed to update overlay treatment:', error);
    }
  };

  const toggleSoundEnabled = async () => {
    const newValue = !soundEnabled;
    setSoundEnabled(newValue);
    try {
      await tauriApi.setSoundEnabled({ enabled: newValue });
    } catch (error) {
      console.error('Failed to update sound enabled:', error);
    }
  };

  const updateStartSound = async (sound: string) => {
    setStartSound(sound);
    try {
      await tauriApi.setStartSound({ sound });
    } catch (error) {
      console.error('Failed to update start sound:', error);
    }
  };

  const updateStopSound = async (sound: string) => {
    setStopSound(sound);
    try {
      await tauriApi.setStopSound({ sound });
    } catch (error) {
      console.error('Failed to update stop sound:', error);
    }
  };

  const updateSuccessSound = async (sound: string) => {
    setSuccessSound(sound);
    try {
      await tauriApi.setSuccessSound({ sound });
    } catch (error) {
      console.error('Failed to update success sound:', error);
    }
  };

  const updateCompletionSoundThreshold = async (threshold: number) => {
    setCompletionSoundThreshold(threshold);
    try {
      await tauriApi.updateCompletionSoundThreshold({ thresholdMs: threshold });
    } catch (error) {
      console.error('Failed to update completion sound threshold:', error);
    }
  };

  const updateLLMSettings = async (updates: Partial<LLMSettings>) => {
    const newSettings = { ...llmSettings, ...updates };
    setLLMSettings(newSettings);
    try {
      await tauriApi.updateLLMSettings({ settings: newSettings });
    } catch (error) {
      console.error('Failed to update LLM settings:', error);
    }
  };

  const toggleAutoCopy = async () => {
    const newValue = !autoCopy;
    setAutoCopy(newValue);
    try {
      await tauriApi.setAutoCopyEnabled({ enabled: newValue });
    } catch (error) {
      console.error('Failed to update auto-copy:', error);
    }
  };

  const toggleAutoPaste = async () => {
    const newValue = !autoPaste;
    setAutoPaste(newValue);
    try {
      await tauriApi.setAutoPasteEnabled({ enabled: newValue });
    } catch (error) {
      console.error('Failed to update auto-paste:', error);
    }
  };

  return {
    // State
    overlayPosition,
    overlayTreatment,
    hotkey,
    pushToTalkHotkey,
    theme,
    selectedTheme,
    soundEnabled,
    startSound,
    stopSound,
    successSound,
    completionSoundThreshold,
    llmSettings,
    autoCopy,
    autoPaste,
    
    // Setters (for hotkey capture)
    setHotkey,
    setPushToTalkHotkey,
    
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
      overlayPosition,
      overlayTreatment,
      hotkey,
      pushToTalkHotkey,
      theme,
      selectedTheme,
      soundEnabled,
      startSound,
      stopSound,
      successSound,
      completionSoundThreshold,
      llmSettings,
      autoCopy,
      autoPaste,
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
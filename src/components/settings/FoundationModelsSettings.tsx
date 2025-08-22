import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface FoundationModelsSettingsProps {
  onSettingsChange?: () => void;
}

type ProcessingMode = 'enhance' | 'clean' | 'minimal';
type AggressivenessLevel = 'conservative' | 'moderate' | 'aggressive';
type AutoProcessingMode = 'always' | 'long_only' | 'manual';

interface FoundationModelsSettings {
  enabled: boolean;
  processing_mode: ProcessingMode;
  temperature: number;
  aggressiveness: AggressivenessLevel;
  auto_processing: AutoProcessingMode;
  min_words_for_auto: number;
}

export const FoundationModelsSettings: React.FC<FoundationModelsSettingsProps> = ({
  onSettingsChange,
}) => {
  const [isAvailable, setIsAvailable] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [settings, setSettings] = useState<FoundationModelsSettings>({
    enabled: false,
    processing_mode: 'enhance',
    temperature: 0.1,
    aggressiveness: 'moderate',
    auto_processing: 'always',
    min_words_for_auto: 10,
  });
  
  const [testText, setTestText] = useState<string>('');
  const [enhancedText, setEnhancedText] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // Check Foundation Models availability on component mount
  useEffect(() => {
    checkFoundationModelsAvailability();
    loadSettings();
  }, []);

  const checkFoundationModelsAvailability = async () => {
    try {
      const available = await invoke<boolean>('check_foundation_models_availability');
      setIsAvailable(available);
    } catch (error) {
      console.error('Failed to check Foundation Models availability:', error);
      setIsAvailable(false);
    } finally {
      setIsLoading(false);
    }
  };

  const loadSettings = async () => {
    try {
      const appSettings = await invoke<any>('get_settings');
      setSettings({
        enabled: appSettings.ui.foundation_models_enabled || false,
        processing_mode: appSettings.ui.foundation_models_mode || 'enhance',
        temperature: appSettings.ui.foundation_models_temperature || 0.1,
        aggressiveness: appSettings.ui.foundation_models_aggressiveness || 'moderate',
        auto_processing: appSettings.ui.foundation_models_auto_processing || 'always',
        min_words_for_auto: appSettings.ui.foundation_models_min_words || 10,
      });
    } catch (error) {
      console.error('Failed to load Foundation Models settings:', error);
    }
  };

  const updateSetting = async <K extends keyof FoundationModelsSettings>(
    key: K,
    value: FoundationModelsSettings[K]
  ) => {
    try {
      const appSettings = await invoke<any>('get_settings');
      
      // Map our settings to the backend settings structure
      const settingKey = `foundation_models_${key}`;
      if (key === 'enabled') {
        appSettings.ui.foundation_models_enabled = value;
      } else {
        appSettings.ui[settingKey] = value;
      }
      
      await invoke('update_settings', { newSettings: appSettings });
      
      setSettings(prev => ({ ...prev, [key]: value }));
      onSettingsChange?.();
    } catch (error) {
      console.error('Failed to update Foundation Models setting:', error);
    }
  };

  const handleTestEnhancement = async () => {
    if (!testText.trim()) return;

    setIsProcessing(true);
    try {
      let result: string;

      switch (settings.processing_mode) {
        case 'clean':
          result = await invoke<string>('clean_speech_patterns', { text: testText });
          break;
        case 'minimal':
          // For minimal mode, we could add a special command or use enhance with different params
          result = await invoke<string>('enhance_transcript', { text: testText });
          break;
        case 'enhance':
        default:
          result = await invoke<string>('enhance_transcript', { text: testText });
          break;
      }
      
      setEnhancedText(result);
    } catch (error) {
      console.error('Enhancement failed:', error);
      setEnhancedText(`Error: ${error}`);
    } finally {
      setIsProcessing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 border rounded-lg bg-gray-50 dark:bg-gray-800">
        <div className="flex items-center space-x-2">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            Checking Foundation Models availability...
          </span>
        </div>
      </div>
    );
  }

  // Don't render anything if Foundation Models isn't available
  if (!isAvailable) {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Main Toggle */}
      <div className="flex items-center justify-between p-4 border rounded-lg bg-white dark:bg-gray-800">
        <div>
          <h4 className="text-lg font-medium text-gray-900 dark:text-white">
            Foundation Models Enhancement
          </h4>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Automatically improve transcription quality using Apple's on-device AI
          </p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={settings.enabled}
            onChange={(e) => updateSetting('enabled', e.target.checked)}
          />
          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
        </label>
      </div>

      {settings.enabled && (
        <>
          {/* Processing Mode */}
          <div className="p-4 border rounded-lg bg-white dark:bg-gray-800">
            <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
              Processing Mode
            </h4>
            <div className="space-y-2">
              {[
                { value: 'enhance', label: 'Enhance', desc: 'Full grammar, punctuation, and cleanup' },
                { value: 'clean', label: 'Clean Speech', desc: 'Focus on removing filler words' },
                { value: 'minimal', label: 'Minimal', desc: 'Light touch, preserve original style' },
              ].map((mode) => (
                <label key={mode.value} className="flex items-start space-x-3 cursor-pointer">
                  <input
                    type="radio"
                    name="processing_mode"
                    value={mode.value}
                    checked={settings.processing_mode === mode.value}
                    onChange={(e) => updateSetting('processing_mode', e.target.value as ProcessingMode)}
                    className="mt-1 text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-white">
                      {mode.label}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {mode.desc}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Temperature Control */}
          <div className="p-4 border rounded-lg bg-white dark:bg-gray-800">
            <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
              Creativity Level: {settings.temperature}
            </h4>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={settings.temperature}
              onChange={(e) => updateSetting('temperature', parseFloat(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
            />
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
              <span>More Consistent</span>
              <span>More Creative</span>
            </div>
          </div>

          {/* Auto-processing Settings */}
          <div className="p-4 border rounded-lg bg-white dark:bg-gray-800">
            <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
              Auto-processing
            </h4>
            <div className="space-y-3">
              <select
                value={settings.auto_processing}
                onChange={(e) => updateSetting('auto_processing', e.target.value as AutoProcessingMode)}
                className="w-full p-2 border rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="always">Always process transcripts</option>
                <option value="long_only">Only long transcripts</option>
                <option value="manual">Manual processing only</option>
              </select>

              {settings.auto_processing === 'long_only' && (
                <div>
                  <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                    Minimum words for auto-processing: {settings.min_words_for_auto}
                  </label>
                  <input
                    type="range"
                    min="5"
                    max="50"
                    value={settings.min_words_for_auto}
                    onChange={(e) => updateSetting('min_words_for_auto', parseInt(e.target.value))}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Test Interface */}
          <div className="p-4 border rounded-lg bg-white dark:bg-gray-800">
            <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
              Test Enhancement
            </h4>
            
            <div className="space-y-3">
              <textarea
                value={testText}
                onChange={(e) => setTestText(e.target.value)}
                placeholder="um so basically I think we need to uh maybe look at the you know the system and like figure out what's going wrong"
                className="w-full p-3 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                rows={3}
              />

              <button
                onClick={handleTestEnhancement}
                disabled={!testText.trim() || isProcessing}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {isProcessing ? 'Processing...' : 'Test Enhancement'}
              </button>

              {enhancedText && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Result:
                  </label>
                  <div className="p-3 border rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600">
                    {enhancedText}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
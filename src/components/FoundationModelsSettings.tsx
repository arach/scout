import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/tauri';

interface FoundationModelsConfig {
  enable_enhancement: boolean;
  enable_summarization: boolean;
  enable_structured_output: boolean;
  temperature: number;
  max_length: number;
}

interface FoundationModelsSettingsProps {
  onSettingsChange?: () => void;
}

export const FoundationModelsSettings: React.FC<FoundationModelsSettingsProps> = ({
  onSettingsChange,
}) => {
  const [isAvailable, setIsAvailable] = useState<boolean>(false);
  const [isEnabled, setIsEnabled] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
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
      const settings = await invoke<any>('get_settings');
      setIsEnabled(settings.ui.foundation_models_enabled || false);
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const handleEnableToggle = async (enabled: boolean) => {
    try {
      // Update the setting
      const settings = await invoke<any>('get_settings');
      settings.ui.foundation_models_enabled = enabled;
      await invoke('update_settings', { settings });
      
      setIsEnabled(enabled);
      onSettingsChange?.();
    } catch (error) {
      console.error('Failed to update Foundation Models setting:', error);
    }
  };

  const handleTestEnhancement = async () => {
    if (!testText.trim()) return;

    setIsProcessing(true);
    try {
      const result = await invoke<string>('enhance_transcript', {
        text: testText,
        config: {
          enable_enhancement: true,
          enable_summarization: false,
          enable_structured_output: false,
          temperature: 0.1,
          max_length: 2000,
        } as FoundationModelsConfig,
      });
      setEnhancedText(result);
    } catch (error) {
      console.error('Enhancement failed:', error);
      setEnhancedText(`Error: ${error}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCleanSpeech = async () => {
    if (!testText.trim()) return;

    setIsProcessing(true);
    try {
      const result = await invoke<string>('clean_speech_patterns', {
        text: testText,
        config: {
          enable_enhancement: true,
          enable_summarization: false,
          enable_structured_output: false,
          temperature: 0.1,
          max_length: 2000,
        } as FoundationModelsConfig,
      });
      setEnhancedText(result);
    } catch (error) {
      console.error('Speech cleaning failed:', error);
      setEnhancedText(`Error: ${error}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSummarize = async () => {
    if (!testText.trim()) return;

    setIsProcessing(true);
    try {
      const result = await invoke<string>('summarize_transcript', {
        text: testText,
        maxSentences: 3,
        config: {
          enable_enhancement: false,
          enable_summarization: true,
          enable_structured_output: false,
          temperature: 0.3,
          max_length: 2000,
        } as FoundationModelsConfig,
      });
      setEnhancedText(result);
    } catch (error) {
      console.error('Summarization failed:', error);
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

  if (!isAvailable) {
    return (
      <div className="p-4 border rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800">
        <div className="flex items-start space-x-3">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
              Foundation Models Not Available
            </h3>
            <div className="mt-2 text-sm text-yellow-700 dark:text-yellow-300">
              <p>
                Foundation Models requires macOS 14.0 or later and may not be available in all regions.
              </p>
              <p className="mt-1">
                To use this feature, ensure you have:
              </p>
              <ul className="mt-1 list-disc list-inside">
                <li>macOS Sonoma (14.0) or later</li>
                <li>English language locale</li>
                <li>The Swift helper binary built (run <code className="bg-yellow-100 dark:bg-yellow-800 px-1 rounded">make build-swift-helpers</code>)</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Main Toggle */}
      <div className="flex items-center justify-between p-4 border rounded-lg bg-white dark:bg-gray-800">
        <div>
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">
            Foundation Models Enhancement
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Automatically improve transcription quality using Apple's on-device AI
          </p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={isEnabled}
            onChange={(e) => handleEnableToggle(e.target.checked)}
          />
          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
        </label>
      </div>

      {/* Feature Description */}
      {isEnabled && (
        <div className="p-4 border rounded-lg bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
          <h4 className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">
            What Foundation Models Enhancement Does:
          </h4>
          <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
            <li>• Adds proper punctuation and capitalization</li>
            <li>• Fixes grammar and sentence structure</li>
            <li>• Removes excessive filler words (um, uh, like)</li>
            <li>• Maintains original meaning and tone</li>
            <li>• Processes locally on your device for privacy</li>
          </ul>
        </div>
      )}

      {/* Test Interface */}
      {isEnabled && (
        <div className="p-4 border rounded-lg bg-white dark:bg-gray-800">
          <h4 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
            Test Foundation Models
          </h4>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Sample Text (try some speech with filler words):
              </label>
              <textarea
                value={testText}
                onChange={(e) => setTestText(e.target.value)}
                placeholder="um so basically I think we need to uh maybe look at the you know the system and like figure out what's going wrong"
                className="w-full p-3 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                rows={3}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleTestEnhancement}
                disabled={!testText.trim() || isProcessing}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {isProcessing ? 'Processing...' : 'Enhance Text'}
              </button>
              
              <button
                onClick={handleCleanSpeech}
                disabled={!testText.trim() || isProcessing}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {isProcessing ? 'Processing...' : 'Clean Speech'}
              </button>
              
              <button
                onClick={handleSummarize}
                disabled={!testText.trim() || isProcessing}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {isProcessing ? 'Processing...' : 'Summarize'}
              </button>
            </div>

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
      )}
    </div>
  );
};
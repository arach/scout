import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChevronDown, Sparkles, Settings } from 'lucide-react';
import { LLMModelManager } from './LLMModelManager';
import { LLMSettings as LLMSettingsType, LLMPromptTemplate } from '../types/llm';
import './LLMSettings.css';

interface LLMSettingsProps {
  settings: LLMSettingsType;
  onUpdateSettings: (settings: Partial<LLMSettingsType>) => void;
}

export const LLMSettings: React.FC<LLMSettingsProps> = ({ settings, onUpdateSettings }) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [promptTemplates, setPromptTemplates] = useState<LLMPromptTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);

  useEffect(() => {
    loadPromptTemplates();
  }, []);

  const loadPromptTemplates = async () => {
    try {
      const templates = await invoke<LLMPromptTemplate[]>('get_llm_prompt_templates');
      setPromptTemplates(templates);
    } catch (error) {
      console.error('Failed to load prompt templates:', error);
    } finally {
      setLoadingTemplates(false);
    }
  };

  const togglePrompt = (promptId: string) => {
    const newEnabledPrompts = settings.enabled_prompts.includes(promptId)
      ? settings.enabled_prompts.filter(id => id !== promptId)
      : [...settings.enabled_prompts, promptId];
    
    onUpdateSettings({ enabled_prompts: newEnabledPrompts });
  };

  const groupedTemplates = promptTemplates.reduce((acc, template) => {
    if (!acc[template.category]) {
      acc[template.category] = [];
    }
    acc[template.category].push(template);
    return acc;
  }, {} as Record<string, LLMPromptTemplate[]>);

  return (
    <div className="llm-settings">
      {/* Main Toggle */}
      <div className="llm-setting-item">
        <div className="llm-toggle-container">
          <span className="llm-toggle-label">Enable AI Post-Processing</span>
          <div className="toggle-switch">
            <input
              type="checkbox"
              id="llm-enable-toggle"
              checked={settings.enabled}
              onChange={(e) => onUpdateSettings({ enabled: e.target.checked })}
            />
            <span className="toggle-switch-slider"></span>
          </div>
        </div>
      </div>

      {/* Model Selection */}
      <div className="llm-setting-section">
        <h4 className="llm-section-title">
          <Sparkles size={16} />
          AI Models
        </h4>
        <LLMModelManager />
      </div>

      {settings.enabled && (
        <>
          {/* Prompt Templates */}
          <div className="llm-setting-section">
            <h4 className="llm-section-title">Enabled Prompts</h4>
            {loadingTemplates ? (
            <div className="llm-loading">Loading prompts...</div>
          ) : (
            <div className="llm-prompt-categories">
              {Object.entries(groupedTemplates).map(([category, templates]) => (
                <div key={category} className="llm-prompt-category">
                  <h5 className="llm-category-title">
                    {category.charAt(0).toUpperCase() + category.slice(1)}
                  </h5>
                  <div className="llm-prompts-list">
                    {templates.map(template => (
                      <label key={template.id} className="llm-prompt-item">
                        <input
                          type="checkbox"
                          checked={settings.enabled_prompts.includes(template.id)}
                          onChange={() => togglePrompt(template.id)}
                        />
                        <div className="llm-prompt-info">
                          <span className="llm-prompt-name">{template.name}</span>
                          {template.description && (
                            <span className="llm-prompt-description">{template.description}</span>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            )}
          </div>

          {/* Advanced Settings */}
          <div className="llm-setting-section">
          <button
            className="llm-advanced-toggle"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            <Settings size={16} />
            Advanced Settings
            <ChevronDown
              size={16}
              className={`llm-chevron ${showAdvanced ? 'expanded' : ''}`}
            />
          </button>

          {showAdvanced && (
            <div className="llm-advanced-settings">
              {/* Temperature */}
              <div className="llm-setting-item">
                <label htmlFor="llm-temperature">
                  Temperature
                  <span className="llm-value-display">{settings.temperature.toFixed(1)}</span>
                </label>
                <input
                  id="llm-temperature"
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={settings.temperature}
                  onChange={(e) => onUpdateSettings({ temperature: parseFloat(e.target.value) })}
                  className="llm-slider"
                />
                <p className="llm-setting-hint">
                  Controls creativity vs consistency. Lower values are more focused, higher values are more creative.
                </p>
              </div>

              {/* Max Tokens */}
              <div className="llm-setting-item">
                <label htmlFor="llm-max-tokens">
                  Max Response Length
                  <span className="llm-value-display">{settings.max_tokens} tokens</span>
                </label>
                <input
                  id="llm-max-tokens"
                  type="range"
                  min="50"
                  max="500"
                  step="50"
                  value={settings.max_tokens}
                  onChange={(e) => onUpdateSettings({ max_tokens: parseInt(e.target.value) })}
                  className="llm-slider"
                />
                <p className="llm-setting-hint">
                  Maximum length of AI responses. Longer responses take more time to generate.
                </p>
              </div>

              {/* Auto-download */}
              <div className="llm-setting-item">
                <label className="llm-toggle-label">
                  <input
                    type="checkbox"
                    checked={settings.auto_download_model}
                    onChange={(e) => onUpdateSettings({ auto_download_model: e.target.checked })}
                  />
                  <span>Auto-download models</span>
                </label>
                <p className="llm-setting-hint">
                  Automatically download AI models when needed
                </p>
              </div>
            </div>
          )}
        </div>
      </>
    )}
    </div>
  );
};
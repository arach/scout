import React, { memo, useState, useRef, useEffect, lazy, Suspense } from 'react';
import { Sparkles, FolderOpen, Brain } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useSettings } from '../contexts/SettingsContext';
import { ShortcutSettings } from './settings/ShortcutSettings';
import { ClipboardSettings } from './settings/ClipboardSettings';
import { SoundSettings } from './settings/SoundSettings';
import { UISettings } from './settings/UISettings';
import { DictionaryView } from './DictionaryView';
import './SettingsView.css';
import './SettingsView-spacing.css';
import '../styles/grid-system.css';

// Lazy load heavy components
const ModelManager = lazy(() => import('./ModelManager').then(module => ({ default: module.ModelManager })));
const LLMSettings = lazy(() => import('./LLMSettings').then(module => ({ default: module.LLMSettings })));

export const SettingsView = memo(function SettingsView() {
  const { state, actions } = useSettings();
  const [isModelManagerExpanded, setIsModelManagerExpanded] = useState(false);
  const [isLLMSettingsExpanded, setIsLLMSettingsExpanded] = useState(false);
  const [isDictionaryExpanded, setIsDictionaryExpanded] = useState(false);
  const modelSectionRef = useRef<HTMLDivElement>(null);
  const llmSectionRef = useRef<HTMLDivElement>(null);
  const dictionarySectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isModelManagerExpanded && modelSectionRef.current) {
      setTimeout(() => {
        modelSectionRef.current?.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'nearest'
        });
      }, 100);
    }
  }, [isModelManagerExpanded]);

  useEffect(() => {
    if (isLLMSettingsExpanded && llmSectionRef.current) {
      setTimeout(() => {
        llmSectionRef.current?.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'nearest'
        });
      }, 100);
    }
  }, [isLLMSettingsExpanded]);

  useEffect(() => {
    if (isDictionaryExpanded && dictionarySectionRef.current) {
      setTimeout(() => {
        dictionarySectionRef.current?.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'nearest'
        });
      }, 100);
    }
  }, [isDictionaryExpanded]);

  const openModelsFolder = async () => {
    try {
      await invoke('open_models_folder');
    } catch (error) {
      console.error('Failed to open models folder:', error);
    }
  };

  return (
    <div className="grid-container">
      <div className="grid-content grid-content--settings">
        <ShortcutSettings />
        <ClipboardSettings />
        <SoundSettings />
        <UISettings />

        {/* Model Manager - Full Width Collapsible */}
        <div className="settings-section model-manager-full-width" ref={modelSectionRef}>
          <div className="collapsible-section">
            <div className="collapsible-header-wrapper">
              <div 
                className="collapsible-header"
                onClick={() => setIsModelManagerExpanded(!isModelManagerExpanded)}
              >
                <div>
                  <h3>
                    <span className={`collapse-arrow ${isModelManagerExpanded ? 'expanded' : ''}`}>
                      ▶
                    </span>
                    Transcription Models (AI) <Sparkles size={16} className="sparkle-icon" />
                  </h3>
                  <p className="collapsible-subtitle">
                    Download and manage AI models for transcription
                  </p>
                </div>
              </div>
              <button 
                className="open-models-folder-link"
                onClick={openModelsFolder}
                title="Add your own .bin model files here"
              >
                <FolderOpen size={12} />
                Open Models Folder
              </button>
            </div>
          </div>
          {isModelManagerExpanded && (
            <div className="collapsible-content">
              <Suspense fallback={<div>Loading model manager...</div>}>
                <ModelManager />
              </Suspense>
            </div>
          )}
        </div>

        {/* LLM Settings - Full Width Collapsible */}
        <div className="settings-section model-manager-full-width" ref={llmSectionRef}>
          <div className="collapsible-section">
            <div className="collapsible-header-wrapper">
              <div 
                className="collapsible-header"
                onClick={() => setIsLLMSettingsExpanded(!isLLMSettingsExpanded)}
              >
                <div>
                  <h3>
                    <span className={`collapse-arrow ${isLLMSettingsExpanded ? 'expanded' : ''}`}>
                      ▶
                    </span>
                    AI Processing
                    <span className="ai-badge">
                      (AI)
                      <Brain size={16} className="sparkle-icon" />
                    </span>
                  </h3>
                  <p className="collapsible-subtitle">
                    Enhance transcripts with summaries and insights
                  </p>
                </div>
              </div>
            </div>
          </div>
          {isLLMSettingsExpanded && (
            <div className="collapsible-content">
              <Suspense fallback={<div>Loading LLM settings...</div>}>
                <LLMSettings 
                  settings={state.llm}
                  onUpdateSettings={actions.updateLLMSettings}
                />
              </Suspense>
            </div>
          )}
        </div>

        {/* Dictionary - Full Width Collapsible */}
        <div className="settings-section model-manager-full-width" ref={dictionarySectionRef}>
          <DictionaryView 
            isExpanded={isDictionaryExpanded}
            onToggleExpand={() => setIsDictionaryExpanded(!isDictionaryExpanded)}
          />
        </div>
      </div>
    </div>
  );
});
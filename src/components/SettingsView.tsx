import { memo, useState, useRef, useEffect, lazy, Suspense } from 'react';
import { Sparkles, FolderOpen, Brain, Mic, Monitor, Palette, Globe } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useSettings } from '../contexts/SettingsContext';
import { RecordingAudioSettings } from './settings/RecordingAudioSettings';
import { DisplayInterfaceSettings } from './settings/DisplayInterfaceSettings';
import { ThemesSettings } from './settings/ThemesSettings';
import { WebhookSettings } from './settings/WebhookSettings';
import './settings/CollapsibleSection.css';
import './SettingsView-spacing.css';
import './settings/SoundSettings.css';
import '../styles/grid-system.css';

// Lazy load heavy components
const ModelManager = lazy(() => import('./ModelManager').then(module => ({ default: module.ModelManager })));
const LLMSettings = lazy(() => import('./LLMSettings').then(module => ({ default: module.LLMSettings })));

export const SettingsView = memo(function SettingsView() {
  const { state, actions } = useSettings();
  const [isRecordingAudioExpanded, setIsRecordingAudioExpanded] = useState(true);
  const [isDisplayInterfaceExpanded, setIsDisplayInterfaceExpanded] = useState(true);
  const [isThemesExpanded, setIsThemesExpanded] = useState(true);
  const [isWebhooksExpanded, setIsWebhooksExpanded] = useState(false);
  const [isModelManagerExpanded, setIsModelManagerExpanded] = useState(false);
  const [isLLMSettingsExpanded, setIsLLMSettingsExpanded] = useState(false);
  const recordingAudioRef = useRef<HTMLDivElement>(null);
  const displayInterfaceRef = useRef<HTMLDivElement>(null);
  const themesRef = useRef<HTMLDivElement>(null);
  const webhooksRef = useRef<HTMLDivElement>(null);
  const modelSectionRef = useRef<HTMLDivElement>(null);
  const llmSectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isWebhooksExpanded && webhooksRef.current) {
      setTimeout(() => {
        webhooksRef.current?.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'nearest'
        });
      }, 100);
    }
  }, [isWebhooksExpanded]);

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
        {/* Recording & Audio - Collapsible */}
        <div className="collapsible-section" ref={recordingAudioRef}>
            <div className="collapsible-header-wrapper">
              <div 
                className="collapsible-header"
                onClick={() => setIsRecordingAudioExpanded(!isRecordingAudioExpanded)}
              >
                <div>
                  <h3>
                    <span className={`collapse-arrow ${isRecordingAudioExpanded ? 'expanded' : ''}`}>
                      ▶
                    </span>
                    Recording & Audio
                    <Mic size={16} className="sparkle-icon" />
                  </h3>
                  <p className="collapsible-subtitle">
                    Shortcuts, sounds, and output settings
                  </p>
                </div>
              </div>
            </div>
            {isRecordingAudioExpanded && (
              <div className="collapsible-content">
                <RecordingAudioSettings />
              </div>
            )}
        </div>

        {/* Display & Interface - Collapsible */}
        <div className="collapsible-section" ref={displayInterfaceRef}>
            <div className="collapsible-header-wrapper">
              <div 
                className="collapsible-header"
                onClick={() => setIsDisplayInterfaceExpanded(!isDisplayInterfaceExpanded)}
              >
                <div>
                  <h3>
                    <span className={`collapse-arrow ${isDisplayInterfaceExpanded ? 'expanded' : ''}`}>
                      ▶
                    </span>
                    Display & Interface
                    <Monitor size={16} className="sparkle-icon" />
                  </h3>
                  <p className="collapsible-subtitle">
                    Visual feedback shown on screen while actively recording
                  </p>
                </div>
              </div>
            </div>
            {isDisplayInterfaceExpanded && (
              <div className="collapsible-content">
                <DisplayInterfaceSettings />
              </div>
            )}
        </div>

        {/* Themes - Collapsible */}
        <div className="collapsible-section" ref={themesRef}>
            <div className="collapsible-header-wrapper">
              <div 
                className="collapsible-header"
                onClick={() => setIsThemesExpanded(!isThemesExpanded)}
              >
                <div>
                  <h3>
                    <span className={`collapse-arrow ${isThemesExpanded ? 'expanded' : ''}`}>
                      ▶
                    </span>
                    Themes
                    <Palette size={16} className="sparkle-icon" />
                  </h3>
                  <p className="collapsible-subtitle">
                    Choose your visual theme
                  </p>
                </div>
              </div>
            </div>
            {isThemesExpanded && (
              <div className="collapsible-content">
                <ThemesSettings />
              </div>
            )}
        </div>

        {/* Webhooks - Collapsible */}
        <div className="collapsible-section" ref={webhooksRef}>
            <div className="collapsible-header-wrapper">
              <div 
                className="collapsible-header"
                onClick={() => setIsWebhooksExpanded(!isWebhooksExpanded)}
              >
                <div>
                  <h3>
                    <span className={`collapse-arrow ${isWebhooksExpanded ? 'expanded' : ''}`}>
                      ▶
                    </span>
                    Webhooks
                    <Globe size={16} className="sparkle-icon" />
                  </h3>
                  <p className="collapsible-subtitle">
                    Send transcriptions to external endpoints automatically
                  </p>
                </div>
              </div>
            </div>
            {isWebhooksExpanded && (
              <div className="collapsible-content">
                <WebhookSettings />
              </div>
            )}
        </div>

        {/* Model Manager - Full Width Collapsible */}
        <div className="collapsible-section model-manager-full-width" ref={modelSectionRef}>
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
                    Transcription Models
                    <Sparkles size={16} className="sparkle-icon" />
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
            {isModelManagerExpanded && (
              <div className="collapsible-content">
                <Suspense fallback={<div>Loading model manager...</div>}>
                  <ModelManager />
                </Suspense>
              </div>
            )}
        </div>

        {/* LLM Settings - Full Width Collapsible */}
        <div className="collapsible-section model-manager-full-width" ref={llmSectionRef}>
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
                    Post-processing
                    <Brain size={16} className="sparkle-icon" />
                  </h3>
                  <p className="collapsible-subtitle">
                    Enhance transcripts with summaries and insights
                  </p>
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

      </div>
    </div>
  );
});
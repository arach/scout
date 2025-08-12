import { memo, useState, useEffect, useRef, useCallback } from 'react';
import { 
  Mic, 
  Monitor, 
  AudioWaveform, 
  Sparkles, 
  Globe
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { RecordingAudioSettings } from './settings/RecordingAudioSettings';
import { DisplayInterfaceSettings } from './settings/DisplayInterfaceSettings';
import { ThemesSettings } from './settings/ThemesSettings';
import { WebhookSettingsSimple } from './settings/WebhookSettingsSimple';
import { ModelManager } from './ModelManager';
import { LLMSettings } from './LLMSettings';
import './SettingsViewV2.css';

interface SidebarItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}

const sidebarItems: SidebarItem[] = [
  { 
    id: 'recording-audio', 
    label: 'Recording & Audio', 
    icon: Mic,
    description: 'Configure shortcuts, sounds, and recording behavior'
  },
  { 
    id: 'display-interface', 
    label: 'Display & Themes', 
    icon: Monitor,
    description: 'Visual appearance and recording feedback'
  },
  { 
    id: 'transcription', 
    label: 'Transcription Models', 
    icon: AudioWaveform,
    description: 'Download and manage AI models for transcription'
  },
  { 
    id: 'post-processing', 
    label: 'Post-processing', 
    icon: Sparkles,
    description: 'Enhance transcripts with summaries and insights'
  },
  { 
    id: 'webhooks', 
    label: 'Webhooks', 
    icon: Globe,
    description: 'Send transcription results to external services'
  },
];

export const SettingsViewV2 = memo(function SettingsViewV2() {
  const [activeCategory, setActiveCategory] = useState('recording-audio');
  const [sidebarWidth, setSidebarWidth] = useState(225);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const MIN_WIDTH = 150;
  const MAX_WIDTH = 350;

  // Load saved sidebar width
  useEffect(() => {
    const loadSidebarWidth = async () => {
      try {
        const settings = await invoke<{ settings_sidebar_width?: number }>('get_settings');
        if (settings.settings_sidebar_width) {
          setSidebarWidth(settings.settings_sidebar_width);
        }
      } catch (error) {
        console.error('Failed to load settings sidebar width:', error);
      }
    };
    loadSidebarWidth();
  }, []);

  // Save width when resizing stops
  const saveWidth = useCallback(async (newWidth: number) => {
    try {
      const settings = await invoke('get_settings') as Record<string, any>;
      await invoke('update_settings', { 
        newSettings: {
          ...settings, 
          settings_sidebar_width: newWidth 
        }
      });
    } catch (error) {
      console.error('Failed to save settings sidebar width:', error);
    }
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;
    
    const newWidth = e.clientX;
    if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
      setSidebarWidth(newWidth);
    }
  }, [isResizing]);

  const handleMouseUp = useCallback(() => {
    if (isResizing) {
      setIsResizing(false);
      saveWidth(sidebarWidth);
    }
  }, [isResizing, sidebarWidth, saveWidth]);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
    }
  }, [isResizing, handleMouseMove, handleMouseUp]);

  const renderContent = () => {
    switch (activeCategory) {
      case 'recording-audio':
        return (
          <div className="settings-content">
            <div className="settings-header-simple">
              <h1>Recording & Audio</h1>
              <p>Configure shortcuts, sounds, and recording behavior</p>
            </div>
            <div className="settings-card">
              <div className="settings-card-content">
                <RecordingAudioSettings />
              </div>
            </div>
          </div>
        );

      case 'display-interface':
        return (
          <div className="settings-content">
            <div className="settings-header-simple">
              <h1>Display & Themes</h1>
              <p>Visual appearance and recording feedback</p>
            </div>
            <div className="settings-section">
              <h2 className="settings-section-title">Recording Display</h2>
              <div className="settings-card">
                <div className="settings-card-content">
                  <DisplayInterfaceSettings />
                </div>
              </div>
            </div>
            <div className="settings-section">
              <h2 className="settings-section-title">Themes</h2>
              <div className="settings-card">
                <div className="settings-card-content">
                  <ThemesSettings />
                </div>
              </div>
            </div>
          </div>
        );


      case 'transcription':
        return (
          <div className="settings-content">
            <div className="settings-header-simple">
              <h1>Transcription Models</h1>
              <p>Download and manage AI models for transcription</p>
            </div>
            <div className="settings-card">
              <div className="settings-card-content">
                <ModelManager />
              </div>
            </div>
          </div>
        );

      case 'post-processing':
        return (
          <div className="settings-content">
            <div className="settings-header-simple">
              <h1>Post-processing</h1>
              <p>Enhance transcripts with summaries and insights</p>
            </div>
            <div className="settings-card">
              <div className="settings-card-content">
                <LLMSettings 
                  settings={{
                    enabled: false,
                    model_id: '',
                    temperature: 0.7,
                    max_tokens: 2048,
                    auto_download_model: false,
                    enabled_prompts: []
                  }}
                  onUpdateSettings={(updates) => {
                    console.log('LLM settings update:', updates);
                  }}
                />
              </div>
            </div>
          </div>
        );

      case 'webhooks':
        return (
          <div className="settings-content">
            <div className="settings-header-simple">
              <h1>Webhooks</h1>
              <p>Send transcription results to external services</p>
            </div>
            <div className="settings-card">
              <div className="settings-card-content">
                <WebhookSettingsSimple />
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="settings-v2">
      <div 
        ref={sidebarRef}
        className={`settings-sidebar ${isResizing ? 'resizing' : ''}`}
        style={{ width: `${sidebarWidth}px` }}
      >
        <nav className="settings-sidebar-nav">
          {sidebarItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setActiveCategory(item.id)}
                className={`settings-sidebar-item ${activeCategory === item.id ? 'active' : ''}`}
              >
                <Icon className="settings-sidebar-item-icon" />
                <span className="settings-sidebar-item-label">{item.label}</span>
              </button>
            );
          })}
        </nav>
        
        <div 
          className="settings-sidebar-resize-handle"
          onMouseDown={handleMouseDown}
        />
      </div>

      <div className="settings-main">
        <div className="settings-main-container">
          {renderContent()}
        </div>
      </div>
    </div>
  );
});
import { memo, useState, useEffect, useRef, useCallback } from 'react';
import { 
  Mic, 
  Monitor, 
  AudioWaveform, 
  Sparkles, 
  Globe,
  ChevronLeft,
  ChevronRight
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
    id: 'recording', 
    label: 'Recording', 
    icon: Mic,
    description: 'Shortcuts and audio settings'
  },
  { 
    id: 'display', 
    label: 'Display', 
    icon: Monitor,
    description: 'Themes and visual feedback'
  },
  { 
    id: 'transcription', 
    label: 'Transcription', 
    icon: AudioWaveform,
    description: 'AI models for speech-to-text'
  },
  { 
    id: 'processing', 
    label: 'Processing', 
    icon: Sparkles,
    description: 'Post-transcription enhancements'
  },
  { 
    id: 'webhooks', 
    label: 'Webhooks', 
    icon: Globe,
    description: 'External service integration'
  },
];

export const SettingsViewV2 = memo(function SettingsViewV2() {
  const [activeCategory, setActiveCategory] = useState('recording');
  const [sidebarWidth, setSidebarWidth] = useState(225);
  const [isResizing, setIsResizing] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const MIN_WIDTH = 150;
  const MAX_WIDTH = 350;
  const COLLAPSED_WIDTH = 68;

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
    
    // Auto-collapse if dragged below 180px
    if (newWidth < 180) {
      setIsCollapsed(true);
      setSidebarWidth(225); // Keep the expanded width for when we expand again
    } else {
      setIsCollapsed(false);
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
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
      case 'recording':
        return <RecordingAudioSettings />;

      case 'display':
        return (
          <>
            <h2 className="settings-section-title">Overlay</h2>
            <DisplayInterfaceSettings />
            <h2 className="settings-section-title">Theme</h2>
            <ThemesSettings />
          </>
        );


      case 'transcription':
        return <ModelManager />;

      case 'processing':
        return (
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
        );

      case 'webhooks':
        return <WebhookSettingsSimple />;

      default:
        return null;
    }
  };

  return (
    <div className="settings-v2">
      <div 
        ref={sidebarRef}
        className={`settings-sidebar ${isResizing ? 'resizing' : ''} ${isCollapsed ? 'collapsed' : ''}`}
        style={{ width: isCollapsed ? `${COLLAPSED_WIDTH}px` : `${sidebarWidth}px` }}
      >
        <button
          className="settings-sidebar-toggle"
          onClick={() => setIsCollapsed(!isCollapsed)}
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
        
        <nav className="settings-sidebar-nav">
          {sidebarItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setActiveCategory(item.id)}
                className={`settings-sidebar-item ${activeCategory === item.id ? 'active' : ''}`}
                title={isCollapsed ? item.label : undefined}
              >
                <Icon className="settings-sidebar-item-icon" />
                {!isCollapsed && <span className="settings-sidebar-item-label">{item.label}</span>}
              </button>
            );
          })}
        </nav>
        
        {!isCollapsed && (
          <div 
            className="settings-sidebar-resize-handle"
            onMouseDown={handleMouseDown}
          />
        )}
      </div>

      <div className="settings-main">
        <div className="settings-main-container">
          <div className="settings-content-wrapper" key={activeCategory}>
            {renderContent()}
          </div>
        </div>
      </div>
    </div>
  );
});
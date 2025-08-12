import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Settings, ChevronLeft, ChevronRight, Webhook } from 'lucide-react';
import { webhookApi } from '../lib/webhooks';
import './Sidebar.css';

type View = 'record' | 'transcripts' | 'settings' | 'stats' | 'dictionary' | 'webhooks';

interface SidebarProps {
  currentView: View;
  onViewChange: (view: View) => void;
  isExpanded: boolean;
  onToggleExpanded: () => void;
}

interface SidebarState {
  isExpanded: boolean;
  toggleExpanded: () => void;
}

// Export the sidebar state so it can be used in App.tsx
export const useSidebarState = (): SidebarState => {
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    const loadSidebarState = async () => {
      try {
        const settings = await invoke<{ sidebar_expanded?: boolean }>('get_settings');
        if (settings.sidebar_expanded !== undefined) {
          setIsExpanded(settings.sidebar_expanded);
        }
      } catch (error) {
        console.error('Failed to load sidebar state:', error);
      }
    };
    loadSidebarState();
  }, []);

  const toggleExpanded = async () => {
    const newState = !isExpanded;
    setIsExpanded(newState);
    
    try {
      const settings = await invoke('get_settings') as Record<string, any>;
      await invoke('update_settings', { 
        newSettings: {
          ...settings, 
          sidebar_expanded: newState 
        }
      });
    } catch (error) {
      console.error('Failed to save sidebar state:', error);
    }
  };

  return { isExpanded, toggleExpanded };
};

export function Sidebar({ currentView, onViewChange, isExpanded, onToggleExpanded }: SidebarProps) {
  const handleViewChange = async (view: View) => {
    // Play transition sound when changing views
    try {
      await invoke('play_transition_sound');
    } catch (error) {
      console.error('Failed to play transition sound:', error);
    }
    onViewChange(view);
  };
  const [width, setWidth] = useState(200);
  const [isResizing, setIsResizing] = useState(false);
  const [showWebhooks, setShowWebhooks] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const MIN_WIDTH = 150;
  const MAX_WIDTH = 400;
  

  // Check webhook status
  useEffect(() => {
    const checkWebhookStatus = async () => {
      try {
        const webhooks = await webhookApi.getWebhooks();
        const hasEnabledWebhooks = webhooks.length > 0 && webhooks.some(w => w.enabled);
        setShowWebhooks(hasEnabledWebhooks);
      } catch (error) {
        console.error('Failed to check webhook status:', error);
        setShowWebhooks(false);
      }
    };
    
    // Initial check
    checkWebhookStatus();
    
    // Listen for webhook status changes
    const handleWebhookStatusChange = (event: CustomEvent) => {
      checkWebhookStatus();
    };
    
    window.addEventListener('webhook-status-changed', handleWebhookStatusChange as EventListener);
    
    // Also re-check when settings view is accessed
    if (currentView === 'settings') {
      checkWebhookStatus();
    }
    
    return () => {
      window.removeEventListener('webhook-status-changed', handleWebhookStatusChange as EventListener);
    };
  }, [currentView]);

  // Load saved width
  useEffect(() => {
    const loadSidebarWidth = async () => {
      try {
        const settings = await invoke<{ sidebar_width?: number }>('get_settings');
        if (settings.sidebar_width) {
          setWidth(settings.sidebar_width);
        }
      } catch (error) {
        console.error('Failed to load sidebar width:', error);
      }
    };
    if (isExpanded) {
      loadSidebarWidth();
    }
  }, [isExpanded]);

  // Save width when resizing stops
  const saveWidth = useCallback(async (newWidth: number) => {
    try {
      const settings = await invoke('get_settings') as Record<string, any>;
      await invoke('update_settings', { 
        newSettings: {
          ...settings, 
          sidebar_width: newWidth 
        }
      });
    } catch (error) {
      console.error('Failed to save sidebar width:', error);
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
      setWidth(newWidth);
    }
  }, [isResizing]);

  const handleMouseUp = useCallback(() => {
    if (isResizing) {
      setIsResizing(false);
      saveWidth(width);
    }
  }, [isResizing, width, saveWidth]);

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

  return (
    <div 
      ref={sidebarRef}
      className={`sidebar ${isExpanded ? 'expanded' : 'collapsed'} ${isResizing ? 'resizing' : ''}`}
      style={{}}
    >
      <button 
        className="sidebar-toggle-zone"
        onClick={onToggleExpanded}
        aria-label={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
      >
        {isExpanded ? (
          <>
            <span className="sidebar-app-name">Scout</span>
            <ChevronLeft size={16} />
          </>
        ) : (
          <ChevronRight size={16} />
        )}
      </button>
      
      <div className="sidebar-main-buttons">
        <button
          className={`sidebar-button sidebar-button-record ${currentView === 'record' ? 'active' : ''}`}
          onClick={() => handleViewChange('record')}
          aria-label="Record"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5"/>
            <circle cx="10" cy="10" r="3" fill="currentColor"/>
          </svg>
          {isExpanded && <span className="sidebar-label">Record</span>}
          <span className="sidebar-tooltip">Record</span>
        </button>
        <button
          className={`sidebar-button sidebar-button-transcripts ${currentView === 'transcripts' ? 'active' : ''}`}
          onClick={() => handleViewChange('transcripts')}
          aria-label="Transcripts"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="4" y="3" width="12" height="14" rx="1" stroke="currentColor" strokeWidth="1.5"/>
            <line x1="7" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="1.5"/>
            <line x1="7" y1="10" x2="13" y2="10" stroke="currentColor" strokeWidth="1.5"/>
            <line x1="7" y1="13" x2="10" y2="13" stroke="currentColor" strokeWidth="1.5"/>
          </svg>
          {isExpanded && <span className="sidebar-label">Transcripts</span>}
          <span className="sidebar-tooltip">Transcripts</span>
        </button>
        <button
          className={`sidebar-button sidebar-button-stats ${currentView === 'stats' ? 'active' : ''}`}
          onClick={() => handleViewChange('stats')}
          aria-label="Stats"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="3" y="12" width="3" height="5" rx="0.5" fill="currentColor"/>
            <rect x="8.5" y="8" width="3" height="9" rx="0.5" fill="currentColor"/>
            <rect x="14" y="5" width="3" height="12" rx="0.5" fill="currentColor"/>
          </svg>
          {isExpanded && <span className="sidebar-label">Stats</span>}
          <span className="sidebar-tooltip">Stats</span>
        </button>
        <button
          className={`sidebar-button sidebar-button-dictionary ${currentView === 'dictionary' ? 'active' : ''}`}
          onClick={() => handleViewChange('dictionary')}
          aria-label="Dictionary"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 3C3.44772 3 3 3.44772 3 4V16C3 16.5523 3.44772 17 4 17H15C15.2652 17 15.5196 16.8946 15.7071 16.7071C15.8946 16.5196 16 16.2652 16 16V6L16 4C16 3.44772 15.5523 3 15 3H4Z" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M16 6C16 6 15 5 13 5H7" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M6 8H11M6 11H10M6 14H9" stroke="currentColor" strokeWidth="1.5"/>
          </svg>
          {isExpanded && <span className="sidebar-label">Dictionary</span>}
          <span className="sidebar-tooltip">Dictionary</span>
        </button>
        {showWebhooks && (
          <button
            className={`sidebar-button sidebar-button-webhooks ${currentView === 'webhooks' ? 'active' : ''}`}
            onClick={() => handleViewChange('webhooks')}
            aria-label="Webhooks"
          >
            <Webhook size={20} />
            {isExpanded && <span className="sidebar-label">Webhooks</span>}
            <span className="sidebar-tooltip">Webhooks</span>
          </button>
        )}
      </div>
      
      <div className="sidebar-bottom-buttons">
        <button
          className={`sidebar-button sidebar-button-settings ${currentView === 'settings' ? 'active' : ''}`}
          onClick={() => handleViewChange('settings')}
          aria-label="Settings"
        >
          <Settings size={20} />
          {isExpanded && <span className="sidebar-label">Settings</span>}
          <span className="sidebar-tooltip">Settings</span>
        </button>
      </div>
      
      {isExpanded && (
        <div 
          className="sidebar-resize-handle"
          onMouseDown={handleMouseDown}
        />
      )}
    </div>
  );
} 
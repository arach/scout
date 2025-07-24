import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Settings } from 'lucide-react';
import './Sidebar.css';

type View = 'record' | 'transcripts' | 'settings';

interface SidebarProps {
  currentView: View;
  onViewChange: (view: View) => void;
  isExpanded: boolean;
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
        ...settings, 
        sidebar_expanded: newState 
      });
    } catch (error) {
      console.error('Failed to save sidebar state:', error);
    }
  };

  return { isExpanded, toggleExpanded };
};

export function Sidebar({ currentView, onViewChange, isExpanded }: SidebarProps) {
  return (
    <div className={`sidebar ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <button
        className={`sidebar-button sidebar-button-record ${currentView === 'record' ? 'active' : ''}`}
        onClick={() => onViewChange('record')}
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
        onClick={() => onViewChange('transcripts')}
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
        className={`sidebar-button sidebar-button-settings ${currentView === 'settings' ? 'active' : ''}`}
        onClick={() => onViewChange('settings')}
        aria-label="Settings"
      >
        <Settings size={20} />
        {isExpanded && <span className="sidebar-label">Settings</span>}
        <span className="sidebar-tooltip">Settings</span>
      </button>
    </div>
  );
} 
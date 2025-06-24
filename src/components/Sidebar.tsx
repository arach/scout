import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './Sidebar.css';

type View = 'record' | 'transcripts' | 'settings';

interface SidebarProps {
  currentView: View;
  onViewChange: (view: View) => void;
}

export function Sidebar({ currentView, onViewChange }: SidebarProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Load expanded state from settings
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
    
    // Save to settings
    try {
      await invoke('update_setting', { key: 'sidebar_expanded', value: newState });
    } catch (error) {
      console.error('Failed to save sidebar state:', error);
    }
  };

  return (
    <div className={`sidebar ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <button
        className={`sidebar-button ${currentView === 'record' ? 'active' : ''}`}
        onClick={() => onViewChange('record')}
        aria-label="Record"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5"/>
          <circle cx="10" cy="10" r="3" fill="currentColor"/>
        </svg>
        {isExpanded && <span className="sidebar-label">Record</span>}
        {!isExpanded && <span className="sidebar-tooltip">Record</span>}
      </button>
      <button
        className={`sidebar-button ${currentView === 'transcripts' ? 'active' : ''}`}
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
        {!isExpanded && <span className="sidebar-tooltip">Transcripts</span>}
      </button>
      <button
        className={`sidebar-button ${currentView === 'settings' ? 'active' : ''}`}
        onClick={() => onViewChange('settings')}
        aria-label="Settings"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="10" cy="10" r="2" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M10 3V1M10 19V17M17 10H19M1 10H3M15.364 15.364L16.778 16.778M3.222 3.222L4.636 4.636M15.364 4.636L16.778 3.222M3.222 16.778L4.636 15.364" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        {isExpanded && <span className="sidebar-label">Settings</span>}
        {!isExpanded && <span className="sidebar-tooltip">Settings</span>}
      </button>
      <div className="sidebar-footer">
        <button
          className="sidebar-toggle"
          onClick={toggleExpanded}
          aria-label={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d={isExpanded ? "M10 12L6 8L10 4" : "M6 12L10 8L6 4"}
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
} 
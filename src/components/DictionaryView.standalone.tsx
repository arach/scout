import React from 'react';
import { DictionaryView } from './DictionaryView';
import './DictionaryView.css';

// Standalone wrapper for the dictionary view when accessed directly from navigation
export const DictionaryViewStandalone: React.FC = () => {
  return (
    <div className="dictionary-view-standalone">
      <div className="dictionary-standalone-header">
        <h1>Dictionary</h1>
        <p>Manage custom text replacements for your transcriptions</p>
      </div>
      <div className="dictionary-standalone-content">
        <DictionaryView isExpanded={true} onToggleExpand={() => {}} />
      </div>
    </div>
  );
};
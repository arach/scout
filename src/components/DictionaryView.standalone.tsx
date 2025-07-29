import React from 'react';
import { DictionaryView } from './DictionaryView';
import './DictionaryView.css';

// Standalone wrapper for the dictionary view when accessed directly from navigation
export const DictionaryViewStandalone: React.FC = () => {
  return (
    <div className="dictionary-view-standalone">
      <DictionaryView isExpanded={true} onToggleExpand={() => {}} />
    </div>
  );
};
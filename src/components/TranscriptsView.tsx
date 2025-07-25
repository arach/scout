import { memo } from 'react';
import { TranscriptDetailPanel } from './TranscriptDetailPanel';
import { TranscriptItem } from './TranscriptItem';
import { ChevronDown } from 'lucide-react';
import { formatShortcut } from '../lib/formatShortcut';
import { Transcript } from '../types/transcript';
import { useTranscriptGrouping } from '../hooks/useTranscriptGrouping';
import { useTranscriptPagination } from '../hooks/useTranscriptPagination';
import { useTranscriptDetailPanel } from '../hooks/useTranscriptDetailPanel';
import { useTranscriptMenuState } from '../hooks/useTranscriptMenuState';
import './TranscriptsView.css';

interface TranscriptsViewProps {
    transcripts: Transcript[];
    selectedTranscripts: Set<number>;
    searchQuery: string;
    hotkey: string;
    setSearchQuery: (query: string) => void;
    searchTranscripts: () => void;
    toggleTranscriptSelection: (id: number) => void;
    toggleTranscriptGroupSelection: (ids: number[]) => void;
    selectAllTranscripts: () => void;
    showBulkDeleteConfirmation: () => void;
    exportTranscripts: (format: 'json' | 'markdown' | 'text') => void;
    copyTranscript: (text: string) => void;
    showDeleteConfirmation: (id: number, text: string) => void;
    formatDuration: (ms: number) => string;
    formatFileSize?: (bytes: number) => string;
}

export const TranscriptsView = memo(function TranscriptsView({
    transcripts,
    selectedTranscripts,
    searchQuery,
    hotkey,
    setSearchQuery,
    searchTranscripts,
    toggleTranscriptSelection,
    toggleTranscriptGroupSelection,
    selectAllTranscripts,
    showBulkDeleteConfirmation,
    exportTranscripts,
    copyTranscript,
    showDeleteConfirmation,
    formatDuration,
    formatFileSize,
}: TranscriptsViewProps) {
    // Use extracted custom hooks
    const { groupedTranscripts, expandedGroups, toggleGroup } = useTranscriptGrouping(transcripts);
    const { paginatedGroups, hasMore, remainingCount, loadMore } = useTranscriptPagination(groupedTranscripts, transcripts.length);
    const { panelState, openDetailPanel, closeDetailPanel } = useTranscriptDetailPanel();
    const {
        showExportMenu,
        showFloatingExportMenu,
        toggleExportMenu,
        toggleFloatingExportMenu,
        closeExportMenu,
        closeFloatingExportMenu,
    } = useTranscriptMenuState();

    
    return (
        <div className="transcripts-view">
            {/* 🧠 CSS Grid with specific column sizing */}
            <div className="header-grid mb-4">
                {/* Left: Title */}
                <h1 className="text-2xl font-semibold text-white m-0">Transcripts</h1>
                
                {/* Center: Search Box */}
                <div className="search-container">
                    <input
                        type="text"
                        className="search-input"
                        placeholder="Search transcripts..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && searchTranscripts()}
                    />
                </div>
                
                {/* Right: Action Buttons */}
                <div className="header-actions-container">
                    {transcripts.length > 0 && (
                        <>
                            <button
                                className="header-action-btn select-all"
                                onClick={selectAllTranscripts}
                            >
                                {selectedTranscripts.size === transcripts.length ? 'Deselect All' : 'Select All'}
                            </button>
                            {selectedTranscripts.size > 0 && (
                                <>
                                    <button
                                        className="header-action-btn delete"
                                        onClick={showBulkDeleteConfirmation}
                                    >
                                        Delete ({selectedTranscripts.size})
                                    </button>
                                    <div className="export-menu relative">
                                        <button 
                                            className="header-action-btn export"
                                            onClick={toggleExportMenu}
                                        >
                                            Export
                                        </button>
                                        {showExportMenu && (
                                            <div className="absolute top-full mt-1 right-0 bg-zinc-800 border border-zinc-700 rounded-md p-1 min-w-32 shadow-lg z-50">
                                                <button 
                                                    className="block w-full text-left px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-700 rounded transition-colors"
                                                    onClick={() => {
                                                        exportTranscripts('json');
                                                        closeExportMenu();
                                                    }}
                                                >
                                                    JSON
                                                </button>
                                                <button 
                                                    className="block w-full text-left px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-700 rounded transition-colors"
                                                    onClick={() => {
                                                        exportTranscripts('markdown');
                                                        closeExportMenu();
                                                    }}
                                                >
                                                    Markdown
                                                </button>
                                                <button 
                                                    className="block w-full text-left px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-700 rounded transition-colors"
                                                    onClick={() => {
                                                        exportTranscripts('text');
                                                        closeExportMenu();
                                                    }}
                                                >
                                                    Text
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </>
                    )}
                </div>
            </div>

            <div className="transcripts-list">
                {transcripts.length === 0 ? (
                    <div className="no-transcripts">
                        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.3">
                            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                            <line x1="12" y1="19" x2="12" y2="22" />
                            <line x1="8" y1="22" x2="16" y2="22" />
                        </svg>
                        <h3>No transcripts yet</h3>
                        <p>Press <span title={hotkey}>{formatShortcut(hotkey)}</span> or click "Start Recording" to begin</p>
                    </div>
                ) : (
                    <div className="transcript-list-container">
                        {paginatedGroups.map(group => {
                            // Find the full group data for this title
                            const fullGroup = groupedTranscripts.find(g => g.title === group.title);
                            const fullGroupTranscripts = fullGroup?.transcripts || [];
                            
                            return (
                                <div key={group.title} className={`transcript-group ${expandedGroups.has(group.title) ? 'expanded' : ''}`}>
                                    <div className="transcript-group-header">
                                        <div className="group-header-left">
                                            <input
                                                type="checkbox"
                                                className="group-checkbox"
                                                checked={fullGroupTranscripts.every(t => selectedTranscripts.has(t.id))}
                                                onChange={(e) => {
                                                    e.stopPropagation();
                                                    const allGroupIds = fullGroupTranscripts.map(t => t.id);
                                                    toggleTranscriptGroupSelection(allGroupIds);
                                                }}
                                            />
                                            <button 
                                                className="group-toggle-btn"
                                                onClick={() => toggleGroup(group.title)}
                                            >
                                                <ChevronDown size={16} className="chevron-icon" />
                                            </button>
                                            <h3 
                                                className="transcript-group-title"
                                                onClick={() => toggleGroup(group.title)}
                                            >
                                                {group.title}
                                            </h3>
                                            <span className="group-count">({fullGroupTranscripts.length})</span>
                                        </div>
                                        {fullGroupTranscripts.some(t => selectedTranscripts.has(t.id)) && (
                                            <button 
                                                className="group-clear-btn"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    const selectedInGroup = fullGroupTranscripts.filter(t => selectedTranscripts.has(t.id));
                                                    toggleTranscriptGroupSelection(selectedInGroup.map(t => t.id));
                                                }}
                                            >
                                                Clear
                                            </button>
                                        )}
                                    </div>
                                {expandedGroups.has(group.title) && (
                                    <div className="transcript-group-items">
                                        {group.transcripts.map((transcript) => {
                                            return (
                                                <TranscriptItem
                                                    key={transcript.id}
                                                    transcript={transcript}
                                                    formatDuration={formatDuration}
                                                    onDelete={showDeleteConfirmation}
                                                    onClick={openDetailPanel}
                                                    showCheckbox={true}
                                                    isSelected={selectedTranscripts.has(transcript.id)}
                                                    onSelectToggle={toggleTranscriptSelection}
                                                    isActive={panelState.transcript?.id === transcript.id}
                                                    variant="default"
                                                />
                                            );
                                        })}
                                    </div>
                                )}
                                </div>
                            );
                        })}
                        {hasMore && (
                            <div className="load-more-container">
                                <button 
                                    className="load-more-btn"
                                    onClick={loadMore}
                                >
                                    Load More ({remainingCount} remaining)
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
            
            <TranscriptDetailPanel
                transcript={panelState.transcript}
                isOpen={panelState.isOpen}
                onClose={closeDetailPanel}
                onCopy={copyTranscript}
                onDelete={showDeleteConfirmation}
                onExport={(_, format) => exportTranscripts(format)}
                formatDuration={formatDuration}
                formatFileSize={formatFileSize}
            />
            
            {selectedTranscripts.size > 0 && (
                <div className="floating-action-bar">
                    <span className="selection-count">
                        {selectedTranscripts.size} selected
                    </span>
                    <button 
                        className="action-btn delete"
                        onClick={showBulkDeleteConfirmation}
                    >
                        Delete Selected
                    </button>
                    <div className="export-dropdown">
                        <button 
                            className="action-btn export"
                            onClick={toggleFloatingExportMenu}
                        >
                            Export
                        </button>
                        {showFloatingExportMenu && (
                            <div className="export-menu">
                                <button onClick={() => {
                                    exportTranscripts('json');
                                    closeFloatingExportMenu();
                                }}>As JSON</button>
                                <button onClick={() => {
                                    exportTranscripts('markdown');
                                    closeFloatingExportMenu();
                                }}>As Markdown</button>
                                <button onClick={() => {
                                    exportTranscripts('text');
                                    closeFloatingExportMenu();
                                }}>As Text</button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}); 
import React, { useState } from 'react';
import './TranscriptsView.css';

interface Transcript {
    id: number;
    text: string;
    duration_ms: number;
    created_at: string;
    metadata?: string;
}

interface TranscriptsViewProps {
    transcripts: Transcript[];
    selectedTranscripts: Set<number>;
    searchQuery: string;
    hotkey: string;
    setSearchQuery: (query: string) => void;
    searchTranscripts: () => void;
    toggleTranscriptSelection: (id: number) => void;
    selectAllTranscripts: () => void;
    showBulkDeleteConfirmation: () => void;
    exportTranscripts: (format: 'json' | 'markdown' | 'text') => void;
    copyTranscript: (text: string) => void;
    showDeleteConfirmation: (id: number, text: string) => void;
    formatDuration: (ms: number) => string;
}

export function TranscriptsView({
    transcripts,
    selectedTranscripts,
    searchQuery,
    hotkey,
    setSearchQuery,
    searchTranscripts,
    toggleTranscriptSelection,
    selectAllTranscripts,
    showBulkDeleteConfirmation,
    exportTranscripts,
    copyTranscript,
    showDeleteConfirmation,
    formatDuration,
}: TranscriptsViewProps) {
    const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

    const toggleExpanded = (id: number) => {
        const newExpanded = new Set(expandedIds);
        if (newExpanded.has(id)) {
            newExpanded.delete(id);
        } else {
            newExpanded.add(id);
        }
        setExpandedIds(newExpanded);
    };

    const truncateText = (text: string, maxLength: number = 80) => {
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    };
    return (
        <div className="transcripts-view">
            <div className="transcripts-header-container">
                <h1>Transcripts</h1>
                <div className="header-controls">
                    <input
                        type="text"
                        className="search-input"
                        placeholder="Search transcripts..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && searchTranscripts()}
                    />
                </div>
            </div>

            <div className="transcripts-list">
                <div className="transcripts-header">
                    <h2>All Transcripts</h2>
                    {transcripts.length > 0 && (
                        <div className="transcript-actions">
                            <button
                                className="select-all-button"
                                onClick={selectAllTranscripts}
                            >
                                {selectedTranscripts.size === transcripts.length ? 'Deselect All' : 'Select All'}
                            </button>
                            {selectedTranscripts.size > 0 && (
                                <>
                                    <button
                                        className="delete-button"
                                        onClick={showBulkDeleteConfirmation}
                                    >
                                        Delete ({selectedTranscripts.size})
                                    </button>
                                    <div className="export-menu">
                                        <button className="export-button">Export</button>
                                        <div className="export-options">
                                            <button onClick={() => exportTranscripts('json')}>JSON</button>
                                            <button onClick={() => exportTranscripts('markdown')}>Markdown</button>
                                            <button onClick={() => exportTranscripts('text')}>Text</button>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>
                {transcripts.length === 0 ? (
                    <div className="no-transcripts">
                        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.3">
                            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                            <line x1="12" y1="19" x2="12" y2="22" />
                            <line x1="8" y1="22" x2="16" y2="22" />
                        </svg>
                        <h3>No transcripts yet</h3>
                        <p>Press {hotkey.split('+').join(' + ')} or click "Start Recording" to begin</p>
                    </div>
                ) : (
                    <div className="transcript-list-container">
                        {transcripts.map((transcript) => {
                            const isExpanded = expandedIds.has(transcript.id);
                            const isBlankAudio = transcript.text === "[BLANK_AUDIO]";
                            
                            return (
                                <div
                                    key={transcript.id}
                                    className={`transcript-list-item ${selectedTranscripts.has(transcript.id) ? 'selected' : ''} ${isExpanded ? 'expanded' : ''}`}
                                >
                                    <div className="transcript-row">
                                        <input
                                            type="checkbox"
                                            className="transcript-checkbox"
                                            checked={selectedTranscripts.has(transcript.id)}
                                            onChange={(e) => {
                                                e.stopPropagation();
                                                toggleTranscriptSelection(transcript.id);
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                        />
                                        <span className="transcript-date">
                                            {new Date(transcript.created_at).toLocaleDateString()} {new Date(transcript.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                        <span className="transcript-duration">
                                            {formatDuration(transcript.duration_ms)}
                                        </span>
                                        <div 
                                            className="transcript-preview"
                                            onClick={() => toggleExpanded(transcript.id)}
                                        >
                                            {isBlankAudio ? (
                                                <span className="transcript-empty-inline">No speech detected</span>
                                            ) : (
                                                isExpanded ? transcript.text : truncateText(transcript.text)
                                            )}
                                        </div>
                                        <button
                                            className="expand-button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                toggleExpanded(transcript.id);
                                            }}
                                            title={isExpanded ? "Collapse" : "Expand"}
                                        >
                                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                <path 
                                                    d="M3 5L6 8L9 5" 
                                                    stroke="currentColor" 
                                                    strokeWidth="1.5" 
                                                    strokeLinecap="round" 
                                                    strokeLinejoin="round"
                                                    transform={isExpanded ? "rotate(180 6 6)" : ""}
                                                    style={{ transformOrigin: 'center' }}
                                                />
                                            </svg>
                                        </button>
                                        <div className="transcript-row-actions">
                                            <button
                                                className="icon-button copy-button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    copyTranscript(transcript.text);
                                                }}
                                                title="Copy transcript"
                                            >
                                                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                    <rect x="3" y="3" width="8" height="8" stroke="currentColor" strokeWidth="1" rx="1"/>
                                                    <path d="M3 7H2C1.44772 7 1 6.55228 1 6V2C1 1.44772 1.44772 1 2 1H6C6.55228 1 7 1.44772 7 2V3" stroke="currentColor" strokeWidth="1"/>
                                                </svg>
                                            </button>
                                            <button
                                                className="icon-button delete-button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    showDeleteConfirmation(transcript.id, transcript.text);
                                                }}
                                                title="Delete transcript"
                                            >
                                                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                    <path d="M2 4H12M5 4V2.5C5 2.22386 5.22386 2 5.5 2H8.5C8.77614 2 9 2.22386 9 2.5V4M6 7V10M8 7V10M3 4L4 11.5C4 11.7761 4.22386 12 4.5 12H9.5C9.77614 12 10 11.7761 10 11.5L11 4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
                                                </svg>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
} 
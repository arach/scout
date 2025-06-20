import React from 'react';
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
                    transcripts.map((transcript) => (
                        <div
                            key={transcript.id}
                            className={`transcript-item ${selectedTranscripts.has(transcript.id) ? 'selected' : ''}`}
                        >
                            <input
                                type="checkbox"
                                className="transcript-checkbox"
                                checked={selectedTranscripts.has(transcript.id)}
                                onChange={() => toggleTranscriptSelection(transcript.id)}
                            />
                            <div className="transcript-content">
                                <div className="transcript-header">
                                    <span className="transcript-date">
                                        {new Date(transcript.created_at).toLocaleString()}
                                    </span>
                                    <span className="transcript-duration">
                                        {formatDuration(transcript.duration_ms)}
                                    </span>
                                </div>
                                <p className="transcript-text">
                                    {transcript.text === "[BLANK_AUDIO]" ? (
                                        <span className="transcript-empty">
                                            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style={{ marginRight: '6px', verticalAlign: 'text-bottom' }}>
                                                <path d="M8 1a7 7 0 100 14A7 7 0 008 1zM7 4h2v5H7V4zm0 6h2v2H7v-2z" />
                                            </svg>
                                            No speech detected in recording
                                        </span>
                                    ) : (
                                        transcript.text
                                    )}
                                </p>
                            </div>
                            <div className="transcript-item-actions">
                                <button
                                    className="copy-button"
                                    onClick={() => copyTranscript(transcript.text)}
                                    title="Copy transcript"
                                >
                                    Copy
                                </button>
                                <button
                                    className="delete-item-button"
                                    onClick={() => showDeleteConfirmation(transcript.id, transcript.text)}
                                    title="Delete transcript"
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
} 
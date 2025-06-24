import React, { useState } from 'react';
import { TranscriptDetailPanel } from './TranscriptDetailPanel';
import { TranscriptItem } from './TranscriptItem';
import './TranscriptsView.css';

interface Transcript {
    id: number;
    text: string;
    duration_ms: number;
    created_at: string;
    metadata?: string;
    audio_path?: string;
    file_size?: number;
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
    formatFileSize?: (bytes: number) => string;
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
    formatFileSize,
}: TranscriptsViewProps) {
    const [panelState, setPanelState] = useState<{
        transcript: Transcript | null;
        isOpen: boolean;
    }>({ transcript: null, isOpen: false });

    const openDetailPanel = (transcript: Transcript) => {
        setPanelState({ transcript: transcript, isOpen: true });
    };

    const closeDetailPanel = () => {
        setPanelState(prev => ({ ...prev, isOpen: false }));
        // Keep selected transcript for animation
        setTimeout(() => {
            setPanelState(prev => ({ ...prev, transcript: null }));
        }, 200);
    };

    // Group transcripts by date
    const groupTranscriptsByDate = (transcripts: Transcript[]) => {
        const groups: { [key: string]: Transcript[] } = {};
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const thisWeek = new Date(today);
        thisWeek.setDate(thisWeek.getDate() - 7);
        const thisMonth = new Date(today);
        thisMonth.setDate(thisMonth.getDate() - 30);

        transcripts.forEach(transcript => {
            const date = new Date(transcript.created_at);
            let groupKey: string;

            if (date >= today) {
                groupKey = 'Today';
            } else if (date >= yesterday) {
                groupKey = 'Yesterday';
            } else if (date >= thisWeek) {
                groupKey = 'This Week';
            } else if (date >= thisMonth) {
                groupKey = 'This Month';
            } else {
                groupKey = 'Older';
            }

            if (!groups[groupKey]) {
                groups[groupKey] = [];
            }
            groups[groupKey].push(transcript);
        });

        // Return in order
        const orderedGroups: { title: string; transcripts: Transcript[] }[] = [];
        const order = ['Today', 'Yesterday', 'This Week', 'This Month', 'Older'];
        order.forEach(key => {
            if (groups[key]) {
                orderedGroups.push({ title: key, transcripts: groups[key] });
            }
        });

        return orderedGroups;
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
                {transcripts.length > 0 && (
                    <div className="transcripts-actions-bar">
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
                        {groupTranscriptsByDate(transcripts).map(group => (
                            <div key={group.title} className="transcript-group">
                                <h3 className="transcript-group-title">{group.title}</h3>
                                {group.transcripts.map((transcript) => {
                                    const isBlankAudio = transcript.text === "[BLANK_AUDIO]";
                                    
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
                        ))}
                    </div>
                )}
            </div>
            
            <TranscriptDetailPanel
                transcript={panelState.transcript}
                isOpen={panelState.isOpen}
                onClose={closeDetailPanel}
                onCopy={copyTranscript}
                onDelete={showDeleteConfirmation}
                onExport={(transcripts, format) => exportTranscripts(format)}
                formatDuration={formatDuration}
                formatFileSize={formatFileSize}
            />
        </div>
    );
} 
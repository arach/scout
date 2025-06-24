import React, { useState, useEffect, useMemo } from 'react';
import { TranscriptDetailPanel } from './TranscriptDetailPanel';
import { TranscriptItem } from './TranscriptItem';
import { ChevronDown, ChevronUp } from 'lucide-react';
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

const ITEMS_PER_PAGE = 50;

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
    
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['Today', 'Yesterday']));
    const [displayedItems, setDisplayedItems] = useState(ITEMS_PER_PAGE);

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
    
    const toggleGroup = (groupTitle: string) => {
        setExpandedGroups(prev => {
            const newSet = new Set(prev);
            if (newSet.has(groupTitle)) {
                newSet.delete(groupTitle);
            } else {
                newSet.add(groupTitle);
            }
            return newSet;
        });
    };
    
    const loadMore = () => {
        setDisplayedItems(prev => prev + ITEMS_PER_PAGE);
    };
    
    useEffect(() => {
        // Reset displayed items when transcripts change
        setDisplayedItems(ITEMS_PER_PAGE);
    }, [transcripts]);

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
    
    // Calculate paginated transcripts
    const paginatedGroups = useMemo(() => {
        const groups = groupTranscriptsByDate(transcripts);
        let itemCount = 0;
        const result: typeof groups = [];
        
        for (const group of groups) {
            const visibleTranscripts: Transcript[] = [];
            
            for (const transcript of group.transcripts) {
                if (itemCount < displayedItems) {
                    visibleTranscripts.push(transcript);
                    itemCount++;
                }
            }
            
            if (visibleTranscripts.length > 0) {
                result.push({ title: group.title, transcripts: visibleTranscripts });
            }
        }
        
        return result;
    }, [transcripts, displayedItems]);
    
    const hasMore = transcripts.length > displayedItems;
    
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
                        {paginatedGroups.map(group => (
                            <div key={group.title} className="transcript-group">
                                <div 
                                    className="transcript-group-header"
                                    onClick={() => toggleGroup(group.title)}
                                >
                                    <div className="group-header-left">
                                        <button className="group-toggle-btn">
                                            {expandedGroups.has(group.title) ? 
                                                <ChevronUp size={16} /> : 
                                                <ChevronDown size={16} />
                                            }
                                        </button>
                                        <h3 className="transcript-group-title">{group.title}</h3>
                                        <span className="group-count">({group.transcripts.length})</span>
                                    </div>
                                    <button 
                                        className="select-group-btn"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            const allGroupIds = group.transcripts.map(t => t.id);
                                            const allSelected = allGroupIds.every(id => selectedTranscripts.has(id));
                                            
                                            allGroupIds.forEach(id => {
                                                if (allSelected) {
                                                    // If all are selected, deselect all
                                                    toggleTranscriptSelection(id);
                                                } else if (!selectedTranscripts.has(id)) {
                                                    // If not all are selected, select the unselected ones
                                                    toggleTranscriptSelection(id);
                                                }
                                            });
                                        }}
                                    >
                                        {group.transcripts.every(t => selectedTranscripts.has(t.id)) ? 'Deselect All' : 'Select All'}
                                    </button>
                                </div>
                                {expandedGroups.has(group.title) && (
                                    <div className="transcript-group-items">
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
                                )}
                            </div>
                        ))}
                        {hasMore && (
                            <div className="load-more-container">
                                <button 
                                    className="load-more-btn"
                                    onClick={loadMore}
                                >
                                    Load More ({transcripts.length - displayedItems} remaining)
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
                onExport={(transcripts, format) => exportTranscripts(format)}
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
                        <button className="action-btn export">
                            Export
                        </button>
                        <div className="export-menu">
                            <button onClick={() => exportTranscripts('json')}>As JSON</button>
                            <button onClick={() => exportTranscripts('markdown')}>As Markdown</button>
                            <button onClick={() => exportTranscripts('text')}>As Text</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
} 
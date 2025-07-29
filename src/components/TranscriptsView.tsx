import { useState, useEffect, useMemo, useCallback, memo, useRef } from 'react';
import { TranscriptDetailPanel } from './TranscriptDetailPanel';
import { TranscriptItem } from './TranscriptItem';
import { VirtualizedTranscriptList } from './VirtualizedTranscriptList';
import { ChevronDown } from 'lucide-react';
import { formatShortcut } from '../lib/formatShortcut';
import { Transcript } from '../types/transcript';
import './TranscriptsView.css';
import '../styles/grid-system.css';

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

const ITEMS_PER_PAGE = 50;
const ENABLE_VIRTUALIZATION_THRESHOLD = 100; // Use virtualization when more than 100 items

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
    const [panelState, setPanelState] = useState<{
        transcript: Transcript | null;
        isOpen: boolean;
    }>({ transcript: null, isOpen: false });
    
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['Today', 'Yesterday']));
    const [displayedItems, setDisplayedItems] = useState(ITEMS_PER_PAGE);
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [showFloatingExportMenu, setShowFloatingExportMenu] = useState(false);

    const openDetailPanel = useCallback((transcript: Transcript) => {
        setPanelState({ transcript: transcript, isOpen: true });
    }, []);

    const closeDetailPanel = useCallback(() => {
        setPanelState(prev => ({ ...prev, isOpen: false }));
        // Keep selected transcript for animation
        setTimeout(() => {
            setPanelState(prev => ({ ...prev, transcript: null }));
        }, 200);
    }, []);

    
    const toggleGroup = useCallback((groupTitle: string) => {
        setExpandedGroups(prev => {
            const newSet = new Set(prev);
            if (newSet.has(groupTitle)) {
                newSet.delete(groupTitle);
            } else {
                newSet.add(groupTitle);
            }
            return newSet;
        });
    }, []);
    
    const loadMore = () => {
        setDisplayedItems(prev => prev + ITEMS_PER_PAGE);
    };
    
    useEffect(() => {
        // Reset displayed items when transcripts change
        setDisplayedItems(ITEMS_PER_PAGE);
    }, [transcripts]);
    
    // Handle click outside for menus
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (!target.closest('.export-menu')) {
                setShowExportMenu(false);
            }
            if (!target.closest('.export-dropdown')) {
                setShowFloatingExportMenu(false);
            }
        };
        
        if (showExportMenu || showFloatingExportMenu) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => {
                document.removeEventListener('mousedown', handleClickOutside);
            };
        }
    }, [showExportMenu, showFloatingExportMenu]);

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
    
    // Get all groups (unpaginated) for select all functionality
    const allGroups = useMemo(() => groupTranscriptsByDate(transcripts), [transcripts]);
    
    // Calculate list container height for virtualization
    const [listContainerHeight, setListContainerHeight] = useState(600);
    const listContainerRef = useRef<HTMLDivElement>(null);
    
    useEffect(() => {
        const updateHeight = () => {
            if (listContainerRef.current) {
                const rect = listContainerRef.current.getBoundingClientRect();
                const viewportHeight = window.innerHeight;
                const topOffset = rect.top;
                const bottomPadding = 100; // Space for floating action bar
                const newHeight = viewportHeight - topOffset - bottomPadding;
                setListContainerHeight(Math.max(400, newHeight));
            }
        };
        
        updateHeight();
        window.addEventListener('resize', updateHeight);
        return () => window.removeEventListener('resize', updateHeight);
    }, []);
    
    // Decide whether to use virtualization
    const shouldUseVirtualization = transcripts.length > ENABLE_VIRTUALIZATION_THRESHOLD;
    
    return (
        <div className="transcripts-view-wrapper">
            {/* Header section with search and actions - uses grid padding */}
            <div className="transcripts-view-header">
                <div className="header-grid mb-4">
                    {/* Search Box - expanded to take more space */}
                    <div className="search-container-expanded">
                        <input
                            type="text"
                            className="search-input-expanded"
                            placeholder="Search transcripts..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && searchTranscripts()}
                        />
                    </div>
                    
                    {/* Action Buttons */}
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
                                            onClick={() => setShowExportMenu(!showExportMenu)}
                                        >
                                            Export
                                        </button>
                                        {showExportMenu && (
                                            <div className="absolute top-full mt-1 right-0 bg-zinc-800 border border-zinc-700 rounded-md p-1 min-w-32 shadow-lg z-50">
                                                <button 
                                                    className="block w-full text-left px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-700 rounded transition-colors"
                                                    onClick={() => {
                                                        exportTranscripts('json');
                                                        setShowExportMenu(false);
                                                    }}
                                                >
                                                    JSON
                                                </button>
                                                <button 
                                                    className="block w-full text-left px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-700 rounded transition-colors"
                                                    onClick={() => {
                                                        exportTranscripts('markdown');
                                                        setShowExportMenu(false);
                                                    }}
                                                >
                                                    Markdown
                                                </button>
                                                <button 
                                                    className="block w-full text-left px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-700 rounded transition-colors"
                                                    onClick={() => {
                                                        exportTranscripts('text');
                                                        setShowExportMenu(false);
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
            </div>

            {/* Transcripts section - full width for headers */}
            <div className="transcripts-list-section">
                {transcripts.length === 0 ? (
                    <div className="no-transcripts-container">
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
                    </div>
                ) : shouldUseVirtualization ? (
                    <div className="transcript-list-container" ref={listContainerRef}>
                        <VirtualizedTranscriptList
                            groups={allGroups.map((group, idx) => ({
                                ...group,
                                startIndex: idx
                            }))}
                            expandedGroups={expandedGroups}
                            selectedTranscripts={selectedTranscripts}
                            toggleGroup={toggleGroup}
                            toggleTranscriptSelection={toggleTranscriptSelection}
                            toggleTranscriptGroupSelection={toggleTranscriptGroupSelection}
                            openDetailPanel={openDetailPanel}
                            showDeleteConfirmation={showDeleteConfirmation}
                            formatDuration={formatDuration}
                            panelTranscriptId={panelState.transcript?.id}
                            height={listContainerHeight}
                        />
                    </div>
                ) : (
                    <div className="transcript-list-container" ref={listContainerRef}>
                        {paginatedGroups.map(group => {
                            // Find the full group data for this title
                            const fullGroup = allGroups.find(g => g.title === group.title);
                            const fullGroupTranscripts = fullGroup?.transcripts || [];
                            
                            return (
                                <div key={group.title} className={`transcript-group ${expandedGroups.has(group.title) ? 'expanded' : ''}`}>
                                    <div className="transcript-group-header">
                                        <div className="group-header-left">
                                            <button 
                                                className="group-toggle-btn"
                                                onClick={() => toggleGroup(group.title)}
                                            >
                                                <ChevronDown size={16} className="chevron-icon" />
                                            </button>
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
                                        <div className="transcript-items-container">
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
                            onClick={() => setShowFloatingExportMenu(!showFloatingExportMenu)}
                        >
                            Export
                        </button>
                        {showFloatingExportMenu && (
                            <div className="export-menu">
                                <button onClick={() => {
                                    exportTranscripts('json');
                                    setShowFloatingExportMenu(false);
                                }}>As JSON</button>
                                <button onClick={() => {
                                    exportTranscripts('markdown');
                                    setShowFloatingExportMenu(false);
                                }}>As Markdown</button>
                                <button onClick={() => {
                                    exportTranscripts('text');
                                    setShowFloatingExportMenu(false);
                                }}>As Text</button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}); 
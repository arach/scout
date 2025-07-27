import { useState, useEffect, useMemo, useCallback, memo, useRef, CSSProperties } from 'react';
import { VariableSizeList as List } from 'react-window';
import { TranscriptDetailPanel } from './TranscriptDetailPanel';
import { TranscriptItem } from './TranscriptItem';
import { ChevronDown } from 'lucide-react';
import { formatShortcut } from '../lib/formatShortcut';
import { Transcript } from '../types/transcript';
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

// Types for virtual list items
interface GroupHeaderItem {
    type: 'group-header';
    title: string;
    transcripts: Transcript[];
    index: number;
}

interface TranscriptListItem {
    type: 'transcript';
    transcript: Transcript;
    groupTitle: string;
    index: number;
}

interface EmptyItem {
    type: 'empty';
    index: number;
}

type ListItem = GroupHeaderItem | TranscriptListItem | EmptyItem;

// Heights for different item types
const ITEM_HEIGHTS = {
    GROUP_HEADER: 49, // 14px padding * 2 + 21px content
    TRANSCRIPT: 72, // Based on current TranscriptItem height
    EMPTY_STATE: 300, // Height for the empty state
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
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [showFloatingExportMenu, setShowFloatingExportMenu] = useState(false);
    const [listHeight, setListHeight] = useState(window.innerHeight - 140);
    
    const listRef = useRef<List>(null);
    const itemSizeMap = useRef<Map<number, number>>(new Map());

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
        
        // Reset the size cache when groups are toggled
        if (listRef.current) {
            listRef.current.resetAfterIndex(0);
        }
    }, []);
    
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
    
    // Handle window resize
    useEffect(() => {
        const handleResize = () => {
            setListHeight(window.innerHeight - 140);
        };
        
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Get all groups for reference
    const allGroups = useMemo(() => groupTranscriptsByDate(transcripts), [transcripts]);
    
    // Create flattened list for virtual scrolling
    const flattenedItems = useMemo<ListItem[]>(() => {
        if (transcripts.length === 0) {
            return [{ type: 'empty', index: 0 }];
        }
        
        const items: ListItem[] = [];
        let index = 0;
        
        allGroups.forEach(group => {
            // Add group header
            items.push({
                type: 'group-header',
                title: group.title,
                transcripts: group.transcripts,
                index: index++,
            });
            
            // Add transcripts if group is expanded
            if (expandedGroups.has(group.title)) {
                group.transcripts.forEach(transcript => {
                    items.push({
                        type: 'transcript',
                        transcript,
                        groupTitle: group.title,
                        index: index++,
                    });
                });
            }
        });
        
        return items;
    }, [transcripts, allGroups, expandedGroups]);
    
    // Get item size
    const getItemSize = useCallback((index: number) => {
        // Check if we have a cached size
        if (itemSizeMap.current.has(index)) {
            return itemSizeMap.current.get(index)!;
        }
        
        const item = flattenedItems[index];
        if (!item) return ITEM_HEIGHTS.TRANSCRIPT;
        
        let size: number;
        switch (item.type) {
            case 'group-header':
                size = ITEM_HEIGHTS.GROUP_HEADER;
                break;
            case 'transcript':
                size = ITEM_HEIGHTS.TRANSCRIPT;
                break;
            case 'empty':
                size = ITEM_HEIGHTS.EMPTY_STATE;
                break;
            default:
                size = ITEM_HEIGHTS.TRANSCRIPT;
        }
        
        itemSizeMap.current.set(index, size);
        return size;
    }, [flattenedItems]);
    
    // Reset size cache when items change
    useEffect(() => {
        itemSizeMap.current.clear();
        if (listRef.current) {
            listRef.current.resetAfterIndex(0);
        }
    }, [flattenedItems]);
    
    // Render row component
    const Row = memo(({ index, style }: { index: number; style: CSSProperties }) => {
        const item = flattenedItems[index];
        
        if (!item) return null;
        
        switch (item.type) {
            case 'empty':
                return (
                    <div style={style} className="no-transcripts">
                        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.3">
                            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                            <line x1="12" y1="19" x2="12" y2="22" />
                            <line x1="8" y1="22" x2="16" y2="22" />
                        </svg>
                        <h3>No transcripts yet</h3>
                        <p>Press <span title={hotkey}>{formatShortcut(hotkey)}</span> or click "Start Recording" to begin</p>
                    </div>
                );
                
            case 'group-header': {
                const isExpanded = expandedGroups.has(item.title);
                const allSelected = item.transcripts.every(t => selectedTranscripts.has(t.id));
                const someSelected = item.transcripts.some(t => selectedTranscripts.has(t.id));
                
                return (
                    <div style={style} className={`transcript-group-header ${isExpanded ? 'expanded' : ''}`}>
                        <div className="group-header-left">
                            <input
                                type="checkbox"
                                className="group-checkbox"
                                checked={allSelected}
                                aria-label={`Select all transcripts in ${item.title}`}
                                onChange={(e) => {
                                    e.stopPropagation();
                                    const allGroupIds = item.transcripts.map(t => t.id);
                                    toggleTranscriptGroupSelection(allGroupIds);
                                }}
                            />
                            <button 
                                className="group-toggle-btn"
                                onClick={() => toggleGroup(item.title)}
                                aria-expanded={isExpanded}
                                aria-controls={`group-${item.title}`}
                                aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${item.title} group`}
                            >
                                <ChevronDown size={16} className={`chevron-icon ${isExpanded ? 'expanded' : ''}`} />
                            </button>
                            <h3 
                                className="transcript-group-title"
                                onClick={() => toggleGroup(item.title)}
                            >
                                {item.title}
                            </h3>
                            <span className="group-count">({item.transcripts.length})</span>
                        </div>
                        {someSelected && (
                            <button 
                                className="group-clear-btn"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    const selectedInGroup = item.transcripts.filter(t => selectedTranscripts.has(t.id));
                                    toggleTranscriptGroupSelection(selectedInGroup.map(t => t.id));
                                }}
                            >
                                Clear
                            </button>
                        )}
                    </div>
                );
            }
                
            case 'transcript':
                return (
                    <div style={style}>
                        <TranscriptItem
                            transcript={item.transcript}
                            formatDuration={formatDuration}
                            onDelete={showDeleteConfirmation}
                            onClick={openDetailPanel}
                            showCheckbox={true}
                            isSelected={selectedTranscripts.has(item.transcript.id)}
                            onSelectToggle={toggleTranscriptSelection}
                            isActive={panelState.transcript?.id === item.transcript.id}
                            variant="default"
                        />
                    </div>
                );
                
            default:
                return null;
        }
    });
    
    Row.displayName = 'VirtualRow';
    
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
                        aria-label="Search transcripts"
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
                                aria-label={selectedTranscripts.size === transcripts.length ? 'Deselect all transcripts' : 'Select all transcripts'}
                            >
                                {selectedTranscripts.size === transcripts.length ? 'Deselect All' : 'Select All'}
                            </button>
                            {selectedTranscripts.size > 0 && (
                                <>
                                    <button
                                        className="header-action-btn delete"
                                        onClick={showBulkDeleteConfirmation}
                                        aria-label={`Delete ${selectedTranscripts.size} selected transcripts`}
                                    >
                                        Delete ({selectedTranscripts.size})
                                    </button>
                                    <div className="export-menu relative">
                                        <button 
                                            className="header-action-btn export"
                                            onClick={() => setShowExportMenu(!showExportMenu)}
                                            aria-expanded={showExportMenu}
                                            aria-haspopup="true"
                                            aria-label="Export selected transcripts"
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

            <div className="transcripts-list">
                <List
                    ref={listRef}
                    height={listHeight}
                    itemCount={flattenedItems.length}
                    itemSize={getItemSize}
                    width="100%"
                    className="transcript-list-container"
                    overscanCount={5}
                >
                    {Row}
                </List>
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
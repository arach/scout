import { useState, useEffect, useMemo, useCallback, memo, useRef } from 'react';
import { TranscriptDetailPanel } from './TranscriptDetailPanel';
import { TranscriptItem } from './TranscriptItem';
import { VirtualizedTranscriptList } from './VirtualizedTranscriptList';
import { useTranscriptGrouping } from '../hooks/useTranscriptGrouping';
import { ChevronDown } from 'lucide-react';
import { Transcript } from '../types/transcript';
import './TranscriptsView.css';
import '../styles/grid-system.css';

interface TranscriptsViewProps {
    transcripts: Transcript[];
    selectedTranscripts: Set<number>;
    searchQuery: string;
    hotkey: string;  // Keep for potential future use
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
    selectedTranscriptId?: number | null;
    setSelectedTranscriptId?: (id: number | null) => void;
}

const ITEMS_PER_PAGE = 50;
const ENABLE_VIRTUALIZATION_THRESHOLD = 100; // Use virtualization when more than 100 items

export const TranscriptsView = memo(function TranscriptsView({
    transcripts,
    selectedTranscripts,
    searchQuery,
    hotkey: _hotkey,  // Prefix with underscore to indicate intentionally unused
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
    selectedTranscriptId,
    setSelectedTranscriptId,
}: TranscriptsViewProps) {
    const [panelState, setPanelState] = useState<{
        transcript: Transcript | null;
        isOpen: boolean;
    }>({ transcript: null, isOpen: false });
    
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['Today', 'Yesterday']));
    const [displayedItems, setDisplayedItems] = useState(ITEMS_PER_PAGE);
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [showFloatingExportMenu, setShowFloatingExportMenu] = useState(false);
    const [isSelectionMode, setIsSelectionMode] = useState(false);

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

    // Auto-open transcript detail panel when selectedTranscriptId is provided
    useEffect(() => {
        if (selectedTranscriptId && setSelectedTranscriptId) {
            const transcript = transcripts.find(t => t.id === selectedTranscriptId);
            if (transcript) {
                // Find the group this transcript belongs to and expand it
                for (const group of transcriptGroups) {
                    if (group.transcripts.some(t => t.id === selectedTranscriptId)) {
                        setExpandedGroups(prev => new Set([...prev, group.title]));
                        break;
                    }
                }
                
                // Open the detail panel
                openDetailPanel(transcript);
                
                // Clear the selected transcript ID
                setSelectedTranscriptId(null);
            }
        }
    }, [selectedTranscriptId, transcripts, setSelectedTranscriptId, openDetailPanel]);
    
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

    // Use optimized transcript grouping hook
    const transcriptGroups = useTranscriptGrouping(transcripts);
    
    // Calculate paginated transcripts using optimized groups
    const paginatedGroups = useMemo(() => {
        let itemCount = 0;
        const result: typeof transcriptGroups = [];
        
        for (const group of transcriptGroups) {
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
    }, [transcriptGroups, displayedItems]);
    
    const hasMore = transcripts.length > displayedItems;
    
    // Use the already computed groups for select all functionality
    const allGroups = transcriptGroups;
    
    // Ref for the list container
    const listContainerRef = useRef<HTMLDivElement>(null);
    
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
                            onKeyDown={(e) => e.key === 'Enter' && searchTranscripts()}
                        />
                    </div>
                    
                    {/* Action Buttons */}
                    <div className="header-actions-container">
                    {transcripts.length > 0 && (
                        <>
                            <button
                                className="header-action-btn select-mode"
                                onClick={() => {
                                    setIsSelectionMode(!isSelectionMode);
                                    // Clear selections when exiting selection mode
                                    if (isSelectionMode && selectedTranscripts?.size > 0) {
                                        selectAllTranscripts(); // This will deselect all
                                    }
                                }}
                            >
                                {isSelectionMode ? 'Cancel' : 'Select'}
                            </button>
                            {isSelectionMode && (
                                <button
                                    className="header-action-btn select-all"
                                    onClick={selectAllTranscripts}
                                >
                                    {selectedTranscripts?.size === transcripts.length ? 'Deselect All' : 'Select All'}
                                </button>
                            )}
                            {selectedTranscripts?.size > 0 && (
                                <>
                                    <button
                                        className="header-action-btn delete"
                                        onClick={showBulkDeleteConfirmation}
                                    >
                                        Delete ({selectedTranscripts?.size || 0})
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
                    <div className="transcripts-empty-table">
                        <div className="transcripts-table-header">
                            <div className="transcript-column-time">TIME</div>
                            <div className="transcript-column-duration">DURATION</div>
                            <div className="transcript-column-content">TRANSCRIPT</div>
                            <div className="transcript-column-actions"></div>
                        </div>
                        <div className="transcripts-empty-body">
                            <div className="transcripts-empty-message">
                                <p className="empty-title">No transcripts yet</p>
                                <p className="empty-subtitle">
                                    Start recording or upload an audio file to begin
                                </p>
                            </div>
                        </div>
                    </div>
                ) : shouldUseVirtualization ? (
                    <div className="transcript-list-container virtualized" ref={listContainerRef}>
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
                            isSelectionMode={isSelectionMode}
                        />
                    </div>
                ) : (
                    <div className="transcript-list-container" ref={listContainerRef}>
                        <div className="transcript-list-scrollable">
                        {paginatedGroups.map(group => {
                            // Find the full group data for this title
                            const fullGroup = transcriptGroups.find(g => g.title === group.title);
                            const fullGroupTranscripts = fullGroup?.transcripts || [];
                            
                            return (
                                <div key={group.title} className={`transcript-group ${expandedGroups.has(group.title) ? 'expanded' : ''}`}>
                                    <div className="transcript-group-header" onClick={() => toggleGroup(group.title)}>
                                        <div className="group-header-left">
                                            <button 
                                                className="group-toggle-btn"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    toggleGroup(group.title);
                                                }}
                                            >
                                                <ChevronDown size={12} className="chevron-icon" />
                                            </button>
                                            {isSelectionMode && (
                                                <input
                                                    type="checkbox"
                                                    className="group-checkbox"
                                                    checked={fullGroupTranscripts.every(t => selectedTranscripts.has(t.id))}
                                                    onChange={(e) => {
                                                        e.stopPropagation();
                                                        const allGroupIds = fullGroupTranscripts.map(t => t.id);
                                                        toggleTranscriptGroupSelection(allGroupIds);
                                                    }}
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                            )}
                                            <h3 className="transcript-group-title">
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
                                                        showCheckbox={isSelectionMode}
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
            
            {selectedTranscripts?.size > 0 && (
                <div className="floating-action-bar">
                    <span className="selection-count">
                        {selectedTranscripts?.size || 0} selected
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
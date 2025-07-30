import { useRef, useCallback, useState, useEffect, memo } from 'react';
import { VariableSizeList as List } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { ChevronDown } from 'lucide-react';
import { TranscriptItem } from './TranscriptItem';
import { Transcript } from '../types/transcript';

interface TranscriptGroup {
    title: string;
    transcripts: Transcript[];
    startIndex: number;
}

interface VirtualizedTranscriptListProps {
    groups: TranscriptGroup[];
    expandedGroups: Set<string>;
    selectedTranscripts: Set<number>;
    toggleGroup: (groupTitle: string) => void;
    toggleTranscriptSelection: (id: number) => void;
    toggleTranscriptGroupSelection: (ids: number[]) => void;
    openDetailPanel: (transcript: Transcript) => void;
    showDeleteConfirmation: (id: number, text: string) => void;
    formatDuration: (ms: number) => string;
    panelTranscriptId?: number;
    isSelectionMode?: boolean;
}

const GROUP_HEADER_HEIGHT = 36;
const TRANSCRIPT_ITEM_HEIGHT = 48;

interface ListItem {
    type: 'header' | 'transcript';
    data: TranscriptGroup | Transcript;
    groupTitle?: string;
}

export const VirtualizedTranscriptList = memo(function VirtualizedTranscriptList({
    groups,
    expandedGroups,
    selectedTranscripts,
    toggleGroup,
    toggleTranscriptSelection,
    toggleTranscriptGroupSelection,
    openDetailPanel,
    showDeleteConfirmation,
    formatDuration,
    panelTranscriptId,
    isSelectionMode = false
}: VirtualizedTranscriptListProps) {
    const listRef = useRef<List>(null);
    const [listItems, setListItems] = useState<ListItem[]>([]);
    const itemSizeCache = useRef<Record<number, number>>({});

    // Build flat list of items for virtualization
    useEffect(() => {
        const items: ListItem[] = [];
        
        groups.forEach(group => {
            // Add group header
            items.push({
                type: 'header',
                data: group
            });
            
            // Add transcripts if group is expanded
            if (expandedGroups.has(group.title)) {
                group.transcripts.forEach(transcript => {
                    items.push({
                        type: 'transcript',
                        data: transcript,
                        groupTitle: group.title
                    });
                });
            }
        });
        
        setListItems(items);
        
        // Clear size cache when items change
        itemSizeCache.current = {};
        
        // Reset list to recalculate sizes
        if (listRef.current) {
            listRef.current.resetAfterIndex(0);
        }
    }, [groups, expandedGroups]);

    const getItemSize = useCallback((index: number): number => {
        // Return cached size if available
        if (itemSizeCache.current[index] !== undefined) {
            return itemSizeCache.current[index];
        }
        
        const item = listItems[index];
        if (!item) return TRANSCRIPT_ITEM_HEIGHT;
        
        const size = item.type === 'header' ? GROUP_HEADER_HEIGHT : TRANSCRIPT_ITEM_HEIGHT;
        itemSizeCache.current[index] = size;
        return size;
    }, [listItems]);

    const Row = ({ index, style }: { index: number; style: React.CSSProperties }) => {
        const item = listItems[index];
        if (!item) return null;

        if (item.type === 'header') {
            const group = item.data as TranscriptGroup;
            const fullGroupTranscripts = groups.find(g => g.title === group.title)?.transcripts || [];
            
            return (
                <div style={style} className={`transcript-group ${expandedGroups.has(group.title) ? 'expanded' : ''}`}>
                    <div className="transcript-group-header">
                        <div className="group-header-left">
                            <button 
                                className="group-toggle-btn"
                                onClick={() => toggleGroup(group.title)}
                            >
                                <ChevronDown 
                                    size={16} 
                                    className="chevron-icon"
                                />
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
                                />
                            )}
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
                </div>
            );
        } else {
            const transcript = item.data as Transcript;
            
            return (
                <TranscriptItem
                    transcript={transcript}
                    formatDuration={formatDuration}
                    onDelete={showDeleteConfirmation}
                    onClick={openDetailPanel}
                    showCheckbox={isSelectionMode}
                    isSelected={selectedTranscripts.has(transcript.id)}
                    onSelectToggle={toggleTranscriptSelection}
                    isActive={panelTranscriptId === transcript.id}
                    variant="default"
                    style={style}
                />
            );
        }
    };

    return (
        <div 
            className="virtualized-list-wrapper"
            style={{ 
                width: '100%', 
                height: '100%', 
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0
            }}
        >
            <AutoSizer>
                {({ height, width }) => {
                    console.log('AutoSizer dimensions:', { height, width });
                    
                    // Ensure we have valid dimensions
                    if (!height || !width || height === 0 || width === 0) {
                        console.warn('AutoSizer returned invalid dimensions');
                        return (
                            <div style={{ padding: '20px', textAlign: 'center' }}>
                                Loading transcripts...
                            </div>
                        );
                    }
                    
                    return (
                        <List
                            ref={listRef}
                            height={height}
                            itemCount={listItems.length}
                            itemSize={getItemSize}
                            width={width}
                            className="transcript-list-virtual"
                            style={{ overflow: 'auto' }}
                        >
                            {Row}
                        </List>
                    );
                }}
            </AutoSizer>
        </div>
    );
});
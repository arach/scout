import { memo, useCallback, useRef, CSSProperties } from 'react';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';

interface VirtualizedListProps<T> {
  items: T[];
  itemHeight: number;
  renderItem: (item: T, index: number, style: CSSProperties) => React.ReactNode;
  overscan?: number;
  className?: string;
  onScroll?: (scrollOffset: number) => void;
}

export const VirtualizedList = memo(<T extends any>({
  items,
  itemHeight,
  renderItem,
  overscan = 3,
  className = '',
  onScroll
}: VirtualizedListProps<T>) => {
  const listRef = useRef<List>(null);

  const Row = useCallback(({ index, style }: ListChildComponentProps) => {
    const item = items[index];
    if (!item) return null;
    
    return <div style={style}>{renderItem(item, index, style)}</div>;
  }, [items, renderItem]);

  const handleScroll = useCallback(({ scrollOffset }: { scrollOffset: number }) => {
    onScroll?.(scrollOffset);
  }, [onScroll]);

  return (
    <div className={`virtualized-list-container ${className}`}>
      <AutoSizer>
        {({ height, width }: { height: number; width: number }) => (
          <List
            ref={listRef}
            height={height}
            itemCount={items.length}
            itemSize={itemHeight}
            width={width}
            overscanCount={overscan}
            onScroll={handleScroll}
          >
            {Row}
          </List>
        )}
      </AutoSizer>
    </div>
  );
}) as <T>(props: VirtualizedListProps<T>) => JSX.Element;

// Export utility hook for scroll restoration
export function useScrollRestoration(key: string) {
  const scrollPositions = useRef<Map<string, number>>(new Map());

  const saveScrollPosition = useCallback((position: number) => {
    scrollPositions.current.set(key, position);
  }, [key]);

  const restoreScrollPosition = useCallback(() => {
    return scrollPositions.current.get(key) || 0;
  }, [key]);

  return { saveScrollPosition, restoreScrollPosition };
}
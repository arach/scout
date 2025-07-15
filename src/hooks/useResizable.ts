import { useState, useEffect, useRef, useCallback } from 'react';

interface UseResizableOptions {
    minWidth?: number;
    maxWidth?: number;
    defaultWidth?: number;
    onResize?: (width: number) => void;
}

export function useResizable({
    minWidth = 400,
    maxWidth = 1200,
    defaultWidth = 600,
    onResize
}: UseResizableOptions = {}) {
    const [width, setWidth] = useState(defaultWidth);
    const [isResizing, setIsResizing] = useState(false);
    const resizeHandleRef = useRef<HTMLDivElement>(null);
    const startXRef = useRef(0);
    const startWidthRef = useRef(0);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizing(true);
        startXRef.current = e.clientX;
        startWidthRef.current = width;
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
    }, [width]);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isResizing) return;
        
        const deltaX = startXRef.current - e.clientX; // Negative because we're resizing from the left
        const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidthRef.current + deltaX));
        
        setWidth(newWidth);
        onResize?.(newWidth);
    }, [isResizing, minWidth, maxWidth, onResize]);

    const handleMouseUp = useCallback(() => {
        if (isResizing) {
            setIsResizing(false);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    }, [isResizing]);

    useEffect(() => {
        if (isResizing) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            
            return () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
            };
        }
    }, [isResizing, handleMouseMove, handleMouseUp]);

    return {
        width,
        isResizing,
        resizeHandleProps: {
            ref: resizeHandleRef,
            onMouseDown: handleMouseDown,
            style: { cursor: 'ew-resize' }
        }
    };
}
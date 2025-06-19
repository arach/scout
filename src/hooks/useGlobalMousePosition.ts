import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

interface MousePosition {
  x: number;
  y: number;
}

export function useGlobalMousePosition(enabled: boolean = true) {
  const [mousePosition] = useState<MousePosition>({ x: 0, y: 0 });
  const [windowBounds, setWindowBounds] = useState<DOMRect | null>(null);
  const [isHovering] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    let animationFrameId: number;
    let lastCheck = 0;
    const CHECK_INTERVAL = 50; // Check every 50ms

    const checkHover = async (timestamp: number) => {
      if (timestamp - lastCheck >= CHECK_INTERVAL) {
        lastCheck = timestamp;
        
        try {
          const window = getCurrentWindow();
          
          // Get window position and size
          const position = await window.outerPosition();
          const size = await window.outerSize();
          const scaleFactor = await window.scaleFactor();
          
          // Convert to screen coordinates
          const bounds = {
            left: position.x / scaleFactor,
            top: position.y / scaleFactor,
            right: (position.x + size.width) / scaleFactor,
            bottom: (position.y + size.height) / scaleFactor,
            width: size.width / scaleFactor,
            height: size.height / scaleFactor,
            x: position.x / scaleFactor,
            y: position.y / scaleFactor
          } as DOMRect;
          
          setWindowBounds(bounds);
          
          // Check if mouse is within bounds
          // This would need a way to get global mouse position
          // For now, we'll rely on the regular mouse events
        } catch (error) {
          console.error('Failed to get window bounds:', error);
        }
      }
      
      animationFrameId = requestAnimationFrame(checkHover);
    };

    animationFrameId = requestAnimationFrame(checkHover);

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [enabled]);

  return { mousePosition, windowBounds, isHovering };
}
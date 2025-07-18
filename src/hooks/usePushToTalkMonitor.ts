import { useEffect, useRef } from 'react';

interface UsePushToTalkMonitorOptions {
  enabled: boolean;
  shortcut: string;
  onRelease: () => void;
}

export function usePushToTalkMonitor({ enabled, shortcut, onRelease }: UsePushToTalkMonitorOptions) {
  const isMonitoringRef = useRef(false);
  const keyDownRef = useRef(false);

  useEffect(() => {
    if (!enabled || !shortcut) return;

    // Parse the shortcut to get the key
    const parts = shortcut.split('+');
    const mainKey = parts[parts.length - 1].toUpperCase();
    
    // Map of special keys
    const keyMap: Record<string, string> = {
      'SPACE': ' ',
      'ENTER': 'Enter',
      'TAB': 'Tab',
      'ESCAPE': 'Escape',
      'BACKSPACE': 'Backspace',
      'DELETE': 'Delete',
      'UP': 'ArrowUp',
      'DOWN': 'ArrowDown',
      'LEFT': 'ArrowLeft',
      'RIGHT': 'ArrowRight',
    };
    
    const keyToCheck = keyMap[mainKey] || mainKey;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if it matches our shortcut
      if (e.key.toUpperCase() === keyToCheck || e.key === keyToCheck) {
        // Check modifiers
        const needsCmd = shortcut.includes('Cmd') || shortcut.includes('Command');
        const needsCtrl = shortcut.includes('Ctrl') || shortcut.includes('Control');
        const needsShift = shortcut.includes('Shift');
        const needsAlt = shortcut.includes('Alt') || shortcut.includes('Option');
        
        const modifiersMatch = 
          (!needsCmd || (e.metaKey || e.ctrlKey)) &&
          (!needsCtrl || e.ctrlKey) &&
          (!needsShift || e.shiftKey) &&
          (!needsAlt || e.altKey);
        
        if (modifiersMatch && !keyDownRef.current) {
          keyDownRef.current = true;
          isMonitoringRef.current = true;
          console.log('[PushToTalkMonitor] Key down detected:', shortcut);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      // Check if it's our key being released
      if (e.key.toUpperCase() === keyToCheck || e.key === keyToCheck) {
        if (keyDownRef.current && isMonitoringRef.current) {
          keyDownRef.current = false;
          isMonitoringRef.current = false;
          console.log('[PushToTalkMonitor] Key up detected:', shortcut);
          onRelease();
        }
      }
    };

    // Add event listeners
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      keyDownRef.current = false;
      isMonitoringRef.current = false;
    };
  }, [enabled, shortcut, onRelease]);

  return { isMonitoring: isMonitoringRef.current };
}
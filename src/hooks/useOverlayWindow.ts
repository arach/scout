import { useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

export function useOverlayWindow() {
  useEffect(() => {
    const setupWindow = async () => {
      try {
        const window = getCurrentWindow();
        
        // Make sure the window stays on top
        await window.setAlwaysOnTop(true);
        
        // Try to configure the window to not steal focus
        await window.setSkipTaskbar(true);
        
        // This might help with hover detection
        await window.setIgnoreCursorEvents(false);
        
        console.log('🪟 Overlay window configured for hover detection');
      } catch (error) {
        console.error('Failed to configure overlay window:', error);
      }
    };
    
    setupWindow();
    
    // Also listen for window blur/focus events to debug
    const window = getCurrentWindow();
    const unlistenFocus = window.onFocusChanged((focused) => {
      console.log(`🪟 Overlay window focus changed: ${focused ? 'focused' : 'blurred'}`);
    });
    
    return () => {
      unlistenFocus.then(fn => fn());
    };
  }, []);
}
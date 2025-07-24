import { listen } from '@tauri-apps/api/event';

/**
 * Safely creates an event listener with proper cleanup handling
 * This prevents the "undefined is not an object" errors when cleaning up listeners
 */
export async function safeEventListen<T>(
  event: string,
  handler: (event: { payload: T }) => void
): Promise<() => void> {
  try {
    const unlisten = await listen<T>(event, handler);
    
    // Return a safe cleanup function
    return () => {
      try {
        if (typeof unlisten === 'function') {
          unlisten();
        }
      } catch (error) {
        console.warn(`Error cleaning up listener for ${event}:`, error);
      }
    };
  } catch (error) {
    console.error(`Failed to set up listener for ${event}:`, error);
    // Return no-op function if listener setup fails
    return () => {};
  }
}

/**
 * Cleanup multiple event listeners safely
 */
export function cleanupListeners(listeners: Array<(() => void) | undefined>): void {
  listeners.forEach(cleanup => {
    if (cleanup && typeof cleanup === 'function') {
      try {
        cleanup();
      } catch (error) {
        console.warn('Error during listener cleanup:', error);
      }
    }
  });
}
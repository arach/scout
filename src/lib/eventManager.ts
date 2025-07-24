import { listen } from '@tauri-apps/api/event';

/**
 * Enhanced event listener manager with proper cleanup and error recovery
 */
export class EventManager {
  private listeners = new Map<string, () => void>();
  private mounted = true;

  /**
   * Register an event listener with guaranteed cleanup
   */
  async register<T>(
    event: string,
    handler: (event: { payload: T }) => void,
    _options: { immediate?: boolean } = {}
  ): Promise<void> {
    if (!this.mounted) {
      console.warn(`Attempted to register listener for ${event} after cleanup`);
      return;
    }

    try {
      const unlisten = await listen<T>(event, (eventData) => {
        // Double-check mounted state before executing handler
        if (!this.mounted) return;
        
        try {
          handler(eventData);
        } catch (error) {
          console.error(`Error in event handler for ${event}:`, error);
        }
      });

      // Store cleanup function
      const cleanup = () => {
        try {
          if (typeof unlisten === 'function') {
            unlisten();
          }
        } catch (error) {
          console.warn(`Error cleaning up listener for ${event}:`, error);
        }
      };

      this.listeners.set(event, cleanup);
    } catch (error) {
      console.error(`Failed to register listener for ${event}:`, error);
    }
  }

  /**
   * Unregister a specific event listener
   */
  unregister(event: string): void {
    const cleanup = this.listeners.get(event);
    if (cleanup) {
      cleanup();
      this.listeners.delete(event);
    }
  }

  /**
   * Cleanup all registered listeners
   */
  cleanup(): void {
    this.mounted = false;
    
    this.listeners.forEach((cleanup, event) => {
      try {
        cleanup();
      } catch (error) {
        console.warn(`Error cleaning up listener for ${event}:`, error);
      }
    });
    
    this.listeners.clear();
  }

  /**
   * Check if the manager is still active
   */
  isActive(): boolean {
    return this.mounted;
  }

  /**
   * Get the number of active listeners
   */
  getListenerCount(): number {
    return this.listeners.size;
  }
}

/**
 * Hook for using the event manager
 */
import { useEffect, useRef } from 'react';

export function useEventManager(): EventManager {
  const managerRef = useRef<EventManager>();

  if (!managerRef.current) {
    managerRef.current = new EventManager();
  }

  useEffect(() => {
    const manager = managerRef.current!;
    
    return () => {
      manager.cleanup();
    };
  }, []);

  return managerRef.current;
}
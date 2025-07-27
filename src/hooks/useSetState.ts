import { useState, useCallback } from 'react';

/**
 * Optimized hook for managing Set state with memoized operations
 * to prevent unnecessary re-renders and improve performance
 */
export function useSetState<T>(initialSet?: Set<T>) {
  const [set, setSet] = useState<Set<T>>(initialSet || new Set<T>());

  const add = useCallback((item: T) => {
    setSet(prev => {
      if (prev.has(item)) return prev; // No change, return same reference
      const newSet = new Set(prev);
      newSet.add(item);
      return newSet;
    });
  }, []);

  const remove = useCallback((item: T) => {
    setSet(prev => {
      if (!prev.has(item)) return prev; // No change, return same reference
      const newSet = new Set(prev);
      newSet.delete(item);
      return newSet;
    });
  }, []);

  const toggle = useCallback((item: T) => {
    setSet(prev => {
      const newSet = new Set(prev);
      if (newSet.has(item)) {
        newSet.delete(item);
      } else {
        newSet.add(item);
      }
      return newSet;
    });
  }, []);

  const clear = useCallback(() => {
    setSet(prev => {
      if (prev.size === 0) return prev; // No change, return same reference
      return new Set<T>();
    });
  }, []);

  const addMultiple = useCallback((items: T[]) => {
    setSet(prev => {
      const newSet = new Set(prev);
      let hasChanges = false;
      items.forEach(item => {
        if (!newSet.has(item)) {
          newSet.add(item);
          hasChanges = true;
        }
      });
      return hasChanges ? newSet : prev;
    });
  }, []);

  const removeMultiple = useCallback((items: T[]) => {
    setSet(prev => {
      const newSet = new Set(prev);
      let hasChanges = false;
      items.forEach(item => {
        if (newSet.has(item)) {
          newSet.delete(item);
          hasChanges = true;
        }
      });
      return hasChanges ? newSet : prev;
    });
  }, []);

  const toggleMultiple = useCallback((items: T[]) => {
    setSet(prev => {
      const newSet = new Set(prev);
      const allSelected = items.every(item => newSet.has(item));
      
      if (allSelected) {
        // Remove all
        items.forEach(item => newSet.delete(item));
      } else {
        // Add all
        items.forEach(item => newSet.add(item));
      }
      return newSet;
    });
  }, []);

  const replaceAll = useCallback((newItems: T[]) => {
    setSet(new Set(newItems));
  }, []);

  return {
    set,
    add,
    remove,
    toggle,
    clear,
    addMultiple,
    removeMultiple,
    toggleMultiple,
    replaceAll,
    size: set.size,
    has: (item: T) => set.has(item),
  };
}

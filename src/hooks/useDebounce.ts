import { useState, useEffect, useRef } from 'react';

/**
 * Debounce hook that delays the update of a value until after a specified delay
 * @param value - The value to debounce
 * @param delay - The delay in milliseconds
 * @returns The debounced value
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);
  
  return debouncedValue;
}

/**
 * Debounced callback hook that delays execution of a callback function
 * @param callback - The callback function to debounce
 * @param delay - The delay in milliseconds
 * @param dependencies - Dependencies for the callback
 * @returns The debounced callback function
 */
export function useDebouncedCallback<TArgs extends any[]>(
  callback: (...args: TArgs) => void,
  delay: number,
  dependencies: React.DependencyList = []
) {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const debouncedCallback = (...args: TArgs) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    timeoutRef.current = setTimeout(() => {
      callback(...args);
    }, delay);
  };
  
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, dependencies);
  
  return debouncedCallback;
}

/**
 * Advanced debounce hook with immediate execution option and cancel capability
 * @param callback - The callback function to debounce
 * @param delay - The delay in milliseconds
 * @param immediate - Whether to execute immediately on first call
 * @returns Object with debounced function, cancel function, and pending state
 */
export function useAdvancedDebounce<TArgs extends any[]>(
  callback: (...args: TArgs) => void,
  delay: number,
  immediate: boolean = false
) {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isPending, setIsPending] = useState(false);
  
  const cancel = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      setIsPending(false);
    }
  };
  
  const debouncedCallback = (...args: TArgs) => {
    const callNow = immediate && !timeoutRef.current;
    
    cancel();
    setIsPending(true);
    
    if (callNow) {
      callback(...args);
      setIsPending(false);
    }
    
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setIsPending(false);
      if (!immediate) {
        callback(...args);
      }
    }, delay);
  };
  
  useEffect(() => {
    return () => {
      cancel();
    };
  }, []);
  
  return {
    debouncedCallback,
    cancel,
    isPending
  };
}

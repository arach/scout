import { useEffect, useRef, useCallback } from 'react';

export function useFocusTrap(isActive: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  const getFocusableElements = useCallback(() => {
    if (!containerRef.current) return [];
    
    const selectors = [
      'a[href]',
      'button:not(:disabled)',
      'textarea:not(:disabled)',
      'input:not(:disabled)',
      'select:not(:disabled)',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    
    return Array.from(containerRef.current.querySelectorAll(selectors)) as HTMLElement[];
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Tab' || !containerRef.current) return;
    
    const focusableElements = getFocusableElements();
    if (focusableElements.length === 0) return;
    
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    
    if (e.shiftKey && document.activeElement === firstElement) {
      e.preventDefault();
      lastElement.focus();
    } else if (!e.shiftKey && document.activeElement === lastElement) {
      e.preventDefault();
      firstElement.focus();
    }
  }, [getFocusableElements]);

  useEffect(() => {
    if (!isActive) return;
    
    // Store the currently focused element
    previousActiveElement.current = document.activeElement as HTMLElement;
    
    // Focus the first focusable element in the container
    const focusableElements = getFocusableElements();
    if (focusableElements.length > 0) {
      // Use setTimeout to ensure the modal is fully rendered
      setTimeout(() => {
        const autoFocusElement = containerRef.current?.querySelector('[autofocus]') as HTMLElement;
        if (autoFocusElement) {
          autoFocusElement.focus();
        } else {
          focusableElements[0].focus();
        }
      }, 0);
    }
    
    // Add event listener for tab key
    document.addEventListener('keydown', handleKeyDown);
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      
      // Restore focus to the previously focused element
      if (previousActiveElement.current && previousActiveElement.current.focus) {
        previousActiveElement.current.focus();
      }
    };
  }, [isActive, handleKeyDown, getFocusableElements]);

  return containerRef;
}
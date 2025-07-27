import { useEffect, useCallback } from 'react';

interface KeyboardNavigationOptions {
  enabled?: boolean;
  onEscape?: () => void;
  onEnter?: () => void;
  onArrowUp?: () => void;
  onArrowDown?: () => void;
  onArrowLeft?: () => void;
  onArrowRight?: () => void;
  onTab?: (e: KeyboardEvent) => void;
  preventDefault?: boolean;
}

/**
 * Hook for handling keyboard navigation in components
 * Provides consistent keyboard interaction patterns across the app
 */
export function useKeyboardNavigation(options: KeyboardNavigationOptions = {}) {
  const {
    enabled = true,
    onEscape,
    onEnter,
    onArrowUp,
    onArrowDown,
    onArrowLeft,
    onArrowRight,
    onTab,
    preventDefault = true
  } = options;

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!enabled) return;

    let handled = false;

    switch (e.key) {
      case 'Escape':
        if (onEscape) {
          onEscape();
          handled = true;
        }
        break;
      case 'Enter':
        if (onEnter) {
          onEnter();
          handled = true;
        }
        break;
      case 'ArrowUp':
        if (onArrowUp) {
          onArrowUp();
          handled = true;
        }
        break;
      case 'ArrowDown':
        if (onArrowDown) {
          onArrowDown();
          handled = true;
        }
        break;
      case 'ArrowLeft':
        if (onArrowLeft) {
          onArrowLeft();
          handled = true;
        }
        break;
      case 'ArrowRight':
        if (onArrowRight) {
          onArrowRight();
          handled = true;
        }
        break;
      case 'Tab':
        if (onTab) {
          onTab(e);
          handled = true;
        }
        break;
    }

    if (handled && preventDefault) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, [enabled, onEscape, onEnter, onArrowUp, onArrowDown, onArrowLeft, onArrowRight, onTab, preventDefault]);

  useEffect(() => {
    if (!enabled) return;

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, handleKeyDown]);
}

/**
 * Hook for managing focus trap within a container
 * Useful for modals, dropdowns, and other overlay components
 */
export function useFocusTrap(containerRef: React.RefObject<HTMLElement>, enabled = true) {
  const handleTabKey = useCallback((e: KeyboardEvent) => {
    if (!containerRef.current || !enabled) return;

    const focusableElements = containerRef.current.querySelectorAll<HTMLElement>(
      'a[href], button, textarea, input[type="text"], input[type="radio"], input[type="checkbox"], select, [tabindex]:not([tabindex="-1"])'
    );

    const focusableArray = Array.from(focusableElements);
    const firstElement = focusableArray[0];
    const lastElement = focusableArray[focusableArray.length - 1];

    if (e.shiftKey && document.activeElement === firstElement) {
      e.preventDefault();
      lastElement?.focus();
    } else if (!e.shiftKey && document.activeElement === lastElement) {
      e.preventDefault();
      firstElement?.focus();
    }
  }, [containerRef, enabled]);

  useKeyboardNavigation({
    enabled,
    onTab: handleTabKey
  });

  // Focus first element on mount
  useEffect(() => {
    if (!enabled || !containerRef.current) return;

    const focusableElements = containerRef.current.querySelectorAll<HTMLElement>(
      'a[href], button, textarea, input[type="text"], input[type="radio"], input[type="checkbox"], select, [tabindex]:not([tabindex="-1"])'
    );

    const firstElement = focusableElements[0];
    firstElement?.focus();
  }, [enabled, containerRef]);
}
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useSetState } from '../useSetState';

describe('useSetState', () => {
  it('should initialize with empty set by default', () => {
    const { result } = renderHook(() => useSetState<number>());
    
    expect(result.current.set.size).toBe(0);
    expect(result.current.size).toBe(0);
  });

  it('should initialize with provided set', () => {
    const initialSet = new Set([1, 2, 3]);
    const { result } = renderHook(() => useSetState(initialSet));
    
    expect(result.current.set.size).toBe(3);
    expect(result.current.size).toBe(3);
    expect(result.current.has(1)).toBe(true);
    expect(result.current.has(2)).toBe(true);
    expect(result.current.has(3)).toBe(true);
  });

  it('should add items to set', () => {
    const { result } = renderHook(() => useSetState<number>());
    
    act(() => {
      result.current.add(1);
    });
    
    expect(result.current.set.size).toBe(1);
    expect(result.current.has(1)).toBe(true);
  });

  it('should not re-render when adding existing item', () => {
    const { result } = renderHook(() => useSetState(new Set([1])));
    const initialSet = result.current.set;
    
    act(() => {
      result.current.add(1);
    });
    
    // Should return the same reference for no-op operations
    expect(result.current.set).toBe(initialSet);
  });

  it('should remove items from set', () => {
    const { result } = renderHook(() => useSetState(new Set([1, 2])));
    
    act(() => {
      result.current.remove(1);
    });
    
    expect(result.current.set.size).toBe(1);
    expect(result.current.has(1)).toBe(false);
    expect(result.current.has(2)).toBe(true);
  });

  it('should not re-render when removing non-existent item', () => {
    const { result } = renderHook(() => useSetState(new Set([1])));
    const initialSet = result.current.set;
    
    act(() => {
      result.current.remove(2);
    });
    
    // Should return the same reference for no-op operations
    expect(result.current.set).toBe(initialSet);
  });

  it('should toggle items in set', () => {
    const { result } = renderHook(() => useSetState(new Set([1])));
    
    // Toggle existing item (remove)
    act(() => {
      result.current.toggle(1);
    });
    
    expect(result.current.has(1)).toBe(false);
    
    // Toggle non-existing item (add)
    act(() => {
      result.current.toggle(1);
    });
    
    expect(result.current.has(1)).toBe(true);
  });

  it('should clear all items', () => {
    const { result } = renderHook(() => useSetState(new Set([1, 2, 3])));
    
    act(() => {
      result.current.clear();
    });
    
    expect(result.current.set.size).toBe(0);
  });

  it('should not re-render when clearing empty set', () => {
    const { result } = renderHook(() => useSetState<number>());
    const initialSet = result.current.set;
    
    act(() => {
      result.current.clear();
    });
    
    expect(result.current.set).toBe(initialSet);
  });

  it('should add multiple items efficiently', () => {
    const { result } = renderHook(() => useSetState(new Set([1])));
    
    act(() => {
      result.current.addMultiple([2, 3, 4]);
    });
    
    expect(result.current.set.size).toBe(4);
    expect(result.current.has(2)).toBe(true);
    expect(result.current.has(3)).toBe(true);
    expect(result.current.has(4)).toBe(true);
  });

  it('should toggle multiple items', () => {
    const { result } = renderHook(() => useSetState(new Set([1, 2])));
    
    // All items exist, should remove all
    act(() => {
      result.current.toggleMultiple([1, 2]);
    });
    
    expect(result.current.set.size).toBe(0);
    
    // No items exist, should add all
    act(() => {
      result.current.toggleMultiple([1, 2, 3]);
    });
    
    expect(result.current.set.size).toBe(3);
  });

  it('should replace all items', () => {
    const { result } = renderHook(() => useSetState(new Set([1, 2, 3])));
    
    act(() => {
      result.current.replaceAll([4, 5, 6]);
    });
    
    expect(result.current.set.size).toBe(3);
    expect(result.current.has(1)).toBe(false);
    expect(result.current.has(4)).toBe(true);
    expect(result.current.has(5)).toBe(true);
    expect(result.current.has(6)).toBe(true);
  });
});

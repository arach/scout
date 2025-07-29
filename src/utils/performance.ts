import { useRef, useEffect, useCallback } from 'react';

/**
 * Performance monitoring utilities for tracking app performance
 */

interface PerformanceMark {
  name: string;
  startTime: number;
  duration?: number;
  metadata?: Record<string, any>;
}

class PerformanceMonitor {
  private marks: Map<string, PerformanceMark> = new Map();
  private enabled: boolean = process.env.NODE_ENV === 'development';

  /**
   * Start a performance measurement
   */
  startMeasure(name: string, metadata?: Record<string, any>): void {
    if (!this.enabled) return;

    this.marks.set(name, {
      name,
      startTime: performance.now(),
      metadata
    });
  }

  /**
   * End a performance measurement and log the result
   */
  endMeasure(name: string): number | null {
    if (!this.enabled) return null;

    const mark = this.marks.get(name);
    if (!mark) {
      console.warn(`Performance mark "${name}" not found`);
      return null;
    }

    const duration = performance.now() - mark.startTime;
    mark.duration = duration;

    // Log slow operations
    if (duration > 100) {
      console.warn(`Slow operation detected: ${name} took ${duration.toFixed(2)}ms`, mark.metadata);
    }

    this.marks.delete(name);
    return duration;
  }

  /**
   * Measure React component render time
   */
  measureRender(componentName: string, phase: 'mount' | 'update') {
    const measureName = `${componentName}-${phase}`;
    return {
      start: () => this.startMeasure(measureName, { component: componentName, phase }),
      end: () => this.endMeasure(measureName)
    };
  }

  /**
   * Get performance metrics summary
   */
  getMetrics(): Record<string, any> {
    if (!this.enabled) return {};

    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    
    return {
      // Page load metrics
      domContentLoaded: navigation?.domContentLoadedEventEnd - navigation?.domContentLoadedEventStart,
      loadComplete: navigation?.loadEventEnd - navigation?.loadEventStart,
      
      // Memory usage (if available)
      memory: (performance as any).memory ? {
        usedJSHeapSize: ((performance as any).memory.usedJSHeapSize / 1048576).toFixed(2) + ' MB',
        totalJSHeapSize: ((performance as any).memory.totalJSHeapSize / 1048576).toFixed(2) + ' MB',
        limit: ((performance as any).memory.jsHeapSizeLimit / 1048576).toFixed(2) + ' MB'
      } : null,
      
      // Active marks
      activeMarks: Array.from(this.marks.keys())
    };
  }

  /**
   * Clear all performance marks
   */
  clear(): void {
    this.marks.clear();
  }

  /**
   * Enable/disable performance monitoring
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
}

// Singleton instance
export const performanceMonitor = new PerformanceMonitor();

/**
 * React hook for measuring component performance
 */
export function useComponentPerformance(componentName: string) {
  const renderCount = useRef(0);
  const mountTime = useRef<number>(0);

  useEffect(() => {
    const measure = performanceMonitor.measureRender(componentName, renderCount.current === 0 ? 'mount' : 'update');
    measure.start();
    
    renderCount.current++;
    
    return () => {
      const duration = measure.end();
      if (renderCount.current === 1 && duration) {
        mountTime.current = duration;
      }
    };
  });

  return {
    renderCount: renderCount.current,
    mountTime: mountTime.current
  };
}

/**
 * Debounced callback with performance tracking
 */
export function usePerformantCallback<T extends (...args: any[]) => any>(
  callback: T,
  deps: React.DependencyList,
  options: { debounce?: number; measureName?: string } = {}
): T {
  const { debounce = 0, measureName } = options;
  const timeoutRef = useRef<NodeJS.Timeout>();

  const performantCallback = useCallback((...args: Parameters<T>) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    if (debounce > 0) {
      timeoutRef.current = setTimeout(() => {
        if (measureName) {
          performanceMonitor.startMeasure(measureName);
        }
        
        const result = callback(...args);
        
        if (measureName) {
          performanceMonitor.endMeasure(measureName);
        }
        
        return result;
      }, debounce);
    } else {
      if (measureName) {
        performanceMonitor.startMeasure(measureName);
      }
      
      const result = callback(...args);
      
      if (measureName) {
        performanceMonitor.endMeasure(measureName);
      }
      
      return result;
    }
  }, [...deps, debounce, measureName]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return performantCallback as T;
}
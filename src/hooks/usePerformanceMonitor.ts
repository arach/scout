import React, { useEffect, useRef } from 'react';
import { loggers } from '../utils/logger';

// Performance monitoring configuration
interface PerformanceConfig {
  enabled: boolean;
  logThreshold: number; // Log render times above this threshold (ms)
  sampleRate: number; // Sample rate (0-1) for performance logging
}

const DEFAULT_CONFIG: PerformanceConfig = {
  enabled: process.env.NODE_ENV === 'development',
  logThreshold: 16, // 16ms = one frame at 60fps
  sampleRate: 0.1, // Log 10% of renders
};

/**
 * Hook to monitor component render performance
 * 
 * @param componentName - Name of the component for logging
 * @param config - Optional performance monitoring configuration
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   usePerformanceMonitor('MyComponent');
 *   // ... component logic
 * }
 * ```
 */
export const usePerformanceMonitor = (
  componentName: string,
  config: Partial<PerformanceConfig> = {}
) => {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const renderStartTime = useRef<number>();
  const renderCount = useRef(0);
  const totalRenderTime = useRef(0);
  const slowRenders = useRef(0);

  useEffect(() => {
    if (!mergedConfig.enabled) return;

    // Record render start time
    renderStartTime.current = performance.now();
  });

  useEffect(() => {
    if (!mergedConfig.enabled || !renderStartTime.current) return;

    const renderEndTime = performance.now();
    const renderTime = renderEndTime - renderStartTime.current;
    
    renderCount.current++;
    totalRenderTime.current += renderTime;

    // Check if we should log this render
    const shouldLog = Math.random() < mergedConfig.sampleRate;
    
    if (renderTime > mergedConfig.logThreshold) {
      slowRenders.current++;
      
      if (shouldLog) {
        loggers.performance.warn(
          `Slow render detected in ${componentName}`,
          {
            renderTime: `${renderTime.toFixed(2)}ms`,
            threshold: `${mergedConfig.logThreshold}ms`,
            renderCount: renderCount.current,
            averageRenderTime: `${(totalRenderTime.current / renderCount.current).toFixed(2)}ms`,
            slowRenderPercentage: `${((slowRenders.current / renderCount.current) * 100).toFixed(1)}%`
          }
        );
      }
    } else if (shouldLog) {
      loggers.performance.debug(
        `${componentName} render completed`,
        {
          renderTime: `${renderTime.toFixed(2)}ms`,
          renderCount: renderCount.current,
        }
      );
    }

    // Log performance summary periodically
    if (renderCount.current % 100 === 0) {
      const averageRenderTime = totalRenderTime.current / renderCount.current;
      const slowRenderPercentage = (slowRenders.current / renderCount.current) * 100;
      
      loggers.performance.info(
        `Performance summary for ${componentName}`,
        {
          totalRenders: renderCount.current,
          averageRenderTime: `${averageRenderTime.toFixed(2)}ms`,
          slowRenders: slowRenders.current,
          slowRenderPercentage: `${slowRenderPercentage.toFixed(1)}%`,
          totalRenderTime: `${totalRenderTime.current.toFixed(2)}ms`
        }
      );
    }

    // Reset start time for next render
    renderStartTime.current = undefined;
  });

  // Return performance stats for external use
  return {
    renderCount: renderCount.current,
    averageRenderTime: renderCount.current > 0 
      ? totalRenderTime.current / renderCount.current 
      : 0,
    slowRenders: slowRenders.current,
    slowRenderPercentage: renderCount.current > 0 
      ? (slowRenders.current / renderCount.current) * 100 
      : 0
  };
};

/**
 * Higher-order component to add performance monitoring to any component
 */
export function withPerformanceMonitor<P extends object>(
  Component: React.ComponentType<P>,
  config?: Partial<PerformanceConfig>
) {
  const WrappedComponent = (props: P) => {
    usePerformanceMonitor(Component.displayName || Component.name, config);
    return React.createElement(Component, props);
  };

  WrappedComponent.displayName = `withPerformanceMonitor(${Component.displayName || Component.name})`;
  return WrappedComponent;
}

/**
 * Hook to measure and log the execution time of a function
 */
export const usePerformanceMeasure = () => {
  return {
    /**
     * Measure synchronous function execution time
     */
    measure: <T>(label: string, fn: () => T): T => {
      const startTime = performance.now();
      try {
        return fn();
      } finally {
        const endTime = performance.now();
        const executionTime = endTime - startTime;
        
        loggers.performance.debug(
          `Function ${label} execution time`,
          { executionTime: `${executionTime.toFixed(2)}ms` }
        );
      }
    },

    /**
     * Measure asynchronous function execution time
     */
    measureAsync: async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
      const startTime = performance.now();
      try {
        return await fn();
      } finally {
        const endTime = performance.now();
        const executionTime = endTime - startTime;
        
        loggers.performance.debug(
          `Async function ${label} execution time`,
          { executionTime: `${executionTime.toFixed(2)}ms` }
        );
      }
    }
  };
};

import { useState, useRef, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface UseOptimizedAudioLevelOptions {
  deviceName?: string | null;
  enabled?: boolean;
  smoothingFactor?: number;
  amplification?: number;
  threshold?: number;
}

interface AudioLevelState {
  readonly level: number;
  readonly target: number;
  readonly timestamp: number;
}

/**
 * Optimized audio level monitoring using requestAnimationFrame
 * Replaces the polling-based approach to reduce CPU usage and improve performance
 */
export function useOptimizedAudioLevel(options: UseOptimizedAudioLevelOptions = {}) {
  const {
    deviceName = null,
    enabled = true,
    smoothingFactor = 0.3,
    amplification = 1.5,
    threshold = 0.12,
  } = options;

  const [audioLevel, setAudioLevel] = useState(0);
  const [isMonitoring, setIsMonitoring] = useState(false);
  
  // Refs for performance-critical values
  const targetRef = useRef(0);
  const currentRef = useRef(0);
  const animationFrameRef = useRef<number>();
  const lastPollTimeRef = useRef(0);
  const mountedRef = useRef(true);
  const monitoringStartedRef = useRef(false);

  // Polling interval (reduced frequency but still responsive)
  const POLL_INTERVAL = 100; // Poll backend every 100ms instead of 150ms

  /**
   * Optimized audio level update function
   */
  const updateAudioLevel = useCallback((newState: AudioLevelState): void => {
    if (!mountedRef.current) return;
    
    currentRef.current = newState.level;
    setAudioLevel(newState.level);
  }, []);

  /**
   * Process raw audio level with effects
   */
  const processAudioLevel = useCallback((rawLevel: number): number => {
    let processed = 0;
    
    // Apply threshold and amplification
    if (rawLevel > threshold) {
      processed = (rawLevel - threshold) * amplification;
    }
    
    // Add some raw signal for organic movement
    processed += rawLevel * 0.08;
    
    // Add organic motion effects
    if (processed > 0.02) {
      const now = Date.now();
      const flutter = (Math.random() - 0.5) * processed * 0.12;
      const shimmer = Math.sin(now * 0.007) * processed * 0.04;
      const pulse = Math.sin(now * 0.003) * processed * 0.06;
      processed += flutter + shimmer + pulse;
    }
    
    // Add subtle breathing motion even when quiet
    const breathingMotion = Math.sin(Date.now() * 0.0015) * 0.015;
    processed += breathingMotion;
    
    return Math.max(0, Math.min(processed, 1.0));
  }, [threshold, amplification]);

  /**
   * Animation loop using requestAnimationFrame
   */
  const animate = useCallback(() => {
    if (!mountedRef.current || !enabled) return;

    const now = Date.now();
    
    // Poll backend at reduced frequency
    if (now - lastPollTimeRef.current >= POLL_INTERVAL) {
      lastPollTimeRef.current = now;
      
      // Async poll - don't await to avoid blocking animation
      invoke<number>('get_current_audio_level')
        .then(rawLevel => {
          if (!mountedRef.current) return;
          targetRef.current = processAudioLevel(rawLevel);
        })
        .catch(error => {
          if (mountedRef.current) {
            console.error('Failed to get audio level:', error);
          }
        });
    }

    // Smooth animation towards target
    const target = targetRef.current;
    const current = currentRef.current;
    const diff = target - current;
    const newLevel = current + (diff * smoothingFactor);
    
    // Update state only if change is significant
    if (Math.abs(newLevel - currentRef.current) > 0.001) {
      const newState: AudioLevelState = {
        level: newLevel,
        target,
        timestamp: now,
      };
      
      updateAudioLevel(newState);
    }
    
    // Schedule next frame
    animationFrameRef.current = requestAnimationFrame(animate);
  }, [enabled, smoothingFactor, processAudioLevel, updateAudioLevel]);

  /**
   * Start audio monitoring
   */
  const startMonitoring = useCallback(async () => {
    if (!enabled || monitoringStartedRef.current || !mountedRef.current) return;

    try {
      console.log('Starting optimized audio level monitoring...');
      await invoke('start_audio_level_monitoring', { deviceName });
      
      if (!mountedRef.current) return;
      
      monitoringStartedRef.current = true;
      setIsMonitoring(true);
      lastPollTimeRef.current = Date.now();
      
      // Start animation loop
      animationFrameRef.current = requestAnimationFrame(animate);
      
      console.log('Audio level monitoring started successfully');
    } catch (error) {
      console.error('Failed to start audio level monitoring:', error);
      setIsMonitoring(false);
    }
  }, [enabled, deviceName, animate]);

  /**
   * Stop audio monitoring
   */
  const stopMonitoring = useCallback(async () => {
    if (!monitoringStartedRef.current) return;

    monitoringStartedRef.current = false;
    setIsMonitoring(false);
    
    // Cancel animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
    }
    
    // Reset levels
    targetRef.current = 0;
    currentRef.current = 0;
    setAudioLevel(0);
    
    // Stop backend monitoring
    try {
      await invoke('stop_audio_level_monitoring');
    } catch (error) {
      console.error('Failed to stop audio level monitoring:', error);
    }
  }, []);

  // Effect to manage monitoring lifecycle
  useEffect(() => {
    if (enabled) {
      // Small delay to ensure Tauri is ready
      const timeoutId = setTimeout(() => {
        if (mountedRef.current) {
          startMonitoring();
        }
      }, 200);

      return () => {
        clearTimeout(timeoutId);
        stopMonitoring();
      };
    } else {
      stopMonitoring();
    }
  }, [enabled, deviceName, startMonitoring, stopMonitoring]);

  // Cleanup on unmount with proper resource management
  useEffect(() => {
    mountedRef.current = true;
    
    return () => {
      mountedRef.current = false;
      
      // Cancel any pending animation frames immediately
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
      }
      
      // Reset all refs to prevent stale closures
      targetRef.current = 0;
      currentRef.current = 0;
      lastPollTimeRef.current = 0;
      monitoringStartedRef.current = false;
      
      // Stop backend monitoring without awaiting
      if (monitoringStartedRef.current) {
        invoke('stop_audio_level_monitoring').catch(() => {
          // Silently ignore errors during cleanup
        });
      }
    };
  }, []);

  // Reset monitoring when device changes
  useEffect(() => {
    if (monitoringStartedRef.current) {
      stopMonitoring().then(() => {
        if (enabled && mountedRef.current) {
          startMonitoring();
        }
      });
    }
  }, [deviceName, stopMonitoring, startMonitoring, enabled]);

  return {
    audioLevel,
    isMonitoring,
    startMonitoring,
    stopMonitoring,
  };
}
import { useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAudioContext } from '../contexts/AudioContext';

interface UseAudioLevelMonitoringOptions {
  isActive?: boolean;
}

export function useAudioLevelMonitoring(options: UseAudioLevelMonitoringOptions = {}) {
  const { isActive = false } = options;
  const { selectedMic, setAudioLevel } = useAudioContext();
  const audioTargetRef = useRef(0);
  const audioCurrentRef = useRef(0);

  useEffect(() => {
    let animationFrameId: number | null = null;
    let isActiveInternal = true;
    let lastPollTime = 0;
    const POLL_INTERVAL = 50; // Poll backend every 50ms
    
    // Pre-calculate time constants for performance
    const FLUTTER_SPEED = 0.007;
    const SHIMMER_SPEED = 0.003;
    const BREATHING_SPEED = 0.0015;

    // Skip audio monitoring if not active
    if (!isActive) {
      // Reset audio level when not monitoring
      audioTargetRef.current = 0;
      audioCurrentRef.current = 0;
      setAudioLevel(0);
      return;
    }

    const startMonitoring = async () => {
      try {
        console.log('Attempting to start audio level monitoring...');
        // Start monitoring first
        await invoke('start_audio_level_monitoring', { 
          deviceName: selectedMic !== 'Default microphone' ? selectedMic : null 
        });
        console.log('Audio level monitoring started successfully');
        
        // Animation loop using requestAnimationFrame for 60fps
        const animate = (timestamp: number) => {
          if (!isActiveInternal) return;
          
          // Poll backend at reduced rate to minimize overhead
          if (timestamp - lastPollTime > POLL_INTERVAL) {
            lastPollTime = timestamp;
            
            // Non-blocking backend poll
            invoke<number>('get_current_audio_level')
              .then(level => {
                // Same processing as before
                let processed = 0;
                if (level > 0.12) {
                  processed = (level - 0.12) * 1.5;
                }
                processed += level * 0.08;
                audioTargetRef.current = Math.min(processed, 1.0);
              })
              .catch(() => {
                audioTargetRef.current = 0;
              });
          }
          
          // Animate towards target every frame
          const target = audioTargetRef.current;
          const current = audioCurrentRef.current;
          const diff = target - current;
          const speed = 0.3;
          let newLevel = current + (diff * speed);
          
          // Optimize organic motion calculations
          if (target > 0.02) {
            // Use timestamp for consistent animation timing
            const timeInSeconds = timestamp * 0.001;
            const flutter = (Math.random() - 0.5) * target * 0.12;
            const shimmer = Math.sin(timeInSeconds * FLUTTER_SPEED) * target * 0.04;
            const pulse = Math.sin(timeInSeconds * SHIMMER_SPEED) * target * 0.06;
            newLevel += flutter + shimmer + pulse;
          }
          
          // Breathing motion even when quiet
          const breathingMotion = Math.sin(timestamp * BREATHING_SPEED) * 0.015;
          newLevel += breathingMotion;
          
          // Clamp and update only if changed significantly (reduce React renders)
          const clampedLevel = Math.max(0, Math.min(newLevel, 1.0));
          const levelDiff = Math.abs(clampedLevel - audioCurrentRef.current);
          
          if (levelDiff > 0.001) {
            audioCurrentRef.current = clampedLevel;
            setAudioLevel(clampedLevel);
          }
          
          // Continue animation loop
          animationFrameId = requestAnimationFrame(animate);
        };
        
        // Start animation loop
        animationFrameId = requestAnimationFrame(animate);
        
      } catch (error) {
        console.error('Failed to start audio level monitoring:', error);
        // Don't set up polling interval if starting failed
        return;
      }
    };

    // Delay start to ensure Tauri is ready
    const timeoutId = setTimeout(() => {
      if (isActiveInternal) {
        startMonitoring();
      }
    }, 200);

    // Cleanup on unmount
    return () => {
      isActiveInternal = false;
      clearTimeout(timeoutId);
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      invoke('stop_audio_level_monitoring').catch(() => {});
      audioTargetRef.current = 0;
      audioCurrentRef.current = 0;
      setAudioLevel(0);
    };
  }, [selectedMic, isActive]);

  return {
    audioTargetRef,
    audioCurrentRef,
  };
}
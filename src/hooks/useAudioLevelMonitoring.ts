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
    let interval: NodeJS.Timeout | null = null;
    let isActiveInternal = true;

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
        
        // Combined animation and polling function to prevent dual loops
        const animateAndPoll = async () => {
          if (!isActiveInternal) return;
          
          try {
            // Poll backend for audio level
            const level = await invoke<number>('get_current_audio_level');
            
            // Same processing as master
            let processed = 0;
            if (level > 0.12) {
              processed = (level - 0.12) * 1.5; // More amplification
            }
            
            // Add bit of raw signal for organic movement
            processed += level * 0.08; // More jitter for liveliness
            
            // Set target - animation will smoothly move toward it
            audioTargetRef.current = Math.min(processed, 1.0);
          } catch (error) {
            // Silently fail if monitoring isn't available (e.g., during onboarding)
            audioTargetRef.current = 0;
            return;
          }
          
          // Animate towards target
          const target = audioTargetRef.current;
          const current = audioCurrentRef.current;
          const diff = target - current;
          const speed = 0.3;
          let newLevel = current + (diff * speed);
          
          // Organic motion from master
          if (target > 0.02) {
            const flutter = (Math.random() - 0.5) * target * 0.12;
            const shimmer = Math.sin(Date.now() * 0.007) * target * 0.04;
            const pulse = Math.sin(Date.now() * 0.003) * target * 0.06;
            newLevel += flutter + shimmer + pulse;
          }
          
          // Breathing motion even when quiet
          const breathingMotion = Math.sin(Date.now() * 0.0015) * 0.015;
          newLevel += breathingMotion;
          
          // Clamp and update context
          audioCurrentRef.current = Math.max(0, Math.min(newLevel, 1.0));
          setAudioLevel(audioCurrentRef.current);
        };
        
        // Use interval instead of requestAnimationFrame to reduce CPU usage
        interval = setInterval(animateAndPoll, 150);
        
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
      if (interval) clearInterval(interval);
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
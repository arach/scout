import { useSettings } from '../contexts/SettingsContext';
import { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { OverlayPosition, OverlayTreatment } from '../contexts/SettingsContext';

/**
 * Enhanced settings hook that persists changes to backend and localStorage
 */
export function useEnhancedSettings() {
  const { state, actions } = useSettings();

  // Enhanced overlay position update
  const updateOverlayPosition = useCallback(async (position: OverlayPosition) => {
    actions.updateOverlayPosition(position);
    localStorage.setItem('scout-overlay-position', position);
    try {
      await invoke('set_overlay_position', { position });
    } catch (error) {
      console.error('Failed to update overlay position:', error);
    }
  }, [actions]);

  // Enhanced overlay treatment update
  const updateOverlayTreatment = useCallback(async (treatment: OverlayTreatment) => {
    actions.updateOverlayTreatment(treatment);
    localStorage.setItem('scout-overlay-treatment', treatment);
    try {
      await invoke('set_overlay_treatment', { treatment });
    } catch (error) {
      console.error('Failed to update overlay treatment:', error);
    }
  }, [actions]);

  return {
    state,
    actions: {
      ...actions,
      updateOverlayPosition,
      updateOverlayTreatment,
    },
  };
}
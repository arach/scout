import { useState, useCallback } from 'react';
import { Transcript } from '../types/transcript';

/**
 * State for the transcript detail panel
 */
interface PanelState {
  transcript: Transcript | null;
  isOpen: boolean;
}

/**
 * Hook to manage transcript detail panel state and actions
 */
export function useTranscriptDetailPanel() {
  const [panelState, setPanelState] = useState<PanelState>({
    transcript: null,
    isOpen: false,
  });

  const openDetailPanel = useCallback((transcript: Transcript) => {
    setPanelState({ transcript: transcript, isOpen: true });
  }, []);

  const closeDetailPanel = useCallback(() => {
    setPanelState(prev => ({ ...prev, isOpen: false }));
    // Keep selected transcript for animation
    setTimeout(() => {
      setPanelState(prev => ({ ...prev, transcript: null }));
    }, 200);
  }, []);

  return {
    panelState,
    openDetailPanel,
    closeDetailPanel,
  };
}

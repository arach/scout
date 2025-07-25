import { useState, useEffect, useCallback } from 'react';

/**
 * Hook to manage export menu and floating menu state with click outside handling
 */
export function useTranscriptMenuState() {
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showFloatingExportMenu, setShowFloatingExportMenu] = useState(false);

  // Handle click outside for menus
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.export-menu')) {
        setShowExportMenu(false);
      }
      if (!target.closest('.export-dropdown')) {
        setShowFloatingExportMenu(false);
      }
    };
    
    if (showExportMenu || showFloatingExportMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showExportMenu, showFloatingExportMenu]);

  const toggleExportMenu = useCallback(() => {
    setShowExportMenu(prev => !prev);
  }, []);

  const toggleFloatingExportMenu = useCallback(() => {
    setShowFloatingExportMenu(prev => !prev);
  }, []);

  const closeExportMenu = useCallback(() => {
    setShowExportMenu(false);
  }, []);

  const closeFloatingExportMenu = useCallback(() => {
    setShowFloatingExportMenu(false);
  }, []);

  return {
    showExportMenu,
    showFloatingExportMenu,
    toggleExportMenu,
    toggleFloatingExportMenu,
    closeExportMenu,
    closeFloatingExportMenu,
  };
}

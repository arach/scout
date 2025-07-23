import { useState, useEffect, useCallback } from 'react';
import { safeEventListen } from '../lib/safeEventListener';

interface TranscriptionChunk {
  id: number;
  text: string;
  timestamp: number;
  isPartial: boolean;
}

interface UseTranscriptionOverlayOptions {
  autoShowOnRecording?: boolean;
  autoHideOnComplete?: boolean;
  saveToLocalStorage?: boolean;
}

export function useTranscriptionOverlay(options: UseTranscriptionOverlayOptions = {}) {
  const {
    autoShowOnRecording = true,
    autoHideOnComplete = false,
    saveToLocalStorage = true,
  } = options;

  const [isVisible, setIsVisible] = useState(() => {
    if (saveToLocalStorage) {
      const saved = localStorage.getItem('scout-transcription-overlay-visible');
      return saved ? JSON.parse(saved) : false;
    }
    return false;
  });

  const [transparency, setTransparency] = useState(() => {
    if (saveToLocalStorage) {
      const saved = localStorage.getItem('scout-transcription-overlay-transparency');
      return saved ? parseInt(saved, 10) : 85; // Default to 85% opacity
    }
    return 85;
  });

  const [position, setPosition] = useState(() => {
    if (saveToLocalStorage) {
      const saved = localStorage.getItem('scout-transcription-overlay-position');
      return saved ? JSON.parse(saved) : { x: 20, y: 20 };
    }
    return { x: 20, y: 20 };
  });

  const [size, setSize] = useState(() => {
    if (saveToLocalStorage) {
      const saved = localStorage.getItem('scout-transcription-overlay-size');
      return saved ? JSON.parse(saved) : { width: 500, height: 400 };
    }
    return { width: 500, height: 400 };
  });

  const [buildingText, setBuildingText] = useState('');
  const [editedText, setEditedText] = useState('');
  const [hasUnsavedEdits, setHasUnsavedEdits] = useState(false);
  const [chunks, setChunks] = useState<TranscriptionChunk[]>([]);

  // Save settings to localStorage
  useEffect(() => {
    if (saveToLocalStorage) {
      localStorage.setItem('scout-transcription-overlay-visible', JSON.stringify(isVisible));
    }
  }, [isVisible, saveToLocalStorage]);

  useEffect(() => {
    if (saveToLocalStorage) {
      localStorage.setItem('scout-transcription-overlay-transparency', transparency.toString());
    }
  }, [transparency, saveToLocalStorage]);

  useEffect(() => {
    if (saveToLocalStorage) {
      localStorage.setItem('scout-transcription-overlay-position', JSON.stringify(position));
    }
  }, [position, saveToLocalStorage]);

  useEffect(() => {
    if (saveToLocalStorage) {
      localStorage.setItem('scout-transcription-overlay-size', JSON.stringify(size));
    }
  }, [size, saveToLocalStorage]);

  // Auto-show/hide based on recording state
  useEffect(() => {
    if (!isVisible) return;

    let mounted = true;
    let unsubscribeRecordingStart: (() => void) | undefined;
    let unsubscribeRecordingComplete: (() => void) | undefined;

    const setupListeners = async () => {
      // Listen for recording state changes
      unsubscribeRecordingStart = await safeEventListen('recording-started', () => {
        if (!mounted) return;
        if (autoShowOnRecording) {
          setIsVisible(true);
        }
      });

      unsubscribeRecordingComplete = await safeEventListen('recording-completed', () => {
        if (!mounted) return;
        if (autoHideOnComplete && !hasUnsavedEdits) {
          setIsVisible(false);
        }
      });
    };

    setupListeners();

    return () => {
      mounted = false;
      if (unsubscribeRecordingStart) unsubscribeRecordingStart();
      if (unsubscribeRecordingComplete) unsubscribeRecordingComplete();
    };
  }, [autoShowOnRecording, autoHideOnComplete, hasUnsavedEdits, isVisible]);

  // Listen for transcription events and build up text
  useEffect(() => {
    let mounted = true;
    let unsubscribeChunks: (() => void) | undefined;
    let unsubscribeComplete: (() => void) | undefined;

    const setupListeners = async () => {
      // Listen for partial transcription chunks (if backend supports it)
      unsubscribeChunks = await safeEventListen('transcription-chunk', (event) => {
        if (!mounted) return;
        
        const chunk = event.payload as TranscriptionChunk;
        setChunks(prev => {
          const existingIndex = prev.findIndex(c => c.id === chunk.id);
          if (existingIndex >= 0) {
            const newChunks = [...prev];
            newChunks[existingIndex] = chunk;
            return newChunks;
          } else {
            return [...prev, chunk].sort((a, b) => a.timestamp - b.timestamp);
          }
        });
      });

      // Listen for complete transcripts
      unsubscribeComplete = await safeEventListen('transcript-created', (event) => {
        if (!mounted) return;
        
        const transcript = event.payload as any;
        // If we're building text progressively, append new content
        setBuildingText(prev => {
          const newText = prev ? `${prev}\n\n${transcript.text}` : transcript.text;
          // Update edited text if user hasn't made edits
          if (!hasUnsavedEdits) {
            setEditedText(newText);
          }
          return newText;
        });
      });
    };

    setupListeners();

    return () => {
      mounted = false;
      if (unsubscribeChunks) unsubscribeChunks();
      if (unsubscribeComplete) unsubscribeComplete();
    };
  }, [hasUnsavedEdits]);

  // Build text from chunks
  useEffect(() => {
    const fullText = chunks
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(chunk => chunk.text)
      .join(' ')
      .trim();
    
    setBuildingText(fullText);
    
    // Update edited text if user hasn't made edits
    if (!hasUnsavedEdits) {
      setEditedText(fullText);
    }
  }, [chunks, hasUnsavedEdits]);

  // Functions
  const showOverlay = useCallback(() => setIsVisible(true), []);
  const hideOverlay = useCallback(() => setIsVisible(false), []);
  const toggleOverlay = useCallback(() => setIsVisible((prev: boolean) => !prev), []);

  const updateTransparency = useCallback((value: number) => {
    setTransparency(Math.max(20, Math.min(100, value))); // Clamp between 20-100%
  }, []);

  const updatePosition = useCallback((newPosition: { x: number; y: number }) => {
    setPosition(newPosition);
  }, []);

  const updateSize = useCallback((newSize: { width: number; height: number }) => {
    setSize(newSize);
  }, []);

  const handleTextEdit = useCallback((text: string) => {
    setEditedText(text);
    setHasUnsavedEdits(text !== buildingText);
  }, [buildingText]);

  const saveEdits = useCallback(() => {
    setBuildingText(editedText);
    setHasUnsavedEdits(false);
    return editedText;
  }, [editedText]);

  const discardEdits = useCallback(() => {
    setEditedText(buildingText);
    setHasUnsavedEdits(false);
  }, [buildingText]);

  const clearText = useCallback(() => {
    setBuildingText('');
    setEditedText('');
    setChunks([]);
    setHasUnsavedEdits(false);
  }, []);

  return {
    // State
    isVisible,
    transparency,
    position,
    size,
    buildingText,
    editedText,
    hasUnsavedEdits,
    chunks,
    
    // Actions
    showOverlay,
    hideOverlay,
    toggleOverlay,
    updateTransparency,
    updatePosition,
    updateSize,
    handleTextEdit,
    saveEdits,
    discardEdits,
    clearText,
  };
}
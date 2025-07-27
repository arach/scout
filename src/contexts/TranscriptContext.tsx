import { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';
import { Transcript } from '../types/transcript';
import { useSetState } from '../hooks/useSetState';

interface TranscriptContextState {
  transcripts: Transcript[];
  searchQuery: string;
  selectedTranscripts: Set<number>;
  isProcessing: boolean;
  sessionStartTime: string;
}

interface TranscriptContextActions {
  setTranscripts: (transcripts: Transcript[] | ((prev: Transcript[]) => Transcript[])) => void;
  setSearchQuery: (query: string) => void;
  setSelectedTranscripts: (selected: Set<number> | ((prev: Set<number>) => Set<number>)) => void;
  setIsProcessing: (processing: boolean) => void;
  addTranscript: (transcript: Transcript) => void;
  removeTranscript: (id: number) => void;
  clearSelectedTranscripts: () => void;
  // Optimized Set operations
  toggleTranscriptSelection: (id: number) => void;
  toggleTranscriptGroupSelection: (ids: number[]) => void;
  selectAllTranscripts: (transcriptIds: number[]) => void;
}

interface TranscriptContextValue extends TranscriptContextState, TranscriptContextActions {}

const TranscriptContext = createContext<TranscriptContextValue | undefined>(undefined);

interface TranscriptProviderProps {
  children: ReactNode;
}

export function TranscriptProvider({ children }: TranscriptProviderProps) {
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [sessionStartTime] = useState(() => new Date().toISOString());
  
  // Use optimized Set state management
  const selectedTranscriptsSet = useSetState<number>();

  const handleSetTranscripts = useCallback((transcriptsOrUpdater: Transcript[] | ((prev: Transcript[]) => Transcript[])) => {
    if (typeof transcriptsOrUpdater === 'function') {
      setTranscripts(transcriptsOrUpdater);
    } else {
      setTranscripts(transcriptsOrUpdater);
    }
  }, []);

  const handleSetSearchQuery = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const handleSetSelectedTranscripts = useCallback((selected: Set<number> | ((prev: Set<number>) => Set<number>)) => {
    if (typeof selected === 'function') {
      // For backward compatibility, convert function-based updates
      const newSet = selected(selectedTranscriptsSet.set);
      selectedTranscriptsSet.replaceAll(Array.from(newSet));
    } else {
      selectedTranscriptsSet.replaceAll(Array.from(selected));
    }
  }, [selectedTranscriptsSet]);

  const handleSetIsProcessing = useCallback((processing: boolean) => {
    setIsProcessing(processing);
  }, []);

  const addTranscript = useCallback((transcript: Transcript) => {
    setTranscripts(prev => {
      const exists = prev.some(t => t.id === transcript.id);
      if (exists) return prev;
      return [transcript, ...prev].slice(0, 100);
    });
  }, []);

  const removeTranscript = useCallback((id: number) => {
    setTranscripts(prev => prev.filter(t => t.id !== id));
    selectedTranscriptsSet.remove(id);
  }, [selectedTranscriptsSet]);

  const clearSelectedTranscripts = useCallback(() => {
    selectedTranscriptsSet.clear();
  }, [selectedTranscriptsSet]);

  // New optimized Set operations
  const toggleTranscriptSelection = useCallback((id: number) => {
    selectedTranscriptsSet.toggle(id);
  }, [selectedTranscriptsSet]);

  const toggleTranscriptGroupSelection = useCallback((ids: number[]) => {
    selectedTranscriptsSet.toggleMultiple(ids);
  }, [selectedTranscriptsSet]);

  const selectAllTranscripts = useCallback((transcriptIds: number[]) => {
    selectedTranscriptsSet.replaceAll(transcriptIds);
  }, [selectedTranscriptsSet]);

  const value: TranscriptContextValue = useMemo(() => ({
    // State
    transcripts,
    searchQuery,
    selectedTranscripts: selectedTranscriptsSet.set,
    isProcessing,
    sessionStartTime,
    // Actions
    setTranscripts: handleSetTranscripts,
    setSearchQuery: handleSetSearchQuery,
    setSelectedTranscripts: handleSetSelectedTranscripts,
    setIsProcessing: handleSetIsProcessing,
    addTranscript,
    removeTranscript,
    clearSelectedTranscripts,
    // Optimized Set operations
    toggleTranscriptSelection,
    toggleTranscriptGroupSelection,
    selectAllTranscripts,
  }), [
    transcripts,
    searchQuery,
    selectedTranscriptsSet.set,
    isProcessing,
    sessionStartTime,
    handleSetTranscripts,
    handleSetSearchQuery,
    handleSetSelectedTranscripts,
    handleSetIsProcessing,
    addTranscript,
    removeTranscript,
    clearSelectedTranscripts,
    toggleTranscriptSelection,
    toggleTranscriptGroupSelection,
    selectAllTranscripts,
  ]);

  return (
    <TranscriptContext.Provider value={value}>
      {children}
    </TranscriptContext.Provider>
  );
}

export function useTranscriptContext(): TranscriptContextValue {
  const context = useContext(TranscriptContext);
  if (context === undefined) {
    throw new Error('useTranscriptContext must be used within a TranscriptProvider');
  }
  return context;
}

export type { Transcript };
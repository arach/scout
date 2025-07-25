import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { Transcript } from '../types/transcript';

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
}

interface TranscriptContextValue extends TranscriptContextState, TranscriptContextActions {}

const TranscriptContext = createContext<TranscriptContextValue | undefined>(undefined);

interface TranscriptProviderProps {
  children: ReactNode;
}

export function TranscriptProvider({ children }: TranscriptProviderProps) {
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTranscripts, setSelectedTranscripts] = useState<Set<number>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const [sessionStartTime] = useState(() => new Date().toISOString());

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
      setSelectedTranscripts(selected);
    } else {
      setSelectedTranscripts(selected);
    }
  }, []);

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
    setSelectedTranscripts(prev => {
      const newSet = new Set(prev);
      newSet.delete(id);
      return newSet;
    });
  }, []);

  const clearSelectedTranscripts = useCallback(() => {
    setSelectedTranscripts(new Set());
  }, []);

  const value: TranscriptContextValue = {
    // State
    transcripts,
    searchQuery,
    selectedTranscripts,
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
  };

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
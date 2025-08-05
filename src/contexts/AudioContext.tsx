import { createContext, useContext, useState, useCallback, ReactNode, useRef, useSyncExternalStore } from 'react';

// Audio level subscription system
type AudioLevelListener = (level: number) => void;

class AudioLevelStore {
  private listeners = new Set<AudioLevelListener>();
  private currentLevel = 0;

  subscribe = (listener: AudioLevelListener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => {
    return this.currentLevel;
  };

  setLevel = (level: number) => {
    if (this.currentLevel !== level) {
      this.currentLevel = level;
      this.listeners.forEach(listener => listener(level));
    }
  };
}

interface AudioContextState {
  selectedMic: string;
}

interface AudioContextActions {
  setSelectedMic: (mic: string) => void;
  setAudioLevel: (level: number) => void;
}

interface AudioContextValue extends AudioContextState, AudioContextActions {
  audioLevelStore: AudioLevelStore;
}

const AudioContext = createContext<AudioContextValue | undefined>(undefined);

interface AudioProviderProps {
  children: ReactNode;
}

export function AudioProvider({ children }: AudioProviderProps) {
  // Load saved mic from localStorage or default to 'Default microphone'
  const [selectedMic, setSelectedMic] = useState<string>(() => {
    return localStorage.getItem('scout-selected-mic') || 'Default microphone';
  });
  const audioLevelStoreRef = useRef<AudioLevelStore>();

  // Create audio level store instance once
  if (!audioLevelStoreRef.current) {
    audioLevelStoreRef.current = new AudioLevelStore();
  }

  const handleSetSelectedMic = useCallback((mic: string) => {
    setSelectedMic(mic);
    localStorage.setItem('scout-selected-mic', mic);
  }, []);

  const handleSetAudioLevel = useCallback((level: number) => {
    audioLevelStoreRef.current?.setLevel(level);
  }, []);

  const value: AudioContextValue = {
    // State
    selectedMic,
    // Actions
    setSelectedMic: handleSetSelectedMic,
    setAudioLevel: handleSetAudioLevel,
    // Store
    audioLevelStore: audioLevelStoreRef.current!,
  };

  return (
    <AudioContext.Provider value={value}>
      {children}
    </AudioContext.Provider>
  );
}

export const useAudioContext = (): Omit<AudioContextValue, 'audioLevelStore'> => {
  const context = useContext(AudioContext);
  if (context === undefined) {
    throw new Error('useAudioContext must be used within an AudioProvider');
  }
  // Return everything except audioLevelStore to maintain backward compatibility
  const { audioLevelStore, ...contextWithoutStore } = context;
  return contextWithoutStore;
};

// New hook for components that need audio level
export function useAudioLevel(): number {
  const context = useContext(AudioContext);
  if (context === undefined) {
    throw new Error('useAudioLevel must be used within an AudioProvider');
  }
  
  return useSyncExternalStore(
    context.audioLevelStore.subscribe,
    context.audioLevelStore.getSnapshot,
    context.audioLevelStore.getSnapshot
  );
}
import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface AudioContextState {
  selectedMic: string;
  vadEnabled: boolean;
  audioLevel: number;
}

interface AudioContextActions {
  setSelectedMic: (mic: string) => void;
  setVadEnabled: (enabled: boolean) => void;
  setAudioLevel: (level: number) => void;
}

interface AudioContextValue extends AudioContextState, AudioContextActions {}

const AudioContext = createContext<AudioContextValue | undefined>(undefined);

interface AudioProviderProps {
  children: ReactNode;
}

export function AudioProvider({ children }: AudioProviderProps) {
  const [selectedMic, setSelectedMic] = useState<string>('Default microphone');
  const [vadEnabled, setVadEnabled] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);

  const handleSetSelectedMic = useCallback((mic: string) => {
    setSelectedMic(mic);
  }, []);

  const handleSetVadEnabled = useCallback((enabled: boolean) => {
    setVadEnabled(enabled);
  }, []);

  const handleSetAudioLevel = useCallback((level: number) => {
    setAudioLevel(level);
  }, []);

  const value: AudioContextValue = {
    // State
    selectedMic,
    vadEnabled,
    audioLevel,
    // Actions
    setSelectedMic: handleSetSelectedMic,
    setVadEnabled: handleSetVadEnabled,
    setAudioLevel: handleSetAudioLevel,
  };

  return (
    <AudioContext.Provider value={value}>
      {children}
    </AudioContext.Provider>
  );
}

export function useAudioContext(): AudioContextValue {
  const context = useContext(AudioContext);
  if (context === undefined) {
    throw new Error('useAudioContext must be used within an AudioProvider');
  }
  return context;
}
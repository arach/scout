import { createContext, useContext, useReducer, useCallback, ReactNode } from 'react';
import { loggers } from '../utils/logger';

// Recording state interface
interface RecordingState {
  isRecording: boolean;
  isStarting: boolean;
  lastStartTime: number;
}

// Recording actions
type RecordingAction =
  | { type: 'SET_STARTING'; payload: boolean }
  | { type: 'SET_RECORDING'; payload: boolean }
  | { type: 'RESET' };

// Recording context interface
interface RecordingContextValue {
  state: RecordingState;
  canStartRecording: () => boolean;
  setStarting: (value: boolean) => void;
  setRecording: (value: boolean) => void;
  reset: () => void;
}

// Initial state
const initialState: RecordingState = {
  isRecording: false,
  isStarting: false,
  lastStartTime: 0,
};

// Reducer
function recordingReducer(state: RecordingState, action: RecordingAction): RecordingState {
  switch (action.type) {
    case 'SET_STARTING':
      return {
        ...state,
        isStarting: action.payload,
        lastStartTime: action.payload ? Date.now() : state.lastStartTime,
      };
    case 'SET_RECORDING':
      return {
        ...state,
        isRecording: action.payload,
      };
    case 'RESET':
      return initialState;
    default:
      return state;
  }
}

// Create context
const RecordingContext = createContext<RecordingContextValue | undefined>(undefined);

// Provider component
interface RecordingProviderProps {
  children: ReactNode;
}

export function RecordingProvider({ children }: RecordingProviderProps) {
  const [state, dispatch] = useReducer(recordingReducer, initialState);

  const canStartRecording = useCallback((): boolean => {
    const now = Date.now();
    // Prevent rapid starts within 500ms
    if (now - state.lastStartTime < 500) {
      loggers.recording.debug('Ignoring rapid start request - too frequent');
      return false;
    }
    
    if (state.isStarting || state.isRecording) {
      loggers.recording.debug('Cannot start recording - already starting or recording');
      return false;
    }
    
    return true;
  }, [state.lastStartTime, state.isStarting, state.isRecording]);

  const setStarting = useCallback((value: boolean) => {
    dispatch({ type: 'SET_STARTING', payload: value });
  }, []);

  const setRecording = useCallback((value: boolean) => {
    dispatch({ type: 'SET_RECORDING', payload: value });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  const value: RecordingContextValue = {
    state,
    canStartRecording,
    setStarting,
    setRecording,
    reset,
  };

  return (
    <RecordingContext.Provider value={value}>
      {children}
    </RecordingContext.Provider>
  );
}

// Hook to use recording context
export function useRecordingContext(): RecordingContextValue {
  const context = useContext(RecordingContext);
  if (context === undefined) {
    throw new Error('useRecordingContext must be used within a RecordingProvider');
  }
  return context;
}
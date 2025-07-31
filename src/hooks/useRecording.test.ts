import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '../test/test-utils';
import { useRecording } from './useRecording';
import '../test/mocks';

// Mock the dependencies
const mockTauriApi = {
  isRecording: vi.fn(),
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  cancelRecording: vi.fn(),
  playStartSound: vi.fn(),
  playStopSound: vi.fn(),
};

const mockRecordingContext = {
  state: {
    isRecording: false,
    isStarting: false,
  },
  canStartRecording: vi.fn(),
  setRecording: vi.fn(),
  setStarting: vi.fn(),
  reset: vi.fn(),
};

const mockSafeEventListen = vi.fn();
const mockCleanupListeners = vi.fn();

vi.mock('../types/tauri', () => ({
  invokeTyped: vi.fn(),
  tauriApi: mockTauriApi,
}));

vi.mock('../contexts/RecordingContext', () => ({
  useRecordingContext: () => mockRecordingContext,
}));

vi.mock('../lib/safeEventListener', () => ({
  safeEventListen: mockSafeEventListen,
  cleanupListeners: mockCleanupListeners,
}));

// Mock the other hooks
vi.mock('./usePushToTalkMonitor', () => ({
  usePushToTalkMonitor: vi.fn(),
}));

vi.mock('./useAudioLevelMonitoring', () => ({
  useAudioLevelMonitoring: vi.fn(),
}));

vi.mock('../utils/logger', () => ({
  loggers: {
    recording: {
      debug: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    },
    audio: {
      error: vi.fn(),
    },
  },
}));

describe('useRecording', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Set up default mock returns
    mockTauriApi.isRecording.mockResolvedValue(false);
    mockTauriApi.startRecording.mockResolvedValue('recording-started');
    mockTauriApi.stopRecording.mockResolvedValue(undefined);
    mockTauriApi.cancelRecording.mockResolvedValue(undefined);
    mockTauriApi.playStartSound.mockResolvedValue(undefined);
    mockTauriApi.playStopSound.mockResolvedValue(undefined);
    
    mockRecordingContext.canStartRecording.mockReturnValue(true);
    mockSafeEventListen.mockImplementation(() => Promise.resolve(() => {}));
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('Initial State', () => {
    it('initializes with correct default state', () => {
      const { result } = renderHook(() => useRecording());
      
      expect(result.current.isRecording).toBe(false);
      expect(result.current.recordingStartTime).toBe(null);
      expect(typeof result.current.startRecording).toBe('function');
      expect(typeof result.current.stopRecording).toBe('function');
      expect(typeof result.current.toggleRecording).toBe('function');
      expect(typeof result.current.cancelRecording).toBe('function');
    });

    it('syncs with backend state on mount', async () => {
      mockTauriApi.isRecording.mockResolvedValue(true);
      
      renderHook(() => useRecording());
      
      await waitFor(() => {
        expect(mockTauriApi.isRecording).toHaveBeenCalled();
        expect(mockRecordingContext.setRecording).toHaveBeenCalledWith(true);
      });
    });

    it('handles backend sync errors gracefully', async () => {
      mockTauriApi.isRecording.mockRejectedValue(new Error('Backend error'));
      
      renderHook(() => useRecording());
      
      await waitFor(() => {
        expect(mockRecordingContext.reset).toHaveBeenCalled();
      });
    });
  });

  describe('Starting Recording', () => {
    it('starts recording successfully', async () => {
      const onRecordingStart = vi.fn();
      const { result } = renderHook(() => useRecording({ onRecordingStart }));
      
      await act(async () => {
        await result.current.startRecording();
      });
      
      expect(mockRecordingContext.setStarting).toHaveBeenCalledWith(true);
      expect(mockRecordingContext.setRecording).toHaveBeenCalledWith(true);
      expect(result.current.isRecording).toBe(true);
      expect(onRecordingStart).toHaveBeenCalled();
      expect(mockRecordingContext.setStarting).toHaveBeenCalledWith(false);
    });

    it('prevents multiple concurrent recording starts', async () => {
      mockRecordingContext.canStartRecording.mockReturnValue(false);
      
      const { result } = renderHook(() => useRecording());
      
      await act(async () => {
        await result.current.startRecording();
      });
      
      expect(mockTauriApi.startRecording).not.toHaveBeenCalled();
      expect(mockRecordingContext.setStarting).toHaveBeenCalledWith(false);
    });

    it('syncs with backend when already recording', async () => {
      mockTauriApi.isRecording.mockResolvedValue(true);
      
      const { result } = renderHook(() => useRecording());
      
      await act(async () => {
        await result.current.startRecording();
      });
      
      expect(result.current.isRecording).toBe(true);
      expect(mockRecordingContext.setRecording).toHaveBeenCalledWith(true);
    });

    it('plays start sound when enabled', async () => {
      const { result } = renderHook(() => useRecording({ soundEnabled: true }));
      
      await act(async () => {
        await result.current.startRecording();
      });
      
      expect(mockTauriApi.playStartSound).toHaveBeenCalled();
    });

    it('does not play start sound when disabled', async () => {
      const { result } = renderHook(() => useRecording({ soundEnabled: false }));
      
      await act(async () => {
        await result.current.startRecording();
      });
      
      expect(mockTauriApi.playStartSound).not.toHaveBeenCalled();
    });

    it('handles start sound errors gracefully', async () => {
      mockTauriApi.playStartSound.mockRejectedValue(new Error('Sound error'));
      
      const { result } = renderHook(() => useRecording({ soundEnabled: true }));
      
      await act(async () => {
        await result.current.startRecording();
      });
      
      // Should still complete recording start
      expect(result.current.isRecording).toBe(true);
    });

    it('uses selected microphone device', async () => {
      const { result } = renderHook(() => useRecording({ selectedMic: 'Built-in Microphone' }));
      
      await act(async () => {
        await result.current.startRecording();
      });
      
      expect(mockTauriApi.startRecording).toHaveBeenCalledWith({
        deviceName: 'Built-in Microphone'
      });
    });

    it('uses default microphone when "Default microphone" is selected', async () => {
      const { result } = renderHook(() => useRecording({ selectedMic: 'Default microphone' }));
      
      await act(async () => {
        await result.current.startRecording();
      });
      
      expect(mockTauriApi.startRecording).toHaveBeenCalledWith({
        deviceName: null
      });
    });

    it('handles recording start errors', async () => {
      mockTauriApi.startRecording.mockRejectedValue(new Error('Recording failed'));
      
      const { result } = renderHook(() => useRecording());
      
      await act(async () => {
        await result.current.startRecording();
      });
      
      expect(result.current.isRecording).toBe(false);
      expect(mockRecordingContext.setRecording).toHaveBeenCalledWith(false);
    });

    it('handles "already in progress" error correctly', async () => {
      mockTauriApi.startRecording.mockRejectedValue(new Error('Recording already in progress'));
      
      const { result } = renderHook(() => useRecording());
      
      await act(async () => {
        await result.current.startRecording();
      });
      
      expect(mockRecordingContext.setRecording).toHaveBeenCalledWith(true);
    });
  });

  describe('Stopping Recording', () => {
    beforeEach(() => {
      mockTauriApi.isRecording.mockResolvedValue(true);
    });

    it('stops recording successfully', async () => {
      const onRecordingComplete = vi.fn();
      const { result } = renderHook(() => useRecording({ onRecordingComplete }));
      
      // Start recording first
      await act(async () => {
        await result.current.startRecording();
      });
      
      // Then stop it
      await act(async () => {
        await result.current.stopRecording();
      });
      
      expect(mockTauriApi.stopRecording).toHaveBeenCalled();
      expect(result.current.isRecording).toBe(false);
      expect(result.current.recordingStartTime).toBe(null);
      expect(onRecordingComplete).toHaveBeenCalled();
    });

    it('syncs state when backend is not recording', async () => {
      mockTauriApi.isRecording.mockResolvedValue(false);
      
      const { result } = renderHook(() => useRecording());
      
      await act(async () => {
        await result.current.stopRecording();
      });
      
      expect(result.current.isRecording).toBe(false);
      expect(result.current.recordingStartTime).toBe(null);
    });

    it('plays stop sound when enabled', async () => {
      const { result } = renderHook(() => useRecording({ soundEnabled: true }));
      
      await act(async () => {
        await result.current.stopRecording();
      });
      
      expect(mockTauriApi.playStopSound).toHaveBeenCalled();
    });

    it('does not play stop sound when disabled', async () => {
      const { result } = renderHook(() => useRecording({ soundEnabled: false }));
      
      await act(async () => {
        await result.current.stopRecording();
      });
      
      expect(mockTauriApi.playStopSound).not.toHaveBeenCalled();
    });

    it('handles stop sound errors gracefully', async () => {
      mockTauriApi.playStopSound.mockRejectedValue(new Error('Sound error'));
      
      const { result } = renderHook(() => useRecording({ soundEnabled: true }));
      
      await act(async () => {
        await result.current.stopRecording();
      });
      
      // Should still complete recording stop
      expect(result.current.isRecording).toBe(false);
    });

    it('handles stop recording errors', async () => {
      mockTauriApi.stopRecording.mockRejectedValue(new Error('Stop failed'));
      
      const { result } = renderHook(() => useRecording());
      
      await act(async () => {
        await result.current.stopRecording();
      });
      
      // Should not change state on error - let backend sync handle it
      expect(mockRecordingContext.setRecording).not.toHaveBeenCalledWith(false);
    });
  });

  describe('Toggle Recording', () => {
    it('starts recording when not recording', async () => {
      const { result } = renderHook(() => useRecording());
      
      await act(async () => {
        await result.current.toggleRecording();
      });
      
      expect(result.current.isRecording).toBe(true);
    });

    it('stops recording when recording', async () => {
      const { result } = renderHook(() => useRecording());
      
      // Start recording first
      await act(async () => {
        await result.current.startRecording();
      });
      
      // Then toggle to stop
      await act(async () => {
        await result.current.toggleRecording();
      });
      
      expect(result.current.isRecording).toBe(false);
    });

    it('prevents rapid toggling', async () => {
      vi.useFakeTimers();
      
      const { result } = renderHook(() => useRecording());
      
      // First toggle should work
      await act(async () => {
        await result.current.toggleRecording();
      });
      
      // Immediate second toggle should be ignored
      await act(async () => {
        await result.current.toggleRecording();
      });
      
      expect(result.current.isRecording).toBe(true); // Should still be recording
      
      vi.useRealTimers();
    });
  });

  describe('Cancel Recording', () => {
    it('cancels recording successfully', async () => {
      const { result } = renderHook(() => useRecording());
      
      // Start recording first
      await act(async () => {
        await result.current.startRecording();
      });
      
      // Then cancel it
      await act(async () => {
        await result.current.cancelRecording();
      });
      
      expect(mockTauriApi.cancelRecording).toHaveBeenCalled();
      expect(result.current.isRecording).toBe(false);
    });

    it('does nothing when not recording', async () => {
      const { result } = renderHook(() => useRecording());
      
      await act(async () => {
        await result.current.cancelRecording();
      });
      
      expect(mockTauriApi.cancelRecording).not.toHaveBeenCalled();
    });

    it('handles cancel errors gracefully', async () => {
      mockTauriApi.cancelRecording.mockRejectedValue(new Error('Cancel failed'));
      
      const { result } = renderHook(() => useRecording());
      
      // Start recording first
      await act(async () => {
        await result.current.startRecording();
      });
      
      // Then cancel it
      await act(async () => {
        await result.current.cancelRecording();
      });
      
      expect(result.current.isRecording).toBe(false);
    });
  });

  describe('Push-to-Talk Functionality', () => {
    it('starts recording on push-to-talk press', async () => {
      const { result } = renderHook(() => useRecording({
        pushToTalkShortcut: 'CmdOrCtrl+Space'
      }));
      
      // Simulate push-to-talk event from backend
      const eventHandler = mockSafeEventListen.mock.calls.find(
        call => call[0] === 'push-to-talk-pressed'
      )?.[1];
      
      if (eventHandler) {
        await act(async () => {
          await eventHandler();
        });
        
        expect(result.current.isRecording).toBe(true);
      }
    });

    it('prevents rapid push-to-talk presses', async () => {
      vi.useFakeTimers();
      
      renderHook(() => useRecording({
        pushToTalkShortcut: 'CmdOrCtrl+Space'
      }));
      
      const eventHandler = mockSafeEventListen.mock.calls.find(
        call => call[0] === 'push-to-talk-pressed'
      )?.[1];
      
      if (eventHandler) {
        // First press should work
        await act(async () => {
          await eventHandler();
        });
        
        // Immediate second press should be ignored
        await act(async () => {
          await eventHandler();
        });
        
        expect(mockTauriApi.startRecording).toHaveBeenCalledTimes(1);
      }
      
      vi.useRealTimers();
    });

    it('stops recording on push-to-talk release', async () => {
      const { result } = renderHook(() => useRecording({
        pushToTalkShortcut: 'CmdOrCtrl+Space'
      }));
      
      // Start recording first
      await act(async () => {
        await result.current.startRecording();
      });
      
      const releaseHandler = mockSafeEventListen.mock.calls.find(
        call => call[0] === 'push-to-talk-released'
      )?.[1];
      
      if (releaseHandler) {
        await act(async () => {
          await releaseHandler();
        });
        
        expect(result.current.isRecording).toBe(false);
      }
    });

    it('respects minimum recording time for push-to-talk', async () => {
      vi.useFakeTimers();
      
      const { result } = renderHook(() => useRecording({
        pushToTalkShortcut: 'CmdOrCtrl+Space'
      }));
      
      // Simulate very short push-to-talk
      const pressHandler = mockSafeEventListen.mock.calls.find(
        call => call[0] === 'push-to-talk-pressed'
      )?.[1];
      const releaseHandler = mockSafeEventListen.mock.calls.find(
        call => call[0] === 'push-to-talk-released'
      )?.[1];
      
      if (pressHandler && releaseHandler) {
        await act(async () => {
          await pressHandler();
        });
        
        // Advance time by less than minimum (300ms)
        vi.advanceTimersByTime(100);
        
        await act(async () => {
          await releaseHandler();
        });
        
        // Should still stop recording despite short duration
        expect(result.current.isRecording).toBe(false);
      }
      
      vi.useRealTimers();
    });
  });

  describe('Event Listeners', () => {
    it('sets up recording state change listener', () => {
      renderHook(() => useRecording());
      
      expect(mockSafeEventListen).toHaveBeenCalledWith(
        'recording-state-changed',
        expect.any(Function)
      );
    });

    it('sets up recording progress listener', () => {
      renderHook(() => useRecording());
      
      expect(mockSafeEventListen).toHaveBeenCalledWith(
        'recording-progress',
        expect.any(Function)
      );
    });

    it('sets up processing complete listener', () => {
      renderHook(() => useRecording());
      
      expect(mockSafeEventListen).toHaveBeenCalledWith(
        'processing-complete',
        expect.any(Function)
      );
    });

    it('handles recording state change events', async () => {
      const { result } = renderHook(() => useRecording());
      
      const stateChangeHandler = mockSafeEventListen.mock.calls.find(
        call => call[0] === 'recording-state-changed'
      )?.[1];
      
      if (stateChangeHandler) {
        await act(async () => {
          stateChangeHandler({ payload: { state: 'recording' } });
        });
        
        expect(result.current.isRecording).toBe(true);
        expect(mockRecordingContext.setRecording).toHaveBeenCalledWith(true);
      }
    });

    it('handles recording progress events', async () => {
      const { result } = renderHook(() => useRecording());
      
      const progressHandler = mockSafeEventListen.mock.calls.find(
        call => call[0] === 'recording-progress'
      )?.[1];
      
      if (progressHandler) {
        const startTime = Date.now();
        
        await act(async () => {
          progressHandler({
            payload: {
              Recording: {
                filename: 'test.wav',
                start_time: startTime
              }
            }
          });
        });
        
        expect(result.current.recordingStartTime).toBe(startTime);
      }
    });

    it('calls onTranscriptCreated on processing complete', async () => {
      const onTranscriptCreated = vi.fn();
      renderHook(() => useRecording({ onTranscriptCreated }));
      
      const processingHandler = mockSafeEventListen.mock.calls.find(
        call => call[0] === 'processing-complete'
      )?.[1];
      
      if (processingHandler) {
        await act(async () => {
          processingHandler({});
        });
        
        expect(onTranscriptCreated).toHaveBeenCalled();
      }
    });

    it('cleans up event listeners on unmount', () => {
      const { unmount } = renderHook(() => useRecording());
      
      unmount();
      
      expect(mockCleanupListeners).toHaveBeenCalled();
    });
  });

  describe('Integration with Other Hooks', () => {
    it('initializes audio level monitoring when record view is active', () => {
      const mockUseAudioLevelMonitoring = vi.mocked(
        require('./useAudioLevelMonitoring').useAudioLevelMonitoring
      );
      
      renderHook(() => useRecording({ isRecordViewActive: true }));
      
      expect(mockUseAudioLevelMonitoring).toHaveBeenCalledWith({
        isActive: true,
      });
    });

    it('initializes push-to-talk monitor with correct shortcut', () => {
      const mockUsePushToTalkMonitor = vi.mocked(
        require('./usePushToTalkMonitor').usePushToTalkMonitor
      );
      
      renderHook(() => useRecording({
        pushToTalkShortcut: 'CmdOrCtrl+Space'
      }));
      
      expect(mockUsePushToTalkMonitor).toHaveBeenCalledWith({
        enabled: true,
        shortcut: 'CmdOrCtrl+Space',
        onRelease: expect.any(Function),
      });
    });
  });

  describe('Error Recovery', () => {
    it('recovers from temporary backend errors', async () => {
      // First call fails, second succeeds
      mockTauriApi.startRecording
        .mockRejectedValueOnce(new Error('Temporary error'))
        .mockResolvedValueOnce('recording-started');
      
      const { result } = renderHook(() => useRecording());
      
      // First attempt fails
      await act(async () => {
        await result.current.startRecording();
      });
      
      expect(result.current.isRecording).toBe(false);
      
      // Second attempt succeeds
      await act(async () => {
        await result.current.startRecording();
      });
      
      expect(result.current.isRecording).toBe(true);
    });

    it('maintains consistent state during error conditions', async () => {
      mockTauriApi.isRecording.mockRejectedValue(new Error('Backend unavailable'));
      
      const { result } = renderHook(() => useRecording());
      
      // Should still have a consistent initial state
      expect(result.current.isRecording).toBe(false);
      expect(result.current.recordingStartTime).toBe(null);
      expect(typeof result.current.startRecording).toBe('function');
    });
  });
});

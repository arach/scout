import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '../test/test-utils';
import { useRecording } from './useRecording';

// Mock all the dependencies
vi.mock('../types/tauri');
vi.mock('../contexts/RecordingContext');
vi.mock('../lib/safeEventListener');
vi.mock('./usePushToTalkMonitor');
vi.mock('./useAudioLevelMonitoring');
vi.mock('../utils/logger');

describe('useRecording', () => {
  let mockTauriApi: any;
  let mockInvokeTyped: any;
  let mockRecordingContext: any;
  let mockSafeEventListen: any;
  let mockCleanupListeners: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Import and mock modules dynamically
    const { tauriApi, invokeTyped } = await import('../types/tauri');
    const { useRecordingContext } = await import('../contexts/RecordingContext');
    const { safeEventListen, cleanupListeners } = await import('../lib/safeEventListener');

    mockTauriApi = vi.mocked(tauriApi);
    mockInvokeTyped = vi.mocked(invokeTyped);
    mockSafeEventListen = vi.mocked(safeEventListen);
    mockCleanupListeners = vi.mocked(cleanupListeners);

    // Set up recording context mock
    mockRecordingContext = {
      state: { isRecording: false, isStarting: false },
      canStartRecording: vi.fn().mockReturnValue(true),
      setRecording: vi.fn(),
      setStarting: vi.fn(),
      reset: vi.fn(),
    };
    vi.mocked(useRecordingContext).mockReturnValue(mockRecordingContext);

    // Set up default mock behavior
    mockTauriApi.isRecording.mockResolvedValue(false);
    mockTauriApi.startRecording.mockResolvedValue(undefined);
    mockTauriApi.stopRecording.mockResolvedValue(undefined);
    mockTauriApi.cancelRecording.mockResolvedValue(undefined);
    mockTauriApi.playStartSound.mockResolvedValue(undefined);
    mockTauriApi.playStopSound.mockResolvedValue(undefined);
    mockInvokeTyped.mockResolvedValue('success');
    mockSafeEventListen.mockResolvedValue(() => {});
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
      mockTauriApi.isRecording.mockResolvedValue(false);
      mockInvokeTyped.mockResolvedValue('recording-started');
      
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
      
      expect(mockInvokeTyped).not.toHaveBeenCalled();
    });

    it('uses selected microphone device', async () => {
      mockTauriApi.isRecording.mockResolvedValue(false);
      mockInvokeTyped.mockResolvedValue('recording-started');
      
      const { result } = renderHook(() => useRecording({ selectedMic: 'Built-in Microphone' }));
      
      await act(async () => {
        await result.current.startRecording();
      });
      
      expect(mockInvokeTyped).toHaveBeenCalledWith('start_recording', {
        deviceName: 'Built-in Microphone'
      });
    });

    it('uses default microphone when "Default microphone" is selected', async () => {
      mockTauriApi.isRecording.mockResolvedValue(false);
      mockInvokeTyped.mockResolvedValue('recording-started');
      
      const { result } = renderHook(() => useRecording({ selectedMic: 'Default microphone' }));
      
      await act(async () => {
        await result.current.startRecording();
      });
      
      expect(mockInvokeTyped).toHaveBeenCalledWith('start_recording', {
        deviceName: null
      });
    });

    it('handles recording start errors', async () => {
      mockTauriApi.isRecording.mockResolvedValue(false);
      mockInvokeTyped.mockRejectedValue(new Error('Recording failed'));
      
      const { result } = renderHook(() => useRecording());
      
      await act(async () => {
        await result.current.startRecording();
      });
      
      expect(result.current.isRecording).toBe(false);
      expect(mockRecordingContext.setRecording).toHaveBeenCalledWith(false);
    });

    it('handles "already in progress" error correctly', async () => {
      mockTauriApi.isRecording.mockResolvedValue(false);
      mockInvokeTyped.mockRejectedValue(new Error('Recording already in progress'));
      
      const { result } = renderHook(() => useRecording());
      
      await act(async () => {
        await result.current.startRecording();
      });
      
      expect(mockRecordingContext.setRecording).toHaveBeenCalledWith(true);
    });

    it('plays start sound when enabled', async () => {
      mockTauriApi.isRecording.mockResolvedValue(false);
      mockInvokeTyped.mockResolvedValue('recording-started');
      
      const { result } = renderHook(() => useRecording({ soundEnabled: true }));
      
      await act(async () => {
        await result.current.startRecording();
      });
      
      expect(mockTauriApi.playStartSound).toHaveBeenCalled();
    });

    it('does not play start sound when disabled', async () => {
      mockTauriApi.isRecording.mockResolvedValue(false);
      mockInvokeTyped.mockResolvedValue('recording-started');
      
      const { result } = renderHook(() => useRecording({ soundEnabled: false }));
      
      await act(async () => {
        await result.current.startRecording();
      });
      
      expect(mockTauriApi.playStartSound).not.toHaveBeenCalled();
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
      
      expect(mockTauriApi.stopRecording).toHaveBeenCalledTimes(1);
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
  });

  describe('Toggle Recording', () => {
    it('starts recording when not recording', async () => {
      mockTauriApi.isRecording.mockResolvedValue(false);
      mockInvokeTyped.mockResolvedValue('recording-started');
      
      const { result } = renderHook(() => useRecording());
      
      await act(async () => {
        await result.current.toggleRecording();
      });
      
      expect(result.current.isRecording).toBe(true);
    });

    it('stops recording when recording', async () => {
      mockTauriApi.isRecording.mockResolvedValue(true);
      
      const { result } = renderHook(() => useRecording());
      
      // First call to set up recording state
      await act(async () => {
        await result.current.startRecording();
      });
      
      // Then toggle to stop
      await act(async () => {
        await result.current.toggleRecording();
      });
      
      expect(result.current.isRecording).toBe(false);
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
  });

  describe('Event Listeners', () => {
    it('sets up recording state change listener', () => {
      renderHook(() => useRecording());
      
      expect(mockSafeEventListen).toHaveBeenCalledWith(
        'recording-state-changed',
        expect.any(Function)
      );
    });

    it('sets up recording progress listener', async () => {
      renderHook(() => useRecording());
      
      // Wait for async setup
      await waitFor(() => {
        expect(mockSafeEventListen).toHaveBeenCalledWith(
          'recording-progress',
          expect.any(Function)
        );
      });
    });

    it('sets up processing complete listener', async () => {
      renderHook(() => useRecording());
      
      // Wait for async setup
      await waitFor(() => {
        expect(mockSafeEventListen).toHaveBeenCalledWith(
          'processing-complete',
          expect.any(Function)
        );
      });
    });

    it('cleans up event listeners on unmount', () => {
      const { unmount } = renderHook(() => useRecording());
      
      unmount();
      
      expect(mockCleanupListeners).toHaveBeenCalled();
    });
  });
});
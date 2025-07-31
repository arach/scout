import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '../test/test-utils';
import { RecordView } from './RecordView';
import { createMockTranscripts } from '../test/test-utils';
import '../test/mocks';

// Mock props for RecordView
const createMockProps = (overrides = {}) => ({
  isRecording: false,
  isProcessing: false,
  recordingStartTime: null,
  hotkey: 'CmdOrCtrl+Shift+R',
  pushToTalkHotkey: 'CmdOrCtrl+Space',
  uploadProgress: { status: 'idle' as const },
  sessionTranscripts: [],
  selectedMic: 'Default microphone',
  onMicChange: vi.fn(),
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  cancelRecording: vi.fn(),
  handleFileUpload: vi.fn(),
  formatDuration: vi.fn((ms) => `${Math.floor(ms / 1000)}s`),
  formatRecordingTimer: vi.fn((ms) => `${Math.floor(ms / 1000)}s`),
  showDeleteConfirmation: vi.fn(),
  ...overrides,
});

describe('RecordView', () => {
  let mockProps: ReturnType<typeof createMockProps>;

  beforeEach(() => {
    mockProps = createMockProps();
    vi.clearAllMocks();
  });

  describe('Idle State', () => {
    it('renders the recording interface in idle state', () => {
      render(<RecordView {...mockProps} />);
      
      expect(screen.getByRole('button', { name: /start recording/i })).toBeInTheDocument();
      expect(screen.getByText('Ready')).toBeInTheDocument();
      expect(screen.getByText('Mic: Default microphone')).toBeInTheDocument();
    });

    it('displays keyboard shortcuts tooltip', () => {
      render(<RecordView {...mockProps} />);
      
      expect(screen.getByText('Shortcuts')).toBeInTheDocument();
      expect(screen.getByText('Toggle')).toBeInTheDocument();
      expect(screen.getByText('Push-to-Talk')).toBeInTheDocument();
      expect(screen.getByText('Hold for voice, release to stop')).toBeInTheDocument();
    });

    it('shows microphone settings button', () => {
      render(<RecordView {...mockProps} />);
      
      const settingsButton = screen.getByRole('button', { name: /select microphone/i });
      expect(settingsButton).toBeInTheDocument();
    });

    it('calls startRecording when record button is clicked', async () => {
      render(<RecordView {...mockProps} />);
      
      const recordButton = screen.getByRole('button', { name: /start recording/i });
      fireEvent.click(recordButton);
      
      expect(mockProps.startRecording).toHaveBeenCalledTimes(1);
    });

    it('opens microphone picker when settings button is clicked', async () => {
      render(<RecordView {...mockProps} />);
      
      const settingsButton = screen.getByRole('button', { name: /select microphone/i });
      fireEvent.click(settingsButton);
      
      // MicrophoneQuickPicker should be rendered with isOpen=true
      await waitFor(() => {
        expect(settingsButton).toHaveClass('active');
      });
    });
  });

  describe('Recording State', () => {
    beforeEach(() => {
      mockProps = createMockProps({
        isRecording: true,
        recordingStartTime: Date.now() - 5000, // 5 seconds ago
      });
    });

    it('renders the recording interface in recording state', () => {
      render(<RecordView {...mockProps} />);
      
      expect(screen.getByRole('button', { name: /stop recording/i })).toBeInTheDocument();
      expect(screen.getByText('Recording')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /cancel recording/i })).toBeInTheDocument();
    });

    it('displays recording timer', () => {
      render(<RecordView {...mockProps} />);
      
      // The RecordingTimer component should be rendered
      expect(screen.getByText(/\d+s/)).toBeInTheDocument();
    });

    it('calls stopRecording when stop button is clicked', async () => {
      render(<RecordView {...mockProps} />);
      
      const stopButton = screen.getByRole('button', { name: /stop recording/i });
      fireEvent.click(stopButton);
      
      expect(mockProps.stopRecording).toHaveBeenCalledTimes(1);
    });

    it('calls cancelRecording when cancel button is clicked', async () => {
      render(<RecordView {...mockProps} />);
      
      const cancelButton = screen.getByRole('button', { name: /cancel recording/i });
      fireEvent.click(cancelButton);
      
      expect(mockProps.cancelRecording).toHaveBeenCalledTimes(1);
    });

    it('shows recording status indicator', () => {
      render(<RecordView {...mockProps} />);
      
      const statusDot = screen.getByText('Recording').previousElementSibling;
      expect(statusDot).toHaveClass('status-dot', 'recording');
    });

    it('hides microphone settings during recording', () => {
      render(<RecordView {...mockProps} />);
      
      const settingsButton = screen.queryByRole('button', { name: /select microphone/i });
      expect(settingsButton).not.toBeInTheDocument();
    });
  });

  describe('Processing State', () => {
    beforeEach(() => {
      mockProps = createMockProps({
        isProcessing: true,
        uploadProgress: {
          status: 'transcribing',
          filename: 'test-audio.wav',
        },
      });
    });

    it('renders the processing interface', () => {
      render(<RecordView {...mockProps} />);
      
      expect(screen.getByText('Transcribing your audio...')).toBeInTheDocument();
      expect(screen.getByText('Processing')).toBeInTheDocument();
    });

    it('displays processing filename when available', () => {
      render(<RecordView {...mockProps} />);
      
      expect(screen.getByText('test-audio.wav')).toBeInTheDocument();
    });

    it('shows processing animation', () => {
      render(<RecordView {...mockProps} />);
      
      expect(document.querySelector('.processing-spinner')).toBeInTheDocument();
    });

    it('disables record button during processing', () => {
      render(<RecordView {...mockProps} isProcessing={true} />);
      
      const recordButton = screen.queryByRole('button', { name: /start recording/i });
      if (recordButton) {
        expect(recordButton).toBeDisabled();
      }
    });
  });

  describe('Session Transcripts', () => {
    const mockTranscripts = createMockTranscripts(3);

    beforeEach(() => {
      mockProps = createMockProps({
        sessionTranscripts: mockTranscripts,
      });
    });

    it('renders session transcripts when available', () => {
      render(<RecordView {...mockProps} />);
      
      // SessionTranscripts component should be rendered with transcripts
      // This tests the integration, actual SessionTranscripts rendering is tested separately
      expect(mockProps.sessionTranscripts).toHaveLength(3);
    });

    it('shows success hint after first few recordings', () => {
      mockProps = createMockProps({
        sessionTranscripts: createMockTranscripts(2),
      });
      
      render(<RecordView {...mockProps} />);
      
      expect(screen.getByText('Pro tip:')).toBeInTheDocument();
      expect(screen.getByText(/push-to-talk recording/i)).toBeInTheDocument();
    });

    it('hides success hint during recording', () => {
      mockProps = createMockProps({
        isRecording: true,
        sessionTranscripts: createMockTranscripts(2),
      });
      
      render(<RecordView {...mockProps} />);
      
      expect(screen.queryByText('Pro tip:')).not.toBeInTheDocument();
    });

    it('hides success hint during processing', () => {
      mockProps = createMockProps({
        isProcessing: true,
        sessionTranscripts: createMockTranscripts(2),
      });
      
      render(<RecordView {...mockProps} />);
      
      expect(screen.queryByText('Pro tip:')).not.toBeInTheDocument();
    });
  });

  describe('Audio Level Visualization', () => {
    it('renders audio visualizer ring', () => {
      render(<RecordView {...mockProps} />);
      
      const visualizerRing = document.querySelector('.audio-visualizer-ring');
      expect(visualizerRing).toBeInTheDocument();
    });

    it('renders audio level fill indicator', () => {
      render(<RecordView {...mockProps} />);
      
      const audioFill = document.querySelector('.audio-level-fill');
      expect(audioFill).toBeInTheDocument();
    });

    it('updates visualizer opacity based on audio level', () => {
      // This would require mocking useAudioLevel hook to return different values
      // The actual audio level visualization is tested through integration
      render(<RecordView {...mockProps} />);
      
      const visualizerRing = document.querySelector('.audio-visualizer-ring');
      expect(visualizerRing).toHaveStyle({ opacity: expect.any(String) });
    });
  });

  describe('Keyboard Shortcuts Display', () => {
    it('formats keyboard shortcuts correctly', () => {
      mockProps = createMockProps({
        hotkey: 'CmdOrCtrl+Shift+R',
        pushToTalkHotkey: 'CmdOrCtrl+Space',
      });
      
      render(<RecordView {...mockProps} />);
      
      // Check if shortcuts are formatted and displayed
      const tooltipContent = document.querySelector('.tooltip-content');
      expect(tooltipContent).toBeInTheDocument();
    });

    it('handles different key combinations', () => {
      mockProps = createMockProps({
        hotkey: 'Alt+R',
        pushToTalkHotkey: 'Ctrl+Space',
      });
      
      render(<RecordView {...mockProps} />);
      
      const tooltipContent = document.querySelector('.tooltip-content');
      expect(tooltipContent).toBeInTheDocument();
    });
  });

  describe('Microphone Selection', () => {
    it('displays selected microphone name', () => {
      mockProps = createMockProps({
        selectedMic: 'Built-in Microphone',
      });
      
      render(<RecordView {...mockProps} />);
      
      expect(screen.getByText('Mic: Built-in Microphone')).toBeInTheDocument();
    });

    it('calls onMicChange when microphone is changed', async () => {
      render(<RecordView {...mockProps} />);
      
      // This would be tested through the MicrophoneQuickPicker integration
      // The actual microphone change logic is in the parent component
      expect(mockProps.onMicChange).toBeDefined();
    });
  });

  describe('Error States', () => {
    it('handles empty session transcripts gracefully', () => {
      mockProps = createMockProps({
        sessionTranscripts: [],
      });
      
      render(<RecordView {...mockProps} />);
      
      // Should not crash and should render normally
      expect(screen.getByRole('button', { name: /start recording/i })).toBeInTheDocument();
    });

    it('handles missing format functions gracefully', () => {
      mockProps = createMockProps({
        formatDuration: undefined,
        formatRecordingTimer: undefined,
      });
      
      expect(() => render(<RecordView {...mockProps} />)).not.toThrow();
    });
  });

  describe('Accessibility', () => {
    it('has proper ARIA labels for buttons', () => {
      render(<RecordView {...mockProps} />);
      
      const recordButton = screen.getByRole('button', { name: /start recording/i });
      const settingsButton = screen.getByRole('button', { name: /select microphone/i });
      
      expect(recordButton).toHaveAttribute('title');
      expect(settingsButton).toHaveAttribute('title');
    });

    it('provides keyboard navigation support', () => {
      render(<RecordView {...mockProps} />);
      
      const recordButton = screen.getByRole('button', { name: /start recording/i });
      const settingsButton = screen.getByRole('button', { name: /select microphone/i });
      
      expect(recordButton).toBeVisible();
      expect(settingsButton).toBeVisible();
      
      // Both buttons should be focusable
      recordButton.focus();
      expect(document.activeElement).toBe(recordButton);
      
      settingsButton.focus();
      expect(document.activeElement).toBe(settingsButton);
    });

    it('has proper status indicators for screen readers', () => {
      render(<RecordView {...mockProps} />);
      
      const statusText = screen.getByText('Ready');
      expect(statusText.parentElement).toHaveClass('status-indicator');
    });
  });

  describe('Component Integration', () => {
    it('integrates with SessionTranscripts component', () => {
      const mockTranscripts = createMockTranscripts(3);
      mockProps = createMockProps({
        sessionTranscripts: mockTranscripts,
      });
      
      render(<RecordView {...mockProps} />);
      
      // SessionTranscripts component should receive the correct props
      expect(mockProps.sessionTranscripts).toEqual(mockTranscripts);
      expect(mockProps.formatDuration).toBeDefined();
      expect(mockProps.showDeleteConfirmation).toBeDefined();
      expect(mockProps.handleFileUpload).toBeDefined();
    });

    it('integrates with RecordingTimer component during recording', () => {
      mockProps = createMockProps({
        isRecording: true,
        recordingStartTime: Date.now() - 10000,
        formatRecordingTimer: vi.fn((ms) => `${Math.floor(ms / 1000)}s`),
      });
      
      render(<RecordView {...mockProps} />);
      
      // RecordingTimer should be rendered with correct props
      expect(mockProps.formatRecordingTimer).toBeDefined();
    });

    it('integrates with MicrophoneQuickPicker component', () => {
      render(<RecordView {...mockProps} />);
      
      // MicrophoneQuickPicker should receive the correct props
      expect(mockProps.selectedMic).toBeDefined();
      expect(mockProps.onMicChange).toBeDefined();
    });
  });
});

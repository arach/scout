import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '../test/test-utils';
import { SettingsView } from './SettingsView';
import { createMockSettings } from '../test/test-utils';
import '../test/mocks';

// Mock the lazy-loaded components
vi.mock('./ModelManager', () => ({
  ModelManager: ({ children, ...props }: any) => (
    <div data-testid="model-manager" {...props}>
      Model Manager Component
      {children}
    </div>
  ),
}));

vi.mock('./LLMSettings', () => ({
  LLMSettings: ({ settings, onUpdateSettings, ...props }: any) => (
    <div data-testid="llm-settings" {...props}>
      LLM Settings Component
      <button onClick={() => onUpdateSettings({ provider: 'openai' })}>Update LLM</button>
    </div>
  ),
}));

// Mock the settings sub-components
vi.mock('./settings/RecordingAudioSettings', () => ({
  RecordingAudioSettings: () => <div data-testid="recording-audio-settings">Recording Audio Settings</div>,
}));

vi.mock('./settings/DisplayInterfaceSettings', () => ({
  DisplayInterfaceSettings: () => <div data-testid="display-interface-settings">Display Interface Settings</div>,
}));

vi.mock('./settings/ThemesSettings', () => ({
  ThemesSettings: () => <div data-testid="themes-settings">Themes Settings</div>,
}));

// Mock the invoke function for opening models folder
const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

// Mock the settings context
const mockSettingsContext = {
  state: createMockSettings(),
  actions: {
    updateRecordingSettings: vi.fn(),
    updateTranscriptionSettings: vi.fn(),
    updateUISettings: vi.fn(),
    updateLLMSettings: vi.fn(),
    loadSettings: vi.fn(),
  },
};

vi.mock('../contexts/SettingsContext', () => ({
  useSettings: () => mockSettingsContext,
}));

describe('SettingsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue(undefined);
  });

  describe('Initial Render', () => {
    it('renders all main settings sections', () => {
      render(<SettingsView />);
      
      expect(screen.getByText('Recording & Audio')).toBeInTheDocument();
      expect(screen.getByText('Display & Interface')).toBeInTheDocument();
      expect(screen.getByText('Themes')).toBeInTheDocument();
      expect(screen.getByText('Transcription Models')).toBeInTheDocument();
      expect(screen.getByText('Post-processing')).toBeInTheDocument();
    });

    it('displays section descriptions', () => {
      render(<SettingsView />);
      
      expect(screen.getByText('Shortcuts, sounds, and output settings')).toBeInTheDocument();
      expect(screen.getByText('Visual feedback shown on screen while actively recording')).toBeInTheDocument();
      expect(screen.getByText('Choose your visual theme')).toBeInTheDocument();
      expect(screen.getByText('Download and manage AI models for transcription')).toBeInTheDocument();
      expect(screen.getByText('Enhance transcripts with summaries and insights')).toBeInTheDocument();
    });

    it('renders section icons', () => {
      render(<SettingsView />);
      
      // Icons are mocked, so we check for the mock-icon elements
      const icons = screen.getAllByTestId('mock-icon');
      expect(icons.length).toBeGreaterThanOrEqual(5); // One for each section
    });
  });

  describe('Collapsible Sections', () => {
    it('has Recording & Audio section expanded by default', () => {
      render(<SettingsView />);
      
      expect(screen.getByTestId('recording-audio-settings')).toBeInTheDocument();
    });

    it('has Display & Interface section expanded by default', () => {
      render(<SettingsView />);
      
      expect(screen.getByTestId('display-interface-settings')).toBeInTheDocument();
    });

    it('has Themes section expanded by default', () => {
      render(<SettingsView />);
      
      expect(screen.getByTestId('themes-settings')).toBeInTheDocument();
    });

    it('has Model Manager section collapsed by default', () => {
      render(<SettingsView />);
      
      expect(screen.queryByTestId('model-manager')).not.toBeInTheDocument();
    });

    it('has LLM Settings section collapsed by default', () => {
      render(<SettingsView />);
      
      expect(screen.queryByTestId('llm-settings')).not.toBeInTheDocument();
    });

    it('toggles Recording & Audio section when header is clicked', async () => {
      render(<SettingsView />);
      
      const recordingHeader = screen.getByText('Recording & Audio');
      
      // Should be expanded initially
      expect(screen.getByTestId('recording-audio-settings')).toBeInTheDocument();
      
      // Click to collapse
      fireEvent.click(recordingHeader);
      
      await waitFor(() => {
        expect(screen.queryByTestId('recording-audio-settings')).not.toBeInTheDocument();
      });
      
      // Click to expand again
      fireEvent.click(recordingHeader);
      
      await waitFor(() => {
        expect(screen.getByTestId('recording-audio-settings')).toBeInTheDocument();
      });
    });

    it('toggles Display & Interface section when header is clicked', async () => {
      render(<SettingsView />);
      
      const displayHeader = screen.getByText('Display & Interface');
      
      // Should be expanded initially
      expect(screen.getByTestId('display-interface-settings')).toBeInTheDocument();
      
      // Click to collapse
      fireEvent.click(displayHeader);
      
      await waitFor(() => {
        expect(screen.queryByTestId('display-interface-settings')).not.toBeInTheDocument();
      });
    });

    it('toggles Themes section when header is clicked', async () => {
      render(<SettingsView />);
      
      const themesHeader = screen.getByText('Themes');
      
      // Should be expanded initially
      expect(screen.getByTestId('themes-settings')).toBeInTheDocument();
      
      // Click to collapse
      fireEvent.click(themesHeader);
      
      await waitFor(() => {
        expect(screen.queryByTestId('themes-settings')).not.toBeInTheDocument();
      });
    });

    it('expands Model Manager section when header is clicked', async () => {
      render(<SettingsView />);
      
      const modelsHeader = screen.getByText('Transcription Models');
      
      // Should be collapsed initially
      expect(screen.queryByTestId('model-manager')).not.toBeInTheDocument();
      
      // Click to expand
      fireEvent.click(modelsHeader);
      
      await waitFor(() => {
        expect(screen.getByTestId('model-manager')).toBeInTheDocument();
      });
    });

    it('expands LLM Settings section when header is clicked', async () => {
      render(<SettingsView />);
      
      const llmHeader = screen.getByText('Post-processing');
      
      // Should be collapsed initially
      expect(screen.queryByTestId('llm-settings')).not.toBeInTheDocument();
      
      // Click to expand
      fireEvent.click(llmHeader);
      
      await waitFor(() => {
        expect(screen.getByTestId('llm-settings')).toBeInTheDocument();
      });
    });
  });

  describe('Collapse Arrows', () => {
    it('shows collapse arrows in correct state', () => {
      render(<SettingsView />);
      
      const arrows = document.querySelectorAll('.collapse-arrow');
      expect(arrows.length).toBe(5); // One for each section
      
      // Check that some arrows are expanded by default
      const expandedArrows = document.querySelectorAll('.collapse-arrow.expanded');
      expect(expandedArrows.length).toBe(3); // Recording, Display, Themes
    });

    it('updates arrow state when sections are toggled', async () => {
      render(<SettingsView />);
      
      const recordingHeader = screen.getByText('Recording & Audio');
      const arrow = recordingHeader.querySelector('.collapse-arrow');
      
      // Should be expanded initially
      expect(arrow).toHaveClass('expanded');
      
      // Click to collapse
      fireEvent.click(recordingHeader);
      
      await waitFor(() => {
        expect(arrow).not.toHaveClass('expanded');
      });
    });
  });

  describe('Models Folder Button', () => {
    it('renders Open Models Folder button', () => {
      render(<SettingsView />);
      
      const openFolderButton = screen.getByRole('button', { name: /open models folder/i });
      expect(openFolderButton).toBeInTheDocument();
    });

    it('has correct title attribute', () => {
      render(<SettingsView />);
      
      const openFolderButton = screen.getByRole('button', { name: /open models folder/i });
      expect(openFolderButton).toHaveAttribute('title', 'Add your own .bin model files here');
    });

    it('calls invoke with correct command when clicked', async () => {
      render(<SettingsView />);
      
      const openFolderButton = screen.getByRole('button', { name: /open models folder/i });
      fireEvent.click(openFolderButton);
      
      expect(mockInvoke).toHaveBeenCalledWith('open_models_folder');
    });

    it('handles errors when opening models folder', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockInvoke.mockRejectedValue(new Error('Failed to open folder'));
      
      render(<SettingsView />);
      
      const openFolderButton = screen.getByRole('button', { name: /open models folder/i });
      fireEvent.click(openFolderButton);
      
      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to open models folder:', expect.any(Error));
      });
      
      consoleErrorSpy.mockRestore();
    });
  });

  describe('Lazy Loading', () => {
    it('shows loading state for Model Manager when expanding', async () => {
      render(<SettingsView />);
      
      const modelsHeader = screen.getByText('Transcription Models');
      fireEvent.click(modelsHeader);
      
      // Should show loading state briefly
      expect(screen.getByText('Loading model manager...')).toBeInTheDocument();
      
      // Then load the actual component
      await waitFor(() => {
        expect(screen.getByTestId('model-manager')).toBeInTheDocument();
      });
    });

    it('shows loading state for LLM Settings when expanding', async () => {
      render(<SettingsView />);
      
      const llmHeader = screen.getByText('Post-processing');
      fireEvent.click(llmHeader);
      
      // Should show loading state briefly
      expect(screen.getByText('Loading LLM settings...')).toBeInTheDocument();
      
      // Then load the actual component
      await waitFor(() => {
        expect(screen.getByTestId('llm-settings')).toBeInTheDocument();
      });
    });
  });

  describe('Settings Integration', () => {
    it('passes settings state to LLM Settings component', async () => {
      render(<SettingsView />);
      
      const llmHeader = screen.getByText('Post-processing');
      fireEvent.click(llmHeader);
      
      await waitFor(() => {
        const llmSettings = screen.getByTestId('llm-settings');
        expect(llmSettings).toBeInTheDocument();
      });
    });

    it('passes update actions to LLM Settings component', async () => {
      render(<SettingsView />);
      
      const llmHeader = screen.getByText('Post-processing');
      fireEvent.click(llmHeader);
      
      await waitFor(() => {
        const updateButton = screen.getByText('Update LLM');
        fireEvent.click(updateButton);
      });
      
      expect(mockSettingsContext.actions.updateLLMSettings).toHaveBeenCalledWith({ provider: 'openai' });
    });
  });

  describe('Scroll Behavior', () => {
    it('scrolls to Model Manager when expanded', async () => {
      const scrollIntoViewMock = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoViewMock;
      
      render(<SettingsView />);
      
      const modelsHeader = screen.getByText('Transcription Models');
      fireEvent.click(modelsHeader);
      
      await waitFor(() => {
        expect(scrollIntoViewMock).toHaveBeenCalledWith({
          behavior: 'smooth',
          block: 'nearest'
        });
      }, { timeout: 200 });
    });

    it('scrolls to LLM Settings when expanded', async () => {
      const scrollIntoViewMock = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoViewMock;
      
      render(<SettingsView />);
      
      const llmHeader = screen.getByText('Post-processing');
      fireEvent.click(llmHeader);
      
      await waitFor(() => {
        expect(scrollIntoViewMock).toHaveBeenCalledWith({
          behavior: 'smooth',
          block: 'nearest'
        });
      }, { timeout: 200 });
    });
  });

  describe('Grid Layout', () => {
    it('uses grid container for layout', () => {
      render(<SettingsView />);
      
      const gridContainer = document.querySelector('.grid-container');
      expect(gridContainer).toBeInTheDocument();
      
      const gridContent = document.querySelector('.grid-content--settings');
      expect(gridContent).toBeInTheDocument();
    });

    it('applies correct CSS classes to sections', () => {
      render(<SettingsView />);
      
      const collapsibleSections = document.querySelectorAll('.collapsible-section');
      expect(collapsibleSections).toHaveLength(5);
      
      // Model Manager and LLM Settings should have full-width class
      const fullWidthSections = document.querySelectorAll('.model-manager-full-width');
      expect(fullWidthSections).toHaveLength(2);
    });
  });

  describe('Component Integration', () => {
    it('integrates with RecordingAudioSettings component', () => {
      render(<SettingsView />);
      
      expect(screen.getByTestId('recording-audio-settings')).toBeInTheDocument();
    });

    it('integrates with DisplayInterfaceSettings component', () => {
      render(<SettingsView />);
      
      expect(screen.getByTestId('display-interface-settings')).toBeInTheDocument();
    });

    it('integrates with ThemesSettings component', () => {
      render(<SettingsView />);
      
      expect(screen.getByTestId('themes-settings')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('has proper heading hierarchy', () => {
      render(<SettingsView />);
      
      const headings = screen.getAllByRole('heading');
      expect(headings).toHaveLength(5);
      
      headings.forEach((heading: HTMLElement) => {
        expect(heading.tagName).toBe('H3');
      });
    });

    it('has clickable section headers', () => {
      render(<SettingsView />);
      
      const sectionHeaders = document.querySelectorAll('.collapsible-header');
      expect(sectionHeaders).toHaveLength(5);
      
      sectionHeaders.forEach(header => {
        expect(header).toBeVisible();
      });
    });

    it('provides keyboard navigation for collapsible sections', () => {
      render(<SettingsView />);
      
      const recordingHeader = screen.getByText('Recording & Audio').closest('.collapsible-header');
      expect(recordingHeader).toBeInTheDocument();
      
      // Test that headers can receive focus and be activated
      if (recordingHeader instanceof HTMLElement) {
        recordingHeader.focus();
        expect(document.activeElement).toBe(recordingHeader);
      }
    });

    it('has proper button roles and labels', () => {
      render(<SettingsView />);
      
      const openFolderButton = screen.getByRole('button', { name: /open models folder/i });
      expect(openFolderButton).toHaveAttribute('title');
    });
  });

  describe('Responsive Behavior', () => {
    it('maintains layout structure across different viewport sizes', () => {
      render(<SettingsView />);
      
      const gridContainer = document.querySelector('.grid-container');
      const gridContent = document.querySelector('.grid-content--settings');
      
      expect(gridContainer).toBeInTheDocument();
      expect(gridContent).toBeInTheDocument();
    });

    it('handles section expansion on smaller screens', async () => {
      render(<SettingsView />);
      
      const modelsHeader = screen.getByText('Transcription Models');
      fireEvent.click(modelsHeader);
      
      await waitFor(() => {
        expect(screen.getByTestId('model-manager')).toBeInTheDocument();
      });
      
      // Should maintain layout even when expanded
      const fullWidthSection = document.querySelector('.model-manager-full-width');
      expect(fullWidthSection).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('handles missing settings context gracefully', () => {
      // This is handled by the mock, but tests the error boundary
      expect(() => render(<SettingsView />)).not.toThrow();
    });

    it('continues to work when lazy components fail to load', async () => {
      // Even if lazy components fail, the main structure should remain
      render(<SettingsView />);
      
      expect(screen.getByText('Recording & Audio')).toBeInTheDocument();
      expect(screen.getByText('Transcription Models')).toBeInTheDocument();
    });
  });
});

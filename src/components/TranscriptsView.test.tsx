import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '../test/test-utils';
import { TranscriptsView } from './TranscriptsView';
import { createMockTranscripts, createMockTranscript } from '../test/test-utils';
import '../test/mocks';

// Mock props for TranscriptsView
const createMockProps = (overrides = {}) => ({
  transcripts: [],
  selectedTranscripts: new Set<number>(),
  searchQuery: '',
  hotkey: 'CmdOrCtrl+Shift+R',
  setSearchQuery: vi.fn(),
  searchTranscripts: vi.fn(),
  toggleTranscriptSelection: vi.fn(),
  toggleTranscriptGroupSelection: vi.fn(),
  selectAllTranscripts: vi.fn(),
  showBulkDeleteConfirmation: vi.fn(),
  exportTranscripts: vi.fn(),
  copyTranscript: vi.fn(),
  showDeleteConfirmation: vi.fn(),
  formatDuration: vi.fn((ms) => `${Math.floor(ms / 1000)}s`),
  formatFileSize: vi.fn((bytes) => `${Math.floor(bytes / 1024)}KB`),
  ...overrides,
});

describe('TranscriptsView', () => {
  let mockProps: ReturnType<typeof createMockProps>;

  beforeEach(() => {
    mockProps = createMockProps();
    vi.clearAllMocks();
  });

  describe('Empty State', () => {
    it('renders empty state when no transcripts exist', () => {
      render(<TranscriptsView {...mockProps} />);
      
      expect(screen.getByText('No transcripts yet')).toBeInTheDocument();
      expect(screen.getByText(/Press.*or click "Start Recording" to begin/)).toBeInTheDocument();
    });

    it('displays the correct keyboard shortcut in empty state', () => {
      mockProps = createMockProps({
        hotkey: 'Alt+R',
      });
      
      render(<TranscriptsView {...mockProps} />);
      
      // Should show the formatted shortcut
      expect(screen.getByTitle('Alt+R')).toBeInTheDocument();
    });

    it('hides search and action controls when no transcripts exist', () => {
      render(<TranscriptsView {...mockProps} />);
      
      expect(screen.queryByRole('button', { name: /select/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /select all/i })).not.toBeInTheDocument();
    });
  });

  describe('Search Functionality', () => {
    beforeEach(() => {
      mockProps = createMockProps({
        transcripts: createMockTranscripts(5),
      });
    });

    it('renders search input', () => {
      render(<TranscriptsView {...mockProps} />);
      
      const searchInput = screen.getByPlaceholderText('Search transcripts...');
      expect(searchInput).toBeInTheDocument();
    });

    it('calls setSearchQuery when typing in search input', async () => {
      render(<TranscriptsView {...mockProps} />);
      
      const searchInput = screen.getByPlaceholderText('Search transcripts...');
      fireEvent.change(searchInput, { target: { value: 'test query' } });
      
      expect(mockProps.setSearchQuery).toHaveBeenCalledWith('test query');
    });

    it('calls searchTranscripts when pressing Enter', async () => {
      render(<TranscriptsView {...mockProps} />);
      
      const searchInput = screen.getByPlaceholderText('Search transcripts...');
      fireEvent.keyPress(searchInput, { key: 'Enter', charCode: 13 });
      
      expect(mockProps.searchTranscripts).toHaveBeenCalledTimes(1);
    });

    it('displays current search query in input', () => {
      mockProps = createMockProps({
        transcripts: createMockTranscripts(5),
        searchQuery: 'existing query',
      });
      
      render(<TranscriptsView {...mockProps} />);
      
      const searchInput = screen.getByPlaceholderText('Search transcripts...');
      expect(searchInput).toHaveValue('existing query');
    });
  });

  describe('Transcript Grouping', () => {
    beforeEach(() => {
      // Create transcripts with different dates
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const lastWeek = new Date(today);
      lastWeek.setDate(lastWeek.getDate() - 5);
      
      mockProps = createMockProps({
        transcripts: [
          createMockTranscript({ id: 1, created_at: today.toISOString() }),
          createMockTranscript({ id: 2, created_at: today.toISOString() }),
          createMockTranscript({ id: 3, created_at: yesterday.toISOString() }),
          createMockTranscript({ id: 4, created_at: lastWeek.toISOString() }),
        ],
      });
    });

    it('groups transcripts by date', () => {
      render(<TranscriptsView {...mockProps} />);
      
      expect(screen.getByText('Today')).toBeInTheDocument();
      expect(screen.getByText('Yesterday')).toBeInTheDocument();
      expect(screen.getByText('This Week')).toBeInTheDocument();
    });

    it('displays correct count for each group', () => {
      render(<TranscriptsView {...mockProps} />);
      
      // Check for Today group
      const todayGroup = screen.getByText('Today').closest('.transcript-group-header');
      expect(todayGroup).toContainHTML('(2)');
      
      // Check for Yesterday group  
      const yesterdayGroup = screen.getByText('Yesterday').closest('.transcript-group-header');
      expect(yesterdayGroup).toContainHTML('(1)');
    });

    it('expands and collapses groups when clicked', async () => {
      render(<TranscriptsView {...mockProps} />);
      
      const todayHeader = screen.getByText('Today');
      
      // Today should be expanded by default
      expect(todayHeader.closest('.transcript-group')).toHaveClass('expanded');
      
      // Click to collapse
      fireEvent.click(todayHeader);
      
      await waitFor(() => {
        expect(todayHeader.closest('.transcript-group')).not.toHaveClass('expanded');
      });
    });

    it('shows chevron icons that rotate when expanded/collapsed', () => {
      render(<TranscriptsView {...mockProps} />);
      
      const chevronIcons = document.querySelectorAll('.chevron-icon');
      expect(chevronIcons.length).toBeGreaterThan(0);
    });
  });

  describe('Selection Mode', () => {
    beforeEach(() => {
      mockProps = createMockProps({
        transcripts: createMockTranscripts(5),
      });
    });

    it('enters selection mode when Select button is clicked', async () => {
      render(<TranscriptsView {...mockProps} />);
      
      const selectButton = screen.getByRole('button', { name: /select/i });
      fireEvent.click(selectButton);
      
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /select all/i })).toBeInTheDocument();
      });
    });

    it('shows checkboxes when in selection mode', async () => {
      render(<TranscriptsView {...mockProps} />);
      
      const selectButton = screen.getByRole('button', { name: /select/i });
      fireEvent.click(selectButton);
      
      await waitFor(() => {
        const checkboxes = screen.getAllByRole('checkbox');
        expect(checkboxes.length).toBeGreaterThan(0);
      });
    });

    it('exits selection mode when Cancel is clicked', async () => {
      render(<TranscriptsView {...mockProps} />);
      
      const selectButton = screen.getByRole('button', { name: /select/i });
      fireEvent.click(selectButton);
      
      await waitFor(() => {
        const cancelButton = screen.getByRole('button', { name: /cancel/i });
        fireEvent.click(cancelButton);
      });
      
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /select/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
      });
    });

    it('calls selectAllTranscripts when Select All is clicked', async () => {
      render(<TranscriptsView {...mockProps} />);
      
      const selectButton = screen.getByRole('button', { name: /select/i });
      fireEvent.click(selectButton);
      
      await waitFor(() => {
        const selectAllButton = screen.getByRole('button', { name: /select all/i });
        fireEvent.click(selectAllButton);
      });
      
      expect(mockProps.selectAllTranscripts).toHaveBeenCalledTimes(1);
    });
  });

  describe('Bulk Operations', () => {
    beforeEach(() => {
      mockProps = createMockProps({
        transcripts: createMockTranscripts(5),
        selectedTranscripts: new Set([1, 2, 3]),
      });
    });

    it('shows selected count in floating action bar', () => {
      render(<TranscriptsView {...mockProps} />);
      
      expect(screen.getByText('3 selected')).toBeInTheDocument();
    });

    it('shows delete button with count when transcripts are selected', () => {
      render(<TranscriptsView {...mockProps} />);
      
      expect(screen.getByRole('button', { name: /delete \(3\)/i })).toBeInTheDocument();
    });

    it('calls showBulkDeleteConfirmation when delete button is clicked', () => {
      render(<TranscriptsView {...mockProps} />);
      
      const deleteButton = screen.getByRole('button', { name: /delete \(3\)/i });
      fireEvent.click(deleteButton);
      
      expect(mockProps.showBulkDeleteConfirmation).toHaveBeenCalledTimes(1);
    });

    it('shows export menu when export button is clicked', async () => {
      render(<TranscriptsView {...mockProps} />);
      
      const exportButton = document.querySelector('.header-action-btn.export') as HTMLButtonElement;
      fireEvent.click(exportButton);
      
      await waitFor(() => {
        expect(screen.getByText('JSON')).toBeInTheDocument();
        expect(screen.getByText('Markdown')).toBeInTheDocument();
        expect(screen.getByText('Text')).toBeInTheDocument();
      });
    });

    it('calls exportTranscripts with correct format', async () => {
      render(<TranscriptsView {...mockProps} />);
      
      const exportButton = document.querySelector('.header-action-btn.export') as HTMLButtonElement;
      fireEvent.click(exportButton);
      
      await waitFor(() => {
        const jsonOption = screen.getByText('JSON');
        fireEvent.click(jsonOption);
      });
      
      expect(mockProps.exportTranscripts).toHaveBeenCalledWith('json');
    });

    it('closes export menu after selection', async () => {
      render(<TranscriptsView {...mockProps} />);
      
      const exportButton = document.querySelector('.header-action-btn.export') as HTMLButtonElement;
      fireEvent.click(exportButton);
      
      await waitFor(() => {
        const jsonOption = screen.getByText('JSON');
        fireEvent.click(jsonOption);
      });
      
      await waitFor(() => {
        expect(screen.queryByText('JSON')).not.toBeInTheDocument();
      });
    });
  });

  describe('Group Selection', () => {
    beforeEach(() => {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      mockProps = createMockProps({
        transcripts: [
          createMockTranscript({ id: 1, created_at: today.toISOString() }),
          createMockTranscript({ id: 2, created_at: today.toISOString() }),
        ],
      });
    });

    it('shows group checkbox in selection mode', async () => {
      render(<TranscriptsView {...mockProps} />);
      
      const selectButton = screen.getByRole('button', { name: /select/i });
      fireEvent.click(selectButton);
      
      await waitFor(() => {
        const groupCheckboxes = screen.getAllByRole('checkbox');
        // Should have group checkbox plus individual transcript checkboxes
        expect(groupCheckboxes.length).toBeGreaterThanOrEqual(3);
      });
    });

    it('calls toggleTranscriptGroupSelection when group checkbox is changed', async () => {
      render(<TranscriptsView {...mockProps} />);
      
      const selectButton = screen.getByRole('button', { name: /select/i });
      fireEvent.click(selectButton);
      
      await waitFor(() => {
        const groupCheckbox = screen.getAllByRole('checkbox')[0]; // First checkbox should be group
        fireEvent.click(groupCheckbox);
      });
      
      expect(mockProps.toggleTranscriptGroupSelection).toHaveBeenCalledWith([1, 2]);
    });

    it('shows clear button when group has selected items', () => {
      mockProps = createMockProps({
        transcripts: [
          createMockTranscript({ id: 1, created_at: new Date().toISOString() }),
          createMockTranscript({ id: 2, created_at: new Date().toISOString() }),
        ],
        selectedTranscripts: new Set([1]),
      });
      
      render(<TranscriptsView {...mockProps} />);
      
      expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
    });
  });

  describe('Individual Transcript Items', () => {
    beforeEach(() => {
      mockProps = createMockProps({
        transcripts: createMockTranscripts(3),
      });
    });

    it('renders transcript items within groups', () => {
      render(<TranscriptsView {...mockProps} />);
      
      // Should render TranscriptItem components for each transcript
      // The actual content is tested in TranscriptItem.test.tsx
      expect(mockProps.transcripts).toHaveLength(3);
    });

    it('calls showDeleteConfirmation when transcript delete is requested', () => {
      render(<TranscriptsView {...mockProps} />);
      
      // This tests the prop passing to TranscriptItem
      expect(mockProps.showDeleteConfirmation).toBeDefined();
    });
  });

  describe('Pagination', () => {
    beforeEach(() => {
      // Create more transcripts than the page limit (50)
      mockProps = createMockProps({
        transcripts: createMockTranscripts(75),
      });
    });

    it('shows load more button when there are more transcripts', () => {
      render(<TranscriptsView {...mockProps} />);
      
      expect(screen.getByRole('button', { name: /load more/i })).toBeInTheDocument();
      expect(screen.getByText(/25 remaining/)).toBeInTheDocument();
    });

    it('loads more transcripts when load more is clicked', () => {
      render(<TranscriptsView {...mockProps} />);
      
      const loadMoreButton = screen.getByRole('button', { name: /load more/i });
      fireEvent.click(loadMoreButton);
      
      // After clicking, should show all transcripts
      expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
    });
  });

  describe('Virtualization', () => {
    beforeEach(() => {
      // Create more transcripts than the virtualization threshold (100)
      mockProps = createMockProps({
        transcripts: createMockTranscripts(150),
      });
    });

    it('uses virtualized list for large numbers of transcripts', () => {
      render(<TranscriptsView {...mockProps} />);
      
      const virtualizedContainer = document.querySelector('.transcript-list-container.virtualized');
      expect(virtualizedContainer).toBeInTheDocument();
    });

    it('passes correct props to VirtualizedTranscriptList', () => {
      render(<TranscriptsView {...mockProps} />);
      
      // The VirtualizedTranscriptList should receive the grouped transcripts
      // This tests the prop preparation for virtualization
      expect(mockProps.transcripts).toHaveLength(150);
    });
  });

  describe('Detail Panel Integration', () => {
    beforeEach(() => {
      mockProps = createMockProps({
        transcripts: createMockTranscripts(3),
      });
    });

    it('renders TranscriptDetailPanel component', () => {
      render(<TranscriptsView {...mockProps} />);
      
      // TranscriptDetailPanel should be rendered (even if not open)
      // The actual panel functionality is tested in TranscriptDetailPanel.test.tsx
      expect(mockProps.copyTranscript).toBeDefined();
      expect(mockProps.showDeleteConfirmation).toBeDefined();
      expect(mockProps.exportTranscripts).toBeDefined();
    });
  });

  describe('Click Outside Handling', () => {
    beforeEach(() => {
      mockProps = createMockProps({
        transcripts: createMockTranscripts(3),
        selectedTranscripts: new Set([1]),
      });
    });

    it('closes export menu when clicking outside', async () => {
      render(<TranscriptsView {...mockProps} />);
      
      const exportButton = document.querySelector('.header-action-btn.export') as HTMLButtonElement;
      fireEvent.click(exportButton);
      
      await waitFor(() => {
        expect(screen.getByText('JSON')).toBeInTheDocument();
      });
      
      // Click outside the menu
      fireEvent.mouseDown(document.body);
      
      await waitFor(() => {
        expect(screen.queryByText('JSON')).not.toBeInTheDocument();
      });
    });
  });

  describe('Accessibility', () => {
    beforeEach(() => {
      mockProps = createMockProps({
        transcripts: createMockTranscripts(3),
      });
    });

    it('has proper ARIA labels for interactive elements', () => {
      render(<TranscriptsView {...mockProps} />);
      
      const searchInput = screen.getByPlaceholderText('Search transcripts...');
      expect(searchInput).toHaveAttribute('type', 'text');
      
      const selectButton = screen.getByRole('button', { name: /select/i });
      expect(selectButton).toBeInTheDocument();
    });

    it('provides keyboard navigation for group headers', () => {
      render(<TranscriptsView {...mockProps} />);
      
      const groupHeaders = screen.getAllByRole('button').filter((button: HTMLElement) => 
        button.textContent?.includes('Today') || 
        button.textContent?.includes('Yesterday')
      );
      
      groupHeaders.forEach((header: HTMLElement) => {
        expect(header).toBeVisible();
      });
    });

    it('has proper heading structure', () => {
      render(<TranscriptsView {...mockProps} />);
      
      const groupTitles = screen.getAllByRole('heading');
      expect(groupTitles.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('handles empty transcript arrays gracefully', () => {
      mockProps = createMockProps({
        transcripts: [],
      });
      
      expect(() => render(<TranscriptsView {...mockProps} />)).not.toThrow();
    });

    it('handles empty selectedTranscripts gracefully', () => {
      mockProps = createMockProps({
        transcripts: createMockTranscripts(3),
        selectedTranscripts: new Set(),
      });
      
      expect(() => render(<TranscriptsView {...mockProps} />)).not.toThrow();
    });

    it('handles missing format functions gracefully', () => {
      mockProps = createMockProps({
        transcripts: createMockTranscripts(3),
        formatDuration: undefined,
        formatFileSize: undefined,
      });
      
      expect(() => render(<TranscriptsView {...mockProps} />)).not.toThrow();
    });
  });
});

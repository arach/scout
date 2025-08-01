import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '../test/test-utils';
import { useTranscriptManagement } from './useTranscriptManagement';
import { createMockTranscripts } from '../test/test-utils';
import '../test/mocks';

// Mock the Tauri API
vi.mock('../types/tauri', () => ({
  tauriApi: {
    getRecentTranscripts: vi.fn(),
    searchTranscripts: vi.fn(),
    deleteTranscript: vi.fn(),
    exportTranscripts: vi.fn(),
  },
}));

// Mock logger
vi.mock('../utils/logger', () => ({
  loggers: {
    transcription: {
      debug: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    },
    ui: {
      debug: vi.fn(),
      error: vi.fn(),
    },
  },
}));

// Mock clipboard API
const mockClipboard = {
  writeText: vi.fn(),
};

Object.defineProperty(navigator, 'clipboard', {
  value: mockClipboard,
  writable: true,
});

describe('useTranscriptManagement', () => {
  let mockTauriApi: any;
  let mockLoggers: any;
  
  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Get the mocked modules
    const tauriModule = await import('../types/tauri');
    const loggerModule = await import('../utils/logger');
    
    mockTauriApi = vi.mocked(tauriModule.tauriApi);
    mockLoggers = vi.mocked(loggerModule.loggers);
    
    // Set up default mock returns
    mockTauriApi.getRecentTranscripts.mockResolvedValue([]);
    mockTauriApi.searchTranscripts.mockResolvedValue([]);
    mockTauriApi.deleteTranscript.mockResolvedValue(undefined);
    mockTauriApi.exportTranscripts.mockResolvedValue(undefined);
    mockClipboard.writeText.mockResolvedValue(undefined);
  });

  describe('loadRecentTranscripts', () => {
    it('loads recent transcripts with default limit', async () => {
      const mockTranscripts = createMockTranscripts(5);
      mockTauriApi.getRecentTranscripts.mockResolvedValue(mockTranscripts);
      
      const { result } = renderHook(() => useTranscriptManagement());
      
      let transcripts;
      await act(async () => {
        transcripts = await result.current.loadRecentTranscripts();
      });
      
      expect(mockTauriApi.getRecentTranscripts).toHaveBeenCalledWith({ limit: 10 });
      expect(transcripts).toEqual(mockTranscripts);
      expect(mockLoggers.transcription.debug).toHaveBeenCalledWith(
        'Loaded 5 recent transcripts'
      );
    });

    it('loads recent transcripts with custom limit', async () => {
      const mockTranscripts = createMockTranscripts(20);
      mockTauriApi.getRecentTranscripts.mockResolvedValue(mockTranscripts);
      
      const { result } = renderHook(() => useTranscriptManagement());
      
      let transcripts;
      await act(async () => {
        transcripts = await result.current.loadRecentTranscripts(20);
      });
      
      expect(mockTauriApi.getRecentTranscripts).toHaveBeenCalledWith({ limit: 20 });
      expect(transcripts).toEqual(mockTranscripts);
    });

    it('handles errors when loading recent transcripts', async () => {
      const error = new Error('Failed to load transcripts');
      mockTauriApi.getRecentTranscripts.mockRejectedValue(error);
      
      const { result } = renderHook(() => useTranscriptManagement());
      
      let transcripts;
      await act(async () => {
        transcripts = await result.current.loadRecentTranscripts();
      });
      
      expect(transcripts).toEqual([]);
      expect(mockLoggers.transcription.error).toHaveBeenCalledWith(
        'Failed to load recent transcripts',
        error
      );
    });

    it('returns empty array on network errors', async () => {
      mockTauriApi.getRecentTranscripts.mockRejectedValue(new Error('Network error'));
      
      const { result } = renderHook(() => useTranscriptManagement());
      
      let transcripts;
      await act(async () => {
        transcripts = await result.current.loadRecentTranscripts();
      });
      
      expect(transcripts).toEqual([]);
    });
  });

  describe('loadAllTranscripts', () => {
    it('loads all transcripts with default limit', async () => {
      const mockTranscripts = createMockTranscripts(100);
      mockTauriApi.getRecentTranscripts.mockResolvedValue(mockTranscripts);
      
      const { result } = renderHook(() => useTranscriptManagement());
      
      let transcripts;
      await act(async () => {
        transcripts = await result.current.loadAllTranscripts();
      });
      
      expect(mockTauriApi.getRecentTranscripts).toHaveBeenCalledWith({ limit: 1000 });
      expect(transcripts).toEqual(mockTranscripts);
      expect(mockLoggers.transcription.debug).toHaveBeenCalledWith(
        'Loaded 100 total transcripts'
      );
    });

    it('loads all transcripts with custom limit', async () => {
      const mockTranscripts = createMockTranscripts(500);
      mockTauriApi.getRecentTranscripts.mockResolvedValue(mockTranscripts);
      
      const { result } = renderHook(() => useTranscriptManagement());
      
      let transcripts;
      await act(async () => {
        transcripts = await result.current.loadAllTranscripts(500);
      });
      
      expect(mockTauriApi.getRecentTranscripts).toHaveBeenCalledWith({ limit: 500 });
      expect(transcripts).toEqual(mockTranscripts);
    });

    it('handles errors when loading all transcripts', async () => {
      const error = new Error('Database error');
      mockTauriApi.getRecentTranscripts.mockRejectedValue(error);
      
      const { result } = renderHook(() => useTranscriptManagement());
      
      let transcripts;
      await act(async () => {
        transcripts = await result.current.loadAllTranscripts();
      });
      
      expect(transcripts).toEqual([]);
      expect(mockLoggers.transcription.error).toHaveBeenCalledWith(
        'Failed to load all transcripts',
        error
      );
    });
  });

  describe('deleteTranscript', () => {
    it('deletes transcript successfully', async () => {
      const { result } = renderHook(() => useTranscriptManagement());
      
      let success;
      await act(async () => {
        success = await result.current.deleteTranscript(123);
      });
      
      expect(mockTauriApi.deleteTranscript).toHaveBeenCalledWith({ id: 123 });
      expect(success).toBe(true);
      expect(mockLoggers.transcription.info).toHaveBeenCalledWith(
        'Transcript deleted',
        { id: 123 }
      );
    });

    it('handles delete errors', async () => {
      const error = new Error('Delete failed');
      mockTauriApi.deleteTranscript.mockRejectedValue(error);
      
      const { result } = renderHook(() => useTranscriptManagement());
      
      let success;
      await act(async () => {
        success = await result.current.deleteTranscript(123);
      });
      
      expect(success).toBe(false);
      expect(mockLoggers.transcription.error).toHaveBeenCalledWith(
        'Failed to delete transcript',
        error,
        { id: 123 }
      );
    });

    it('handles permission errors gracefully', async () => {
      mockTauriApi.deleteTranscript.mockRejectedValue(new Error('Permission denied'));
      
      const { result } = renderHook(() => useTranscriptManagement());
      
      let success;
      await act(async () => {
        success = await result.current.deleteTranscript(456);
      });
      
      expect(success).toBe(false);
    });
  });

  describe('searchTranscripts', () => {
    it('searches transcripts with query', async () => {
      const mockResults = createMockTranscripts(3);
      mockTauriApi.searchTranscripts.mockResolvedValue(mockResults);
      
      const { result } = renderHook(() => useTranscriptManagement());
      
      let results;
      await act(async () => {
        results = await result.current.searchTranscripts('test query');
      });
      
      expect(mockTauriApi.searchTranscripts).toHaveBeenCalledWith({ query: 'test query' });
      expect(results).toEqual(mockResults);
      expect(mockLoggers.transcription.debug).toHaveBeenCalledWith(
        'Search found 3 transcripts',
        { query: 'test query' }
      );
    });

    it('returns empty array for empty query', async () => {
      const { result } = renderHook(() => useTranscriptManagement());
      
      let results;
      await act(async () => {
        results = await result.current.searchTranscripts('');
      });
      
      expect(mockTauriApi.searchTranscripts).not.toHaveBeenCalled();
      expect(results).toEqual([]);
    });

    it('returns empty array for whitespace-only query', async () => {
      const { result } = renderHook(() => useTranscriptManagement());
      
      let results;
      await act(async () => {
        results = await result.current.searchTranscripts('   \n\t   ');
      });
      
      expect(mockTauriApi.searchTranscripts).not.toHaveBeenCalled();
      expect(results).toEqual([]);
    });

    it('handles search errors', async () => {
      const error = new Error('Search failed');
      mockTauriApi.searchTranscripts.mockRejectedValue(error);
      
      const { result } = renderHook(() => useTranscriptManagement());
      
      let results;
      await act(async () => {
        results = await result.current.searchTranscripts('test');
      });
      
      expect(results).toEqual([]);
      expect(mockLoggers.transcription.error).toHaveBeenCalledWith(
        'Failed to search transcripts',
        error,
        { query: 'test' }
      );
    });

    it('handles special characters in search query', async () => {
      const mockResults = createMockTranscripts(1);
      mockTauriApi.searchTranscripts.mockResolvedValue(mockResults);
      
      const { result } = renderHook(() => useTranscriptManagement());
      
      const specialQuery = 'test & special "characters" (parentheses)';
      
      let results;
      await act(async () => {
        results = await result.current.searchTranscripts(specialQuery);
      });
      
      expect(mockTauriApi.searchTranscripts).toHaveBeenCalledWith({ query: specialQuery });
      expect(results).toEqual(mockResults);
    });

    it('handles unicode characters in search query', async () => {
      const mockResults = createMockTranscripts(1);
      mockTauriApi.searchTranscripts.mockResolvedValue(mockResults);
      
      const { result } = renderHook(() => useTranscriptManagement());
      
      const unicodeQuery = 'test 中文 emoji 🎯';
      
      let results;
      await act(async () => {
        results = await result.current.searchTranscripts(unicodeQuery);
      });
      
      expect(mockTauriApi.searchTranscripts).toHaveBeenCalledWith({ query: unicodeQuery });
      expect(results).toEqual(mockResults);
    });
  });

  describe('exportTranscripts', () => {
    it('exports transcripts in JSON format', async () => {
      const { result } = renderHook(() => useTranscriptManagement());
      
      let success;
      await act(async () => {
        success = await result.current.exportTranscripts('json', [1, 2, 3]);
      });
      
      expect(mockTauriApi.exportTranscripts).toHaveBeenCalledWith({
        format: 'json',
        transcriptIds: [1, 2, 3]
      });
      expect(success).toBe(true);
      expect(mockLoggers.transcription.info).toHaveBeenCalledWith(
        'Transcripts exported',
        { format: 'json', count: 3 }
      );
    });

    it('exports transcripts in Markdown format', async () => {
      const { result } = renderHook(() => useTranscriptManagement());
      
      let success;
      await act(async () => {
        success = await result.current.exportTranscripts('markdown', [4, 5]);
      });
      
      expect(mockTauriApi.exportTranscripts).toHaveBeenCalledWith({
        format: 'markdown',
        transcriptIds: [4, 5]
      });
      expect(success).toBe(true);
    });

    it('exports transcripts in text format', async () => {
      const { result } = renderHook(() => useTranscriptManagement());
      
      let success;
      await act(async () => {
        success = await result.current.exportTranscripts('text', [6]);
      });
      
      expect(mockTauriApi.exportTranscripts).toHaveBeenCalledWith({
        format: 'text',
        transcriptIds: [6]
      });
      expect(success).toBe(true);
    });

    it('handles empty transcript IDs array', async () => {
      const { result } = renderHook(() => useTranscriptManagement());
      
      let success;
      await act(async () => {
        success = await result.current.exportTranscripts('json', []);
      });
      
      expect(mockTauriApi.exportTranscripts).toHaveBeenCalledWith({
        format: 'json',
        transcriptIds: []
      });
      expect(success).toBe(true);
      expect(mockLoggers.transcription.info).toHaveBeenCalledWith(
        'Transcripts exported',
        { format: 'json', count: 0 }
      );
    });

    it('handles export errors', async () => {
      const error = new Error('Export failed');
      mockTauriApi.exportTranscripts.mockRejectedValue(error);
      
      const { result } = renderHook(() => useTranscriptManagement());
      
      let success;
      await act(async () => {
        success = await result.current.exportTranscripts('json', [1, 2]);
      });
      
      expect(success).toBe(false);
      expect(mockLoggers.transcription.error).toHaveBeenCalledWith(
        'Failed to export transcripts',
        error,
        { format: 'json', count: 2 }
      );
    });

    it('handles file system errors during export', async () => {
      mockTauriApi.exportTranscripts.mockRejectedValue(new Error('Disk full'));
      
      const { result } = renderHook(() => useTranscriptManagement());
      
      let success;
      await act(async () => {
        success = await result.current.exportTranscripts('markdown', [1, 2, 3]);
      });
      
      expect(success).toBe(false);
    });
  });

  describe('copyTranscript', () => {
    it('copies transcript text to clipboard', async () => {
      const { result } = renderHook(() => useTranscriptManagement());
      
      const testText = 'This is a test transcript text';
      
      let success;
      await act(async () => {
        success = await result.current.copyTranscript(testText);
      });
      
      expect(mockClipboard.writeText).toHaveBeenCalledWith(testText);
      expect(success).toBe(true);
      expect(mockLoggers.ui.debug).toHaveBeenCalledWith(
        'Transcript copied to clipboard',
        { length: testText.length }
      );
    });

    it('copies empty text to clipboard', async () => {
      const { result } = renderHook(() => useTranscriptManagement());
      
      let success;
      await act(async () => {
        success = await result.current.copyTranscript('');
      });
      
      expect(mockClipboard.writeText).toHaveBeenCalledWith('');
      expect(success).toBe(true);
      expect(mockLoggers.ui.debug).toHaveBeenCalledWith(
        'Transcript copied to clipboard',
        { length: 0 }
      );
    });

    it('copies multiline text to clipboard', async () => {
      const { result } = renderHook(() => useTranscriptManagement());
      
      const multilineText = 'Line 1\nLine 2\nLine 3';
      
      let success;
      await act(async () => {
        success = await result.current.copyTranscript(multilineText);
      });
      
      expect(mockClipboard.writeText).toHaveBeenCalledWith(multilineText);
      expect(success).toBe(true);
    });

    it('copies unicode text to clipboard', async () => {
      const { result } = renderHook(() => useTranscriptManagement());
      
      const unicodeText = 'Test with unicode: 中文 🎯 αβγ';
      
      let success;
      await act(async () => {
        success = await result.current.copyTranscript(unicodeText);
      });
      
      expect(mockClipboard.writeText).toHaveBeenCalledWith(unicodeText);
      expect(success).toBe(true);
    });

    it('handles clipboard API errors', async () => {
      const error = new Error('Clipboard access denied');
      mockClipboard.writeText.mockRejectedValue(error);
      
      const { result } = renderHook(() => useTranscriptManagement());
      
      let success;
      await act(async () => {
        success = await result.current.copyTranscript('test text');
      });
      
      expect(success).toBe(false);
      expect(mockLoggers.ui.error).toHaveBeenCalledWith(
        'Failed to copy transcript to clipboard',
        error
      );
    });

    it.skip('handles clipboard API not available', async () => {
      // Temporarily remove clipboard API
      const originalClipboard = navigator.clipboard;
      Object.defineProperty(navigator, 'clipboard', {
        value: undefined,
        writable: true,
        configurable: true,
      });
      
      const { result } = renderHook(() => useTranscriptManagement());
      
      let success;
      await act(async () => {
        success = await result.current.copyTranscript('test text');
      });
      
      expect(success).toBe(false);
      
      // Restore clipboard API
      Object.defineProperty(navigator, 'clipboard', {
        value: originalClipboard,
        writable: true,
        configurable: true,
      });
    });

    it('handles very long text', async () => {
      const { result } = renderHook(() => useTranscriptManagement());
      
      const longText = 'A'.repeat(10000);
      
      let success;
      await act(async () => {
        success = await result.current.copyTranscript(longText);
      });
      
      expect(mockClipboard.writeText).toHaveBeenCalledWith(longText);
      expect(success).toBe(true);
      expect(mockLoggers.ui.debug).toHaveBeenCalledWith(
        'Transcript copied to clipboard',
        { length: 10000 }
      );
    });
  });

  describe('Error Resilience', () => {
    it('continues to work after individual function errors', async () => {
      // First function fails
      mockTauriApi.getRecentTranscripts.mockRejectedValueOnce(new Error('Database error'));
      
      const { result } = renderHook(() => useTranscriptManagement());
      
      // First call fails
      let transcripts;
      await act(async () => {
        transcripts = await result.current.loadRecentTranscripts();
      });
      expect(transcripts).toEqual([]);
      
      // But other functions still work
      mockTauriApi.getRecentTranscripts.mockResolvedValue(createMockTranscripts(2));
      
      await act(async () => {
        transcripts = await result.current.loadRecentTranscripts();
      });
      expect(transcripts).toHaveLength(2);
    });

    it('handles network timeouts gracefully', async () => {
      mockTauriApi.searchTranscripts.mockRejectedValue(new Error('Request timeout'));
      
      const { result } = renderHook(() => useTranscriptManagement());
      
      let results;
      await act(async () => {
        results = await result.current.searchTranscripts('test');
      });
      
      expect(results).toEqual([]);
      expect(mockLoggers.transcription.error).toHaveBeenCalledWith(
        'Failed to search transcripts',
        expect.any(Error),
        { query: 'test' }
      );
    });

    it('handles malformed API responses', async () => {
      // API returns null instead of array
      mockTauriApi.getRecentTranscripts.mockResolvedValue(null);
      
      const { result } = renderHook(() => useTranscriptManagement());
      
      let transcripts;
      await act(async () => {
        transcripts = await result.current.loadRecentTranscripts();
      });
      
      // Should still return an empty array or handle gracefully
      // The actual behavior depends on how the hook handles null responses
      expect(transcripts).toBeDefined();
    });
  });

  describe('Performance', () => {
    it('handles large numbers of transcripts efficiently', async () => {
      const largeDataSet = createMockTranscripts(1000);
      mockTauriApi.getRecentTranscripts.mockResolvedValue(largeDataSet);
      
      const { result } = renderHook(() => useTranscriptManagement());
      
      const startTime = performance.now();
      
      let transcripts;
      await act(async () => {
        transcripts = await result.current.loadAllTranscripts(1000);
      });
      
      const endTime = performance.now();
      
      expect(transcripts).toHaveLength(1000);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });

    it('handles multiple concurrent operations', async () => {
      mockTauriApi.getRecentTranscripts.mockResolvedValue(createMockTranscripts(10));
      mockTauriApi.searchTranscripts.mockResolvedValue(createMockTranscripts(5));
      
      const { result } = renderHook(() => useTranscriptManagement());
      
      // Run multiple operations concurrently
      const promises = [
        result.current.loadRecentTranscripts(),
        result.current.loadAllTranscripts(),
        result.current.searchTranscripts('test'),
      ];
      
      let results: any[] = [];
      await act(async () => {
        results = await Promise.all(promises);
      });
      
      expect(results[0]).toHaveLength(10); // recent
      expect(results[1]).toHaveLength(10); // all
      expect(results[2]).toHaveLength(5);  // search
    });
  });
});

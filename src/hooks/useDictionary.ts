import { useState, useEffect, useCallback, useMemo } from 'react';
import { tauriApi } from '../types/tauri';
import { DictionaryEntry, DictionaryEntryInput } from '../types/dictionary';

export interface UseDictionaryReturn {
  entries: DictionaryEntry[];
  filteredEntries: DictionaryEntry[];
  groupedEntries: Record<string, DictionaryEntry[]>;
  loading: boolean;
  searchQuery: string;
  showAddForm: boolean;
  editingEntry: DictionaryEntry | null;
  testText: string;
  testResult: string;
  showTestPanel: boolean;
  formData: DictionaryEntryInput;
  // Actions
  setSearchQuery: (query: string) => void;
  setShowAddForm: (show: boolean) => void;
  setTestText: (text: string) => void;
  setShowTestPanel: (show: boolean) => void;
  setFormData: (data: DictionaryEntryInput) => void;
  loadEntries: () => Promise<void>;
  handleSubmit: (e: React.FormEvent) => Promise<void>;
  handleEdit: (entry: DictionaryEntry) => void;
  handleDelete: (id: number) => Promise<void>;
  handleToggleEnabled: (entry: DictionaryEntry) => Promise<void>;
  handleTest: () => Promise<void>;
  resetForm: () => void;
}

const initialFormData: DictionaryEntryInput = {
  original_text: '',
  replacement_text: '',
  match_type: 'exact',
  is_case_sensitive: false,
  is_enabled: true,
  category: '',
  description: ''
};

export function useDictionary(): UseDictionaryReturn {
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<DictionaryEntry | null>(null);
  const [testText, setTestText] = useState('');
  const [testResult, setTestResult] = useState('');
  const [showTestPanel, setShowTestPanel] = useState(false);
  const [formData, setFormData] = useState<DictionaryEntryInput>(initialFormData);

  // Load entries from backend
  const loadEntries = useCallback(async () => {
    try {
      setLoading(true);
      const data = await tauriApi.getDictionaryEntries();
      setEntries(data);
    } catch (error) {
      console.error('Failed to load dictionary entries:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Filter entries based on search query
  const filteredEntries = useMemo(() => {
    if (!searchQuery) return entries;
    
    const query = searchQuery.toLowerCase();
    return entries.filter(entry => 
      entry.original_text.toLowerCase().includes(query) ||
      entry.replacement_text.toLowerCase().includes(query) ||
      (entry.category && entry.category.toLowerCase().includes(query)) ||
      (entry.description && entry.description.toLowerCase().includes(query))
    );
  }, [searchQuery, entries]);

  // Group entries by category
  const groupedEntries = useMemo(() => {
    return filteredEntries.reduce((acc, entry) => {
      const category = entry.category || 'Uncategorized';
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(entry);
      return acc;
    }, {} as Record<string, DictionaryEntry[]>);
  }, [filteredEntries]);

  // Reset form to initial state
  const resetForm = useCallback(() => {
    setFormData(initialFormData);
    setShowAddForm(false);
    setEditingEntry(null);
  }, []);

  // Handle form submission
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      if (editingEntry) {
        await tauriApi.updateDictionaryEntry({ id: editingEntry.id, updates: formData });
      } else {
        await tauriApi.saveDictionaryEntry({ entry: formData });
      }
      
      resetForm();
      await loadEntries();
    } catch (error) {
      console.error('Failed to save dictionary entry:', error);
    }
  }, [editingEntry, formData, resetForm, loadEntries]);

  // Handle edit action
  const handleEdit = useCallback((entry: DictionaryEntry) => {
    setEditingEntry(entry);
    setFormData({
      original_text: entry.original_text,
      replacement_text: entry.replacement_text,
      match_type: entry.match_type,
      is_case_sensitive: entry.is_case_sensitive,
      is_enabled: entry.is_enabled,
      category: entry.category || '',
      description: entry.description || ''
    });
    setShowAddForm(true);
  }, []);

  // Handle delete action
  const handleDelete = useCallback(async (id: number) => {
    if (confirm('Are you sure you want to delete this entry?')) {
      try {
        await tauriApi.deleteDictionaryEntry({ id });
        await loadEntries();
      } catch (error) {
        console.error('Failed to delete dictionary entry:', error);
      }
    }
  }, [loadEntries]);

  // Handle toggle enabled
  const handleToggleEnabled = useCallback(async (entry: DictionaryEntry) => {
    try {
      await tauriApi.updateDictionaryEntry({ 
        id: entry.id, 
        updates: {
          ...entry,
          is_enabled: !entry.is_enabled
        }
      });
      await loadEntries();
    } catch (error) {
      console.error('Failed to toggle dictionary entry:', error);
    }
  }, [loadEntries]);

  // Handle test replacement
  const handleTest = useCallback(async () => {
    if (!testText.trim()) return;
    
    try {
      const result = await tauriApi.testDictionaryReplacement({ text: testText });
      setTestResult(result.replaced_text);
    } catch (error) {
      console.error('Failed to test replacement:', error);
    }
  }, [testText]);

  // Load entries on mount
  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  return {
    entries,
    filteredEntries,
    groupedEntries,
    loading,
    searchQuery,
    showAddForm,
    editingEntry,
    testText,
    testResult,
    showTestPanel,
    formData,
    setSearchQuery,
    setShowAddForm,
    setTestText,
    setShowTestPanel,
    setFormData,
    loadEntries,
    handleSubmit,
    handleEdit,
    handleDelete,
    handleToggleEnabled,
    handleTest,
    resetForm
  };
}
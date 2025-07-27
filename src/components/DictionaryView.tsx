import React, { useState, useEffect } from 'react';
import { Book, Plus, Search, Trash2, Edit2, Eye, EyeOff, Hash, TestTube } from 'lucide-react';
import { tauriApi } from '../types/tauri';
import { DictionaryEntry, DictionaryEntryInput, MatchType } from '../types/dictionary';
import { Dropdown } from './Dropdown';
import './DictionaryView.css';

interface DictionaryViewProps {
  isExpanded: boolean;
  onToggleExpand: () => void;
}

export const DictionaryView: React.FC<DictionaryViewProps> = ({ isExpanded, onToggleExpand }) => {
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [filteredEntries, setFilteredEntries] = useState<DictionaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<DictionaryEntry | null>(null);
  const [testText, setTestText] = useState('');
  const [testResult, setTestResult] = useState<string>('');
  const [showTestPanel, setShowTestPanel] = useState(false);
  
  // Form state
  const [formData, setFormData] = useState<DictionaryEntryInput>({
    original_text: '',
    replacement_text: '',
    match_type: 'exact',
    is_case_sensitive: false,
    is_enabled: true,
    category: '',
    description: ''
  });

  useEffect(() => {
    if (isExpanded) {
      loadEntries();
    }
  }, [isExpanded]);

  useEffect(() => {
    // Filter entries based on search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      setFilteredEntries(entries.filter(entry => 
        entry.original_text.toLowerCase().includes(query) ||
        entry.replacement_text.toLowerCase().includes(query) ||
        (entry.category && entry.category.toLowerCase().includes(query)) ||
        (entry.description && entry.description.toLowerCase().includes(query))
      ));
    } else {
      setFilteredEntries(entries);
    }
  }, [searchQuery, entries]);

  const loadEntries = async () => {
    try {
      setLoading(true);
      const data = await tauriApi.getDictionaryEntries();
      setEntries(data);
      setFilteredEntries(data);
    } catch (error) {
      console.error('Failed to load dictionary entries:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      if (editingEntry) {
        // Update existing entry
        await tauriApi.updateDictionaryEntry({
          id: editingEntry.id,
          updates: formData
        });
      } else {
        // Create new entry
        await tauriApi.saveDictionaryEntry({ entry: formData });
      }
      
      // Reset form and reload entries
      setFormData({
        original_text: '',
        replacement_text: '',
        match_type: 'exact',
        is_case_sensitive: false,
        is_enabled: true,
        category: '',
        description: ''
      });
      setShowAddForm(false);
      setEditingEntry(null);
      loadEntries();
    } catch (error) {
      console.error('Failed to save dictionary entry:', error);
    }
  };

  const handleEdit = (entry: DictionaryEntry) => {
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
  };

  const handleDelete = async (id: number) => {
    if (confirm('Are you sure you want to delete this dictionary entry?')) {
      try {
        await tauriApi.deleteDictionaryEntry({ id });
        loadEntries();
      } catch (error) {
        console.error('Failed to delete dictionary entry:', error);
      }
    }
  };

  const handleToggleEnabled = async (entry: DictionaryEntry) => {
    try {
      await tauriApi.updateDictionaryEntry({
        id: entry.id,
        updates: { is_enabled: !entry.is_enabled }
      });
      loadEntries();
    } catch (error) {
      console.error('Failed to toggle dictionary entry:', error);
    }
  };

  const handleTest = async () => {
    if (!testText.trim()) return;
    
    try {
      const result = await tauriApi.testDictionaryReplacement({ text: testText });
      setTestResult(result.replaced_text);
    } catch (error) {
      console.error('Failed to test dictionary replacement:', error);
    }
  };

  const getMatchTypeLabel = (type: MatchType): string => {
    switch (type) {
      case 'exact': return 'Exact Match';
      case 'word': return 'Word Boundary';
      case 'phrase': return 'Phrase Match';
      case 'regex': return 'Regular Expression';
    }
  };

  // Group entries by category
  const groupedEntries = filteredEntries.reduce((acc, entry) => {
    const category = entry.category || 'Uncategorized';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(entry);
    return acc;
  }, {} as Record<string, DictionaryEntry[]>);

  return (
    <div className="settings-section dictionary-section">
      <div className="collapsible-section">
        <div className="collapsible-header-wrapper">
          <div 
            className="collapsible-header"
            onClick={onToggleExpand}
          >
            <div>
              <h3>
                <span className={`collapse-arrow ${isExpanded ? 'expanded' : ''}`}>
                  ▶
                </span>
                Text Dictionary <Book size={16} className="dictionary-icon" />
              </h3>
              <p className="collapsible-subtitle">
                Automatically replace text patterns in your transcripts
              </p>
            </div>
          </div>
          {isExpanded && (
            <div className="dictionary-header-actions">
              <button
                className="dictionary-action-button"
                onClick={() => setShowTestPanel(!showTestPanel)}
                title="Test replacements"
              >
                <TestTube size={14} />
                Test
              </button>
              <button
                className="dictionary-action-button"
                onClick={() => setShowAddForm(true)}
                title="Add new entry"
              >
                <Plus size={14} />
                Add Entry
              </button>
            </div>
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="collapsible-content">
          {loading ? (
            <div className="dictionary-loading">Loading dictionary entries...</div>
          ) : (
            <>
              {/* Search Bar */}
              <div className="dictionary-search">
                <Search size={16} />
                <input
                  type="text"
                  placeholder="Search dictionary entries..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              {/* Test Panel */}
              {showTestPanel && (
                <div className="dictionary-test-panel">
                  <h4>Test Dictionary Replacements</h4>
                  <div className="test-input-group">
                    <textarea
                      placeholder="Enter text to test replacements..."
                      value={testText}
                      onChange={(e) => setTestText(e.target.value)}
                      rows={3}
                    />
                    <button onClick={handleTest} className="test-button">
                      Test
                    </button>
                  </div>
                  {testResult && (
                    <div className="test-result">
                      <label>Result:</label>
                      <div className="test-result-text">{testResult}</div>
                    </div>
                  )}
                </div>
              )}

              {/* Add/Edit Form */}
              {showAddForm && (
                <form onSubmit={handleSubmit} className="dictionary-form">
                  <h4>{editingEntry ? 'Edit Entry' : 'Add New Entry'}</h4>
                  
                  <div className="form-row">
                    <div className="form-group">
                      <label>Original Text</label>
                      <input
                        type="text"
                        value={formData.original_text}
                        onChange={(e) => setFormData({ ...formData, original_text: e.target.value })}
                        placeholder="Text to replace"
                        required
                      />
                    </div>
                    
                    <div className="form-group">
                      <label>Replacement Text</label>
                      <input
                        type="text"
                        value={formData.replacement_text}
                        onChange={(e) => setFormData({ ...formData, replacement_text: e.target.value })}
                        placeholder="Replace with"
                        required
                      />
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label>Match Type</label>
                      <Dropdown
                        value={formData.match_type}
                        onChange={(value) => setFormData({ ...formData, match_type: value as MatchType })}
                        options={[
                          { value: 'exact', label: 'Exact Match' },
                          { value: 'word', label: 'Word Boundary' },
                          { value: 'phrase', label: 'Phrase Match' },
                          { value: 'regex', label: 'Regular Expression' }
                        ]}
                      />
                    </div>

                    <div className="form-group">
                      <label>Category</label>
                      <input
                        type="text"
                        value={formData.category || ''}
                        onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                        placeholder="e.g., Names, Technical Terms"
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Description</label>
                    <input
                      type="text"
                      value={formData.description || ''}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder="Optional description"
                    />
                  </div>

                  <div className="form-checkboxes">
                    <label>
                      <input
                        type="checkbox"
                        checked={formData.is_case_sensitive}
                        onChange={(e) => setFormData({ ...formData, is_case_sensitive: e.target.checked })}
                      />
                      Case Sensitive
                    </label>
                    
                    <label>
                      <input
                        type="checkbox"
                        checked={formData.is_enabled}
                        onChange={(e) => setFormData({ ...formData, is_enabled: e.target.checked })}
                      />
                      Enabled
                    </label>
                  </div>

                  <div className="form-actions">
                    <button type="submit" className="submit-button">
                      {editingEntry ? 'Update' : 'Add'} Entry
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddForm(false);
                        setEditingEntry(null);
                        setFormData({
                          original_text: '',
                          replacement_text: '',
                          match_type: 'exact',
                          is_case_sensitive: false,
                          is_enabled: true,
                          category: '',
                          description: ''
                        });
                      }}
                      className="cancel-button"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              {/* Entries List */}
              <div className="dictionary-entries">
                {Object.keys(groupedEntries).length === 0 ? (
                  <div className="dictionary-empty">
                    <p>No dictionary entries yet.</p>
                    <p>Add entries to automatically replace text in your transcripts.</p>
                  </div>
                ) : (
                  Object.entries(groupedEntries).map(([category, categoryEntries]) => (
                    <div key={category} className="dictionary-category">
                      <h5 className="category-title">{category}</h5>
                      <div className="entries-list">
                        {categoryEntries.map(entry => (
                          <div key={entry.id} className={`dictionary-entry ${!entry.is_enabled ? 'disabled' : ''}`}>
                            <div className="entry-header">
                              <div className="entry-text">
                                <span className="original-text">{entry.original_text}</span>
                                <span className="arrow">→</span>
                                <span className="replacement-text">{entry.replacement_text}</span>
                              </div>
                              <div className="entry-actions">
                                <button
                                  onClick={() => handleToggleEnabled(entry)}
                                  className="icon-button"
                                  title={entry.is_enabled ? 'Disable' : 'Enable'}
                                >
                                  {entry.is_enabled ? <Eye size={14} /> : <EyeOff size={14} />}
                                </button>
                                <button
                                  onClick={() => handleEdit(entry)}
                                  className="icon-button"
                                  title="Edit"
                                >
                                  <Edit2 size={14} />
                                </button>
                                <button
                                  onClick={() => handleDelete(entry.id)}
                                  className="icon-button delete"
                                  title="Delete"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                            <div className="entry-details">
                              <span className="match-type">{getMatchTypeLabel(entry.match_type)}</span>
                              {entry.is_case_sensitive && <span className="case-sensitive">Case Sensitive</span>}
                              {entry.usage_count > 0 && (
                                <span className="usage-count">
                                  <Hash size={12} />
                                  {entry.usage_count} uses
                                </span>
                              )}
                            </div>
                            {entry.description && (
                              <div className="entry-description">{entry.description}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Future: Import/Export Actions */}
              <div className="dictionary-footer">
                <p className="footer-hint">
                  Dictionary replacements are applied automatically to new transcripts.
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
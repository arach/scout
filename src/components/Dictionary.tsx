import React, { useState, useEffect } from 'react';
import { Plus, Search, Trash2, Edit2, Eye, EyeOff, Hash } from 'lucide-react';
import { tauriApi } from '../types/tauri';
import { DictionaryEntry, DictionaryEntryInput, MatchType } from '../types/dictionary';
import { Dropdown } from './Dropdown';
import './DictionaryView.css';
import '../styles/grid-system.css';

const getMatchTypeLabel = (type: MatchType): string => {
  switch (type) {
    case 'exact': return 'Exact';
    case 'word': return 'Word';
    case 'phrase': return 'Phrase';
    case 'regex': return 'Regex';
    default: return type;
  }
};

const Dictionary: React.FC = () => {
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [filteredEntries, setFilteredEntries] = useState<DictionaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<DictionaryEntry | null>(null);
  const [saving, setSaving] = useState(false);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  
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

  const loadEntries = async () => {
    try {
      setLoading(true);
      const data = await tauriApi.getDictionaryEntries(false);
      setEntries(data);
      setFilteredEntries(data);
    } catch (error) {
      console.error('Failed to load dictionary entries:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEntries();
  }, []);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    
    try {
      if (editingEntry) {
        await tauriApi.updateDictionaryEntry(editingEntry.id, formData);
        showNotification('Entry updated successfully', 'success');
      } else {
        await tauriApi.saveDictionaryEntry(formData);
        showNotification('Entry added successfully', 'success');
      }
      
      // Reset form
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
      
      // Reload entries
      await loadEntries();
    } catch (error) {
      console.error('Failed to save dictionary entry:', error);
      showNotification('Failed to save entry', 'error');
    } finally {
      setSaving(false);
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
    if (confirm('Are you sure you want to delete this entry?')) {
      try {
        await tauriApi.deleteDictionaryEntry(id);
        await loadEntries();
        showNotification('Entry deleted successfully', 'success');
      } catch (error) {
        console.error('Failed to delete dictionary entry:', error);
        showNotification('Failed to delete entry', 'error');
      }
    }
  };

  const handleToggleEnabled = async (entry: DictionaryEntry) => {
    try {
      await tauriApi.updateDictionaryEntry(entry.id, {
        is_enabled: !entry.is_enabled
      });
      await loadEntries();
      showNotification(
        entry.is_enabled ? 'Entry disabled' : 'Entry enabled',
        'success'
      );
    } catch (error) {
      console.error('Failed to toggle dictionary entry:', error);
      showNotification('Failed to update entry', 'error');
    }
  };

  const showNotification = (message: string, type: 'success' | 'error') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
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
    <div className="grid-container">
      <div className="grid-content">

      {/* Notification */}
      {notification && (
        <div className={`notification notification-${notification.type}`}>
          {notification.message}
        </div>
      )}

      {/* Show search only when there are entries */}
      {entries.length > 10 && (
        <div className="dictionary-controls">
          <div className="search-container">
            <Search size={16} className="search-icon" />
            <input
              type="text"
              placeholder="Search dictionary entries..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
          </div>
        </div>
      )}

      {loading ? (
        <div className="dictionary-loading">Loading dictionary entries...</div>
      ) : (
        <>

          {/* Add/Edit Form */}
          {showAddForm && (
            <form onSubmit={handleSubmit} className={`dictionary-form ${saving ? 'saving' : ''}`}>
              <h4>{editingEntry ? 'Edit Entry' : 'Add New Entry'}</h4>
              
              <div className="form-row">
                <div className="form-group">
                  <label data-required="*">Original Text</label>
                  <input
                    type="text"
                    value={formData.original_text}
                    onChange={(e) => setFormData(prev => ({ ...prev, original_text: e.target.value }))}
                    required
                    placeholder="e.g., api"
                    autoFocus
                  />
                </div>
                <div className="form-group">
                  <label data-required="*">Replacement Text</label>
                  <input
                    type="text"
                    value={formData.replacement_text}
                    onChange={(e) => setFormData(prev => ({ ...prev, replacement_text: e.target.value }))}
                    required
                    placeholder="e.g., API"
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Match Type</label>
                  <Dropdown
                    options={[
                      { value: 'exact', label: 'Exact Match' },
                      { value: 'word', label: 'Word Boundary' },
                      { value: 'phrase', label: 'Phrase' },
                      { value: 'regex', label: 'Regular Expression' }
                    ]}
                    value={formData.match_type}
                    onChange={(value) => setFormData(prev => ({ ...prev, match_type: value as MatchType }))}
                  />
                </div>
                <div className="form-group">
                  <label>Category</label>
                  <input
                    type="text"
                    value={formData.category || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))}
                    placeholder="e.g., Technical"
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Description</label>
                <input
                  type="text"
                  value={formData.description || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Optional description"
                />
              </div>

              <div className="form-checkboxes">
                <div>
                  <input
                    type="checkbox"
                    id="case-sensitive"
                    checked={formData.is_case_sensitive}
                    onChange={(e) => setFormData(prev => ({ ...prev, is_case_sensitive: e.target.checked }))}
                  />
                  <label htmlFor="case-sensitive">Case Sensitive</label>
                </div>
                <div>
                  <input
                    type="checkbox"
                    id="enabled"
                    checked={formData.is_enabled}
                    onChange={(e) => setFormData(prev => ({ ...prev, is_enabled: e.target.checked }))}
                  />
                  <label htmlFor="enabled">Enabled</label>
                </div>
              </div>

              <div className="form-actions">
                <button 
                  type="submit" 
                  className="submit-button"
                  disabled={saving}
                >
                  {saving ? 'Saving...' : (editingEntry ? 'Update' : 'Add')}
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
                  disabled={saving}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {/* Entries List */}
          <div className="dictionary-entries">
            {Object.keys(groupedEntries).length === 0 ? (
              <div className="dictionary-zero-state">
                <div className="zero-state-content">
                  <h2>What is the Dictionary?</h2>
                  <p className="zero-state-description">
                    The dictionary automatically corrects common misspellings, expands abbreviations, 
                    and fixes technical terms in your transcriptions. It works silently in the background 
                    to make your transcripts more accurate.
                  </p>
                  
                  <div className="dictionary-examples">
                    <h3>Examples of what you can do:</h3>
                    <div className="example-list">
                      <div className="example-item">
                        <span className="example-original">api</span>
                        <span className="example-arrow">→</span>
                        <span className="example-replacement">API</span>
                      </div>
                      <div className="example-item">
                        <span className="example-original">github</span>
                        <span className="example-arrow">→</span>
                        <span className="example-replacement">GitHub</span>
                      </div>
                      <div className="example-item">
                        <span className="example-original">javascript</span>
                        <span className="example-arrow">→</span>
                        <span className="example-replacement">JavaScript</span>
                      </div>
                    </div>
                  </div>
                  
                  <button
                    className="zero-state-cta"
                    onClick={() => {
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
                      setShowAddForm(true);
                    }}
                  >
                    <Plus size={20} />
                    <span>Add Your First Entry</span>
                  </button>
                </div>
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
                          {entry.is_case_sensitive && <span className="case-sensitive">Case</span>}
                          {entry.usage_count > 0 && (
                            <span className="usage-count">
                              <Hash size={12} />
                              {entry.usage_count} {entry.usage_count === 1 ? 'use' : 'uses'}
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
            
            {/* Add entry button when there are existing entries */}
            {Object.keys(groupedEntries).length > 0 && (
              <div className="dictionary-add-section">
                <button
                  className="inline-add-button"
                  onClick={() => {
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
                    setShowAddForm(true);
                  }}
                >
                  <Plus size={16} />
                  <span>Add Entry</span>
                </button>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="dictionary-footer">
            <p className="footer-hint">
              Dictionary replacements are applied automatically to new transcripts
            </p>
          </div>
        </>
      )}
      </div>
    </div>
  );
};

export default Dictionary;
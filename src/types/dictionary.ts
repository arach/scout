export type MatchType = 'exact' | 'word' | 'phrase' | 'regex';

export interface DictionaryEntry {
  id: number;
  original_text: string;
  replacement_text: string;
  match_type: MatchType;
  is_case_sensitive: boolean;
  is_enabled: boolean;
  category?: string;
  description?: string;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

export interface DictionaryMatch {
  id: number;
  transcript_id: number;
  dictionary_entry_id: number;
  matched_text: string;
  replacement_text: string;
  position_start: number;
  position_end: number;
  created_at: string;
}

export interface DictionaryTestResult {
  original_text: string;
  replaced_text: string;
  matches: Array<{
    entry: DictionaryEntry;
    matched_text: string;
    position_start: number;
    position_end: number;
  }>;
}

export interface DictionaryEntryInput {
  original_text: string;
  replacement_text: string;
  match_type: MatchType;
  is_case_sensitive?: boolean;
  is_enabled?: boolean;
  category?: string;
  description?: string;
}

export interface DictionaryEntryUpdate {
  original_text?: string;
  replacement_text?: string;
  match_type?: MatchType;
  is_case_sensitive?: boolean;
  is_enabled?: boolean;
  category?: string;
  description?: string;
}
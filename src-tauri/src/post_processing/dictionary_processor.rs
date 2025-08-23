use crate::db::{Database, DictionaryEntry, DictionaryMatch};
use crate::logger::{debug, error, info, Component};
use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::HashMap;
use std::sync::Arc;

/// Cache compiled regex patterns for performance
static REGEX_CACHE: Lazy<Arc<tokio::sync::Mutex<HashMap<String, Regex>>>> =
    Lazy::new(|| Arc::new(tokio::sync::Mutex::new(HashMap::new())));

/// Dictionary processor for applying custom replacements to transcripts
pub struct DictionaryProcessor {
    database: Arc<Database>,
}

impl DictionaryProcessor {
    pub fn new(database: Arc<Database>) -> Self {
        Self { database }
    }

    /// Process a transcript with dictionary replacements
    /// Returns (processed_text, matches_found)
    pub async fn process_transcript(
        &self,
        transcript: &str,
        transcript_id: Option<i64>,
    ) -> Result<(String, Vec<DictionaryMatch>), String> {
        // Get enabled dictionary entries
        let entries = self.database.get_enabled_dictionary_entries().await?;

        if entries.is_empty() {
            debug(Component::Processing, "No dictionary entries enabled");
            return Ok((transcript.to_string(), vec![]));
        }

        info(
            Component::Processing,
            &format!(
                "Processing transcript with {} dictionary entries",
                entries.len()
            ),
        );

        let mut processed_text = transcript.to_string();
        let mut all_matches = Vec::new();
        let mut offset_adjustment = 0i64;

        // Sort entries by position to handle overlapping replacements correctly
        // Process longer matches first to avoid partial replacements
        let mut sorted_entries = entries;
        sorted_entries.sort_by(|a, b| b.original_text.len().cmp(&a.original_text.len()));

        for entry in sorted_entries {
            match self
                .apply_dictionary_entry(&processed_text, &entry, offset_adjustment)
                .await?
            {
                Some((new_text, mut matches)) => {
                    // Calculate the length difference for offset adjustment
                    let length_diff = new_text.len() as i64 - processed_text.len() as i64;
                    offset_adjustment += length_diff;

                    processed_text = new_text;
                    all_matches.append(&mut matches);
                }
                None => continue,
            }
        }

        // Save matches to database if transcript_id is provided
        if let Some(id) = transcript_id {
            if !all_matches.is_empty() {
                self.database
                    .save_dictionary_matches(id, &all_matches)
                    .await?;
            }
        }

        info(
            Component::Processing,
            &format!(
                "Dictionary processing complete: {} replacements made",
                all_matches.len()
            ),
        );

        Ok((processed_text, all_matches))
    }

    /// Apply a single dictionary entry to the text
    async fn apply_dictionary_entry(
        &self,
        text: &str,
        entry: &DictionaryEntry,
        offset_adjustment: i64,
    ) -> Result<Option<(String, Vec<DictionaryMatch>)>, String> {
        let mut matches = Vec::new();
        let new_text = match entry.match_type.as_str() {
            "exact" => self.apply_exact_match(text, entry, &mut matches)?,
            "word" => self.apply_word_match(text, entry, &mut matches)?,
            "phrase" => self.apply_phrase_match(text, entry, &mut matches)?,
            "regex" => self.apply_regex_match(text, entry, &mut matches).await?,
            _ => {
                error(
                    Component::Processing,
                    &format!("Unknown match type: {}", entry.match_type),
                );
                return Ok(None);
            }
        };

        if matches.is_empty() {
            return Ok(None);
        }

        // Adjust match positions based on previous replacements
        for m in &mut matches {
            m.position_start = (m.position_start as i64 + offset_adjustment) as usize;
            m.position_end = (m.position_end as i64 + offset_adjustment) as usize;
        }

        Ok(Some((new_text, matches)))
    }

    /// Apply exact string matching (case-sensitive or insensitive)
    fn apply_exact_match(
        &self,
        text: &str,
        entry: &DictionaryEntry,
        matches: &mut Vec<DictionaryMatch>,
    ) -> Result<String, String> {
        let mut result = String::with_capacity(text.len());
        let mut last_end = 0;

        let search_text = if entry.is_case_sensitive {
            text.to_string()
        } else {
            text.to_lowercase()
        };

        let search_pattern = if entry.is_case_sensitive {
            entry.original_text.clone()
        } else {
            entry.original_text.to_lowercase()
        };

        let mut search_start = 0;
        while let Some(pos) = search_text[search_start..].find(&search_pattern) {
            let actual_pos = search_start + pos;

            // Add text before the match
            result.push_str(&text[last_end..actual_pos]);

            // Add the replacement
            result.push_str(&entry.replacement_text);

            // Record the match
            matches.push(DictionaryMatch {
                entry_id: entry.id,
                matched_text: text[actual_pos..actual_pos + entry.original_text.len()].to_string(),
                replaced_with: entry.replacement_text.clone(),
                position_start: actual_pos,
                position_end: actual_pos + entry.original_text.len(),
            });

            last_end = actual_pos + entry.original_text.len();
            search_start = last_end;
        }

        // Add remaining text
        result.push_str(&text[last_end..]);

        Ok(result)
    }

    /// Apply word boundary matching
    fn apply_word_match(
        &self,
        text: &str,
        entry: &DictionaryEntry,
        matches: &mut Vec<DictionaryMatch>,
    ) -> Result<String, String> {
        // Build regex pattern with word boundaries
        let pattern = if entry.is_case_sensitive {
            format!(r"\b{}\b", regex::escape(&entry.original_text))
        } else {
            format!(r"(?i)\b{}\b", regex::escape(&entry.original_text))
        };

        let regex = Regex::new(&pattern)
            .map_err(|e| format!("Failed to compile word match regex: {}", e))?;

        let mut result = String::with_capacity(text.len());
        let mut last_end = 0;

        for mat in regex.find_iter(text) {
            // Add text before the match
            result.push_str(&text[last_end..mat.start()]);

            // Add the replacement
            result.push_str(&entry.replacement_text);

            // Record the match
            matches.push(DictionaryMatch {
                entry_id: entry.id,
                matched_text: mat.as_str().to_string(),
                replaced_with: entry.replacement_text.clone(),
                position_start: mat.start(),
                position_end: mat.end(),
            });

            last_end = mat.end();
        }

        // Add remaining text
        result.push_str(&text[last_end..]);

        Ok(result)
    }

    /// Apply phrase matching (considers surrounding context)
    fn apply_phrase_match(
        &self,
        text: &str,
        entry: &DictionaryEntry,
        matches: &mut Vec<DictionaryMatch>,
    ) -> Result<String, String> {
        // For phrases, we want to match the exact phrase but be more flexible with surrounding punctuation
        let pattern = if entry.is_case_sensitive {
            format!(
                r"(?:^|[^a-zA-Z0-9])({})(?:[^a-zA-Z0-9]|$)",
                regex::escape(&entry.original_text)
            )
        } else {
            format!(
                r"(?i)(?:^|[^a-zA-Z0-9])({})(?:[^a-zA-Z0-9]|$)",
                regex::escape(&entry.original_text)
            )
        };

        let regex = Regex::new(&pattern)
            .map_err(|e| format!("Failed to compile phrase match regex: {}", e))?;

        let mut result = String::with_capacity(text.len());
        let mut last_end = 0;

        for mat in regex.captures_iter(text) {
            let full_match = mat.get(0).unwrap();
            let phrase_match = mat.get(1).unwrap();

            // Add text before the match (including any prefix characters)
            let prefix_len = phrase_match.start() - full_match.start();
            result.push_str(&text[last_end..full_match.start() + prefix_len]);

            // Add the replacement
            result.push_str(&entry.replacement_text);

            // Add any suffix characters
            let suffix_start = phrase_match.end();
            let suffix_end = full_match.end();
            result.push_str(&text[suffix_start..suffix_end]);

            // Record the match
            matches.push(DictionaryMatch {
                entry_id: entry.id,
                matched_text: phrase_match.as_str().to_string(),
                replaced_with: entry.replacement_text.clone(),
                position_start: phrase_match.start(),
                position_end: phrase_match.end(),
            });

            last_end = full_match.end();
        }

        // Add remaining text
        result.push_str(&text[last_end..]);

        Ok(result)
    }

    /// Apply regex pattern matching
    async fn apply_regex_match(
        &self,
        text: &str,
        entry: &DictionaryEntry,
        matches: &mut Vec<DictionaryMatch>,
    ) -> Result<String, String> {
        // Get or compile regex pattern
        let mut cache = REGEX_CACHE.lock().await;
        let regex = match cache.get(&entry.original_text) {
            Some(r) => r.clone(),
            None => {
                let pattern = if entry.is_case_sensitive {
                    entry.original_text.clone()
                } else {
                    format!("(?i){}", entry.original_text)
                };

                let regex = Regex::new(&pattern).map_err(|e| {
                    format!(
                        "Failed to compile regex pattern '{}': {}",
                        entry.original_text, e
                    )
                })?;

                cache.insert(entry.original_text.clone(), regex.clone());
                regex
            }
        };
        drop(cache);

        let mut result = String::with_capacity(text.len());
        let mut last_end = 0;

        for mat in regex.find_iter(text) {
            // Add text before the match
            result.push_str(&text[last_end..mat.start()]);

            // Add the replacement (could support capture groups in the future)
            result.push_str(&entry.replacement_text);

            // Record the match
            matches.push(DictionaryMatch {
                entry_id: entry.id,
                matched_text: mat.as_str().to_string(),
                replaced_with: entry.replacement_text.clone(),
                position_start: mat.start(),
                position_end: mat.end(),
            });

            last_end = mat.end();
        }

        // Add remaining text
        result.push_str(&text[last_end..]);

        Ok(result)
    }

    /// Apply phonetic matching using soundex or similar algorithm
    /// This is a placeholder for future implementation
    pub async fn apply_phonetic_corrections(
        &self,
        text: &str,
        _entries: &[DictionaryEntry],
    ) -> Result<String, String> {
        // TODO: Implement phonetic matching algorithm
        // This could use soundex, metaphone, or a custom algorithm
        // For now, return the original text
        Ok(text.to_string())
    }
}

#[cfg(test)]
mod tests {
    // use super::*;

    #[tokio::test]
    async fn test_exact_match() {
        // Test implementation would go here
    }

    #[tokio::test]
    async fn test_word_match() {
        // Test implementation would go here
    }

    #[tokio::test]
    async fn test_phrase_match() {
        // Test implementation would go here
    }

    #[tokio::test]
    async fn test_regex_match() {
        // Test implementation would go here
    }
}

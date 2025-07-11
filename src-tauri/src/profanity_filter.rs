use crate::logger::{info, warn, Component};
use std::collections::HashSet;

/// Profanity filtering system for transcription post-processing
pub struct ProfanityFilter {
    /// Common profanity words that Whisper tends to hallucinate
    hallucination_words: HashSet<String>,
    /// Known Whisper hallucination phrases
    hallucination_phrases: HashSet<String>,
}

/// Result of profanity filtering
#[derive(Debug, Clone)]
pub struct FilterResult {
    /// The filtered transcript
    pub filtered_text: String,
    /// Whether any profanity was detected
    pub profanity_detected: bool,
    /// Whether the profanity was likely a hallucination
    pub likely_hallucination: bool,
    /// Original words that were filtered/flagged
    pub flagged_words: Vec<String>,
    /// Analysis logs describing the filter's decisions
    pub analysis_logs: Vec<String>,
}

impl ProfanityFilter {
    pub fn new() -> Self {
        let mut hallucination_words = HashSet::new();
        
        // Common profanity words that Whisper frequently hallucinates
        // These are words that often appear in hallucinations, especially in short recordings
        hallucination_words.insert("fuck".to_string());
        hallucination_words.insert("fucking".to_string());
        hallucination_words.insert("shit".to_string());
        hallucination_words.insert("damn".to_string());
        hallucination_words.insert("hell".to_string());
        hallucination_words.insert("ass".to_string());
        hallucination_words.insert("bitch".to_string());
        hallucination_words.insert("bastard".to_string());
        
        let mut hallucination_phrases = HashSet::new();
        
        // Known Whisper hallucination phrases that commonly appear
        hallucination_phrases.insert("oh fuck".to_string());
        hallucination_phrases.insert("oh shit".to_string());
        hallucination_phrases.insert("oh my god".to_string());
        hallucination_phrases.insert("oh my gosh".to_string());
        hallucination_phrases.insert("what the hell".to_string());
        hallucination_phrases.insert("what the fuck".to_string());
        
        Self {
            hallucination_words,
            hallucination_phrases,
        }
    }
    
    /// Filter transcript for profanity, with smart hallucination detection
    pub fn filter_transcript(&self, text: &str, recording_duration_ms: Option<i32>) -> FilterResult {
        let original_text = text.to_string();
        let lower_text = text.to_lowercase();
        
        // Check for known hallucination phrases first
        let mut likely_hallucination = false;
        let mut flagged_words = Vec::new();
        let mut profanity_detected = false;
        let mut analysis_logs = Vec::new();
        
        for phrase in &self.hallucination_phrases {
            if lower_text.contains(phrase) {
                let log_msg = format!("🚫 Detected hallucination phrase: '{}'", phrase);
                info(Component::Processing, &log_msg);
                analysis_logs.push(log_msg);
                likely_hallucination = true;
                profanity_detected = true;
                flagged_words.push(phrase.clone());
            }
        }
        
        // Check for individual profanity words
        let words: Vec<&str> = text.split_whitespace().collect();
        
        for word in &words {
            let clean_word = word.to_lowercase()
                .trim_matches(|c: char| !c.is_alphabetic())
                .to_string();
                
            if self.hallucination_words.contains(&clean_word) {
                profanity_detected = true;
                flagged_words.push(clean_word.clone());
                
                // Heuristics to determine if it's likely a hallucination
                if !likely_hallucination {
                    let (is_hallucination, mut logs) = self.is_likely_hallucination(&original_text, &clean_word, recording_duration_ms);
                    likely_hallucination = is_hallucination;
                    analysis_logs.append(&mut logs);
                }
            }
        }
        
        // Filter the text based on our analysis
        let filtered_text = if likely_hallucination {
            self.remove_profanity(&original_text)
        } else {
            // If it's likely intentional profanity, keep it
            original_text.clone()
        };
        
        FilterResult {
            filtered_text,
            profanity_detected,
            likely_hallucination,
            flagged_words,
            analysis_logs,
        }
    }
    
    /// Determine if profanity is likely a hallucination based on context
    fn is_likely_hallucination(&self, text: &str, profanity_word: &str, recording_duration_ms: Option<i32>) -> (bool, Vec<String>) {
        let text_lower = text.to_lowercase();
        let word_count = text.split_whitespace().count();
        let mut analysis_logs = Vec::new();
        
        // Heuristic 1: Very short recordings with profanity are often hallucinations
        if let Some(duration) = recording_duration_ms {
            if duration < 2000 && word_count <= 3 {
                let log_msg = format!("🚫 Short recording ({} words, {}ms) with profanity '{}' - likely hallucination", word_count, duration, profanity_word);
                warn(Component::Processing, &log_msg);
                analysis_logs.push(log_msg);
                return (true, analysis_logs);
            }
        }
        
        // Heuristic 2: Profanity at the very beginning of transcripts is often hallucination
        if text_lower.starts_with(profanity_word) || text_lower.starts_with(&format!("oh {}", profanity_word)) {
            let log_msg = format!("🚫 Profanity '{}' at start of transcript - likely hallucination", profanity_word);
            warn(Component::Processing, &log_msg);
            analysis_logs.push(log_msg);
            return (true, analysis_logs);
        }
        
        // Heuristic 3: Single profanity word with no context
        if word_count == 1 && self.hallucination_words.contains(profanity_word) {
            let log_msg = format!("🚫 Single profanity word '{}' - likely hallucination", profanity_word);
            warn(Component::Processing, &log_msg);
            analysis_logs.push(log_msg);
            return (true, analysis_logs);
        }
        
        // Heuristic 4: Common hallucination patterns
        if text_lower.contains("oh, fuck") || text_lower.contains("oh fuck") || 
           text_lower.contains("oh, shit") || text_lower.contains("oh shit") {
            let log_msg = format!("🚫 Common hallucination pattern detected with '{}' - likely hallucination", profanity_word);
            warn(Component::Processing, &log_msg);
            analysis_logs.push(log_msg);
            return (true, analysis_logs);
        }
        
        // If none of the hallucination heuristics match, it's likely intentional
        let log_msg = format!("✅ Profanity '{}' appears intentional based on context", profanity_word);
        info(Component::Processing, &log_msg);
        analysis_logs.push(log_msg);
        (false, analysis_logs)
    }
    
    /// Remove profanity from text while preserving sentence structure
    fn remove_profanity(&self, text: &str) -> String {
        let mut result = text.to_string();
        
        // Remove known hallucination phrases completely
        for phrase in &self.hallucination_phrases {
            let phrase_variations = vec![
                phrase.clone(),
                phrase.to_uppercase(),
                self.capitalize_first_letter(phrase),
            ];
            
            for variation in phrase_variations {
                // Simple replacement - remove the phrase and clean up
                result = result.replace(&variation, "");
                // Also handle common patterns with punctuation
                result = result.replace(&format!("{}.", &variation), "");
                result = result.replace(&format!("{}!", &variation), "");
                result = result.replace(&format!("{}?", &variation), "");
            }
        }
        
        // Remove individual profanity words
        let words: Vec<&str> = result.split_whitespace().collect();
        let mut filtered_words = Vec::new();
        
        for word in words {
            let clean_word = word.to_lowercase()
                .trim_matches(|c: char| !c.is_alphabetic())
                .to_string();
                
            if !self.hallucination_words.contains(&clean_word) {
                // Keep non-profanity words
                filtered_words.push(word.to_string());
            }
            // Skip profanity words completely (don't add anything)
        }
        
        let filtered_result = filtered_words.join(" ");
        
        // Clean up multiple spaces and stray punctuation
        let cleaned = filtered_result
            .replace("  ", " ")
            .trim()
            .to_string();
            
        // Remove stray punctuation at the start or standalone punctuation
        let cleaned = cleaned
            .trim_matches(|c: char| c == ',' || c == '.' || c == '!' || c == '?' || c.is_whitespace())
            .to_string();
            
        // Fix sentence structure - if we end with incomplete punctuation, clean it up
        let final_result = if cleaned.is_empty() {
            String::new()
        } else if cleaned.ends_with("?") || cleaned.ends_with(".") || cleaned.ends_with("!") {
            cleaned
        } else {
            // Add period if we have content but no ending punctuation
            format!("{}.", cleaned)
        };
        
        final_result
    }
    
    /// Capitalize the first letter of a string
    fn capitalize_first_letter(&self, s: &str) -> String {
        let mut chars = s.chars();
        match chars.next() {
            None => String::new(),
            Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_hallucination_detection() {
        let filter = ProfanityFilter::new();
        
        // Test short recording with profanity (likely hallucination)
        let result = filter.filter_transcript("Oh fuck", Some(1000));
        assert!(result.likely_hallucination);
        assert!(result.profanity_detected);
        assert_eq!(result.filtered_text, "");
        assert!(!result.analysis_logs.is_empty());
        
        // Test longer recording with context (likely intentional)
        let result = filter.filter_transcript("I can't believe I forgot my fucking keys again", Some(5000));
        assert!(!result.likely_hallucination);
        assert!(result.profanity_detected);
        assert_eq!(result.filtered_text, "I can't believe I forgot my fucking keys again");
        assert!(!result.analysis_logs.is_empty());
    }
    
    #[test]
    fn test_phrase_filtering() {
        let filter = ProfanityFilter::new();
        
        let result = filter.filter_transcript("Oh my god, what the hell", Some(2000));
        assert!(result.likely_hallucination);
        assert_eq!(result.filtered_text, "");
        assert!(!result.analysis_logs.is_empty());
    }
}
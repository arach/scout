use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

/// Mock transcriber for testing that provides predictable outputs
pub struct MockTranscriber {
    /// Mock responses based on audio file characteristics
    responses: Arc<StdMutex<HashMap<String, String>>>,
    /// Processing delay to simulate transcription time
    processing_delay: Duration,
    /// Counter to track how many times transcribe was called
    call_count: Arc<StdMutex<usize>>,
    /// Should fail on next transcription (for error testing)
    should_fail: Arc<StdMutex<bool>>,
    /// Track which files were transcribed
    transcribed_files: Arc<StdMutex<Vec<PathBuf>>>,
}

impl MockTranscriber {
    pub fn new() -> Self {
        let mut responses = HashMap::new();
        
        // Default responses based on common test patterns
        responses.insert("silence".to_string(), "".to_string());
        responses.insert("short".to_string(), "Hello world".to_string());
        responses.insert("medium".to_string(), "This is a medium length transcription for testing purposes".to_string());
        responses.insert("long".to_string(), "This is a much longer transcription that spans multiple sentences and contains various words that would typically be found in a real transcription result from a whisper model during normal operation".to_string());
        responses.insert("noise".to_string(), "[NOISE]".to_string());
        responses.insert("error".to_string(), "".to_string());
        
        Self {
            responses: Arc::new(StdMutex::new(responses)),
            processing_delay: Duration::from_millis(10), // Fast by default for tests
            call_count: Arc::new(StdMutex::new(0)),
            should_fail: Arc::new(StdMutex::new(false)),
            transcribed_files: Arc::new(StdMutex::new(Vec::new())),
        }
    }

    /// Create a mock transcriber that simulates realistic processing delays
    pub fn with_realistic_delays() -> Self {
        let mut mock = Self::new();
        mock.processing_delay = Duration::from_millis(150); // Simulate realistic transcription time
        mock
    }

    /// Set a custom response for a specific audio pattern
    pub fn set_response(&self, pattern: &str, response: &str) {
        let mut responses = self.responses.lock().unwrap();
        responses.insert(pattern.to_string(), response.to_string());
    }

    /// Set the processing delay for transcription
    pub fn set_processing_delay(&mut self, delay: Duration) {
        self.processing_delay = delay;
    }

    /// Make the next transcription call fail
    pub fn fail_next_transcription(&self) {
        let mut should_fail = self.should_fail.lock().unwrap();
        *should_fail = true;
    }

    /// Get the number of times transcribe was called
    pub fn get_call_count(&self) -> usize {
        *self.call_count.lock().unwrap()
    }

    /// Reset the call count
    pub fn reset_call_count(&self) {
        let mut count = self.call_count.lock().unwrap();
        *count = 0;
    }

    /// Get list of files that were transcribed
    pub fn get_transcribed_files(&self) -> Vec<PathBuf> {
        self.transcribed_files.lock().unwrap().clone()
    }

    /// Clear the transcribed files list
    pub fn clear_transcribed_files(&self) {
        self.transcribed_files.lock().unwrap().clear();
    }

    /// Create a wrapped Arc<Mutex<MockTranscriber>> for use in strategies
    pub fn into_arc_mutex(self) -> Arc<Mutex<MockTranscriber>> {
        Arc::new(Mutex::new(self))
    }

    /// Transcribe a file and return mock result based on file characteristics
    pub fn transcribe_file(&self, audio_path: &Path) -> Result<String, String> {
        // Simulate processing delay
        std::thread::sleep(self.processing_delay);
        
        // Increment call count
        {
            let mut count = self.call_count.lock().unwrap();
            *count += 1;
        }

        // Track transcribed file
        {
            let mut files = self.transcribed_files.lock().unwrap();
            files.push(audio_path.to_path_buf());
        }

        // Check if we should fail
        {
            let mut should_fail = self.should_fail.lock().unwrap();
            if *should_fail {
                *should_fail = false; // Reset for next call
                return Err("Mock transcription failure".to_string());
            }
        }

        // Determine response based on file characteristics
        let pattern = self.determine_pattern(audio_path);
        let responses = self.responses.lock().unwrap();
        
        match responses.get(&pattern) {
            Some(response) => Ok(response.clone()),
            None => Ok(format!("Transcribed content from {}", audio_path.display())),
        }
    }

    /// Transcribe method that mirrors the real Transcriber interface
    pub fn transcribe(&self, audio_path: &Path) -> Result<String, String> {
        self.transcribe_file(audio_path)
    }

    /// Determine mock response pattern based on file characteristics
    fn determine_pattern(&self, audio_path: &Path) -> String {
        let filename = audio_path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_lowercase();

        // Pattern matching based on filename
        if filename.contains("silence") || filename.contains("empty") {
            "silence".to_string()
        } else if filename.contains("noise") {
            "noise".to_string()
        } else if filename.contains("error") {
            "error".to_string()
        } else if filename.contains("long") || filename.len() > 30 {
            "long".to_string()
        } else if filename.contains("medium") || filename.len() > 15 {
            "medium".to_string()
        } else {
            "short".to_string()
        }
    }
}

impl Default for MockTranscriber {
    fn default() -> Self {
        Self::new()
    }
}

/// Mock Transcriber that implements the same interface as the real Transcriber
/// but with predictable behavior for testing
pub struct MockTranscriberWrapper {
    inner: MockTranscriber,
}

impl MockTranscriberWrapper {
    pub fn new() -> Self {
        Self {
            inner: MockTranscriber::new(),
        }
    }

    pub fn with_realistic_delays() -> Self {
        Self {
            inner: MockTranscriber::with_realistic_delays(),
        }
    }

    pub fn set_response(&self, pattern: &str, response: &str) {
        self.inner.set_response(pattern, response);
    }

    pub fn fail_next_transcription(&self) {
        self.inner.fail_next_transcription();
    }

    pub fn get_call_count(&self) -> usize {
        self.inner.get_call_count()
    }

    pub fn reset_call_count(&self) {
        self.inner.reset_call_count();
    }
    
    pub fn get_transcribed_files(&self) -> Vec<PathBuf> {
        self.inner.get_transcribed_files()
    }

    pub fn transcribe_file(&self, audio_path: &Path) -> Result<String, String> {
        self.inner.transcribe_file(audio_path)
    }

    pub fn transcribe(&self, audio_path: &Path) -> Result<String, String> {
        self.inner.transcribe(audio_path)
    }
}

impl Default for MockTranscriberWrapper {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tempfile::TempDir;

    #[test]
    fn test_mock_transcriber_basic_functionality() {
        let mock = MockTranscriber::new();
        
        // Test basic transcription
        let result = mock.transcribe_file(&PathBuf::from("test.wav"));
        assert!(result.is_ok());
        assert_eq!(mock.get_call_count(), 1);
    }

    #[test]
    fn test_mock_transcriber_pattern_matching() {
        let mock = MockTranscriber::new();
        
        // Test silence pattern
        let result = mock.transcribe_file(&PathBuf::from("silence.wav"));
        assert_eq!(result.unwrap(), "");
        
        // Test short pattern
        let result = mock.transcribe_file(&PathBuf::from("short.wav"));
        assert_eq!(result.unwrap(), "Hello world");
        
        // Test medium pattern
        let result = mock.transcribe_file(&PathBuf::from("medium_length.wav"));
        assert_eq!(result.unwrap(), "This is a medium length transcription for testing purposes");
        
        // Test noise pattern
        let result = mock.transcribe_file(&PathBuf::from("noise.wav"));
        assert_eq!(result.unwrap(), "[NOISE]");
    }

    #[test]
    fn test_mock_transcriber_custom_responses() {
        let mock = MockTranscriber::new();
        mock.set_response("custom", "Custom response");
        
        // This won't match the pattern directly, but we can test the custom response
        // by modifying the internal state
        let responses = mock.responses.lock().unwrap();
        assert_eq!(responses.get("custom").unwrap(), "Custom response");
    }

    #[test]
    fn test_mock_transcriber_failure() {
        let mock = MockTranscriber::new();
        mock.fail_next_transcription();
        
        let result = mock.transcribe_file(&PathBuf::from("test.wav"));
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Mock transcription failure");
        
        // Next call should succeed
        let result = mock.transcribe_file(&PathBuf::from("test.wav"));
        assert!(result.is_ok());
    }

    #[test]
    fn test_mock_transcriber_call_tracking() {
        let mock = MockTranscriber::new();
        
        assert_eq!(mock.get_call_count(), 0);
        
        let _ = mock.transcribe_file(&PathBuf::from("test1.wav"));
        assert_eq!(mock.get_call_count(), 1);
        
        let _ = mock.transcribe_file(&PathBuf::from("test2.wav"));
        assert_eq!(mock.get_call_count(), 2);
        
        mock.reset_call_count();
        assert_eq!(mock.get_call_count(), 0);
    }

    #[test]
    fn test_mock_transcriber_file_tracking() {
        let mock = MockTranscriber::new();
        
        let file1 = PathBuf::from("test1.wav");
        let file2 = PathBuf::from("test2.wav");
        
        let _ = mock.transcribe_file(&file1);
        let _ = mock.transcribe_file(&file2);
        
        let transcribed_files = mock.get_transcribed_files();
        assert_eq!(transcribed_files.len(), 2);
        assert!(transcribed_files.contains(&file1));
        assert!(transcribed_files.contains(&file2));
        
        mock.clear_transcribed_files();
        assert_eq!(mock.get_transcribed_files().len(), 0);
    }

    #[tokio::test]
    async fn test_mock_transcriber_arc_mutex() {
        let mock = MockTranscriber::new();
        let mock_arc = mock.into_arc_mutex();
        
        // Test that we can use it through Arc<Mutex<>>
        let mock_locked = mock_arc.lock().await;
        let result = mock_locked.transcribe_file(&PathBuf::from("test.wav"));
        assert!(result.is_ok());
        assert_eq!(mock_locked.get_call_count(), 1);
    }
}
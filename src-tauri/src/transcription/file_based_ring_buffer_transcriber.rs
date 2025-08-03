use crate::audio::WavFileReader;
use crate::logger::{debug, error, info, warn, Component};
use crate::transcription::Transcriber;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

/// A file-based ring buffer transcriber that reads chunks from a growing WAV file
/// This provides clean separation between recording and transcription processing
pub struct FileBasedRingBufferTranscriber {
    /// Path to the WAV file being recorded
    wav_file_path: PathBuf,
    /// WAV file reader for extracting chunks
    wav_reader: WavFileReader,
    /// Transcriber for processing audio chunks
    transcriber: Arc<Mutex<Transcriber>>,
    /// Directory for temporary chunk files
    temp_dir: PathBuf,
    /// Current read position in the file (in seconds)
    current_position: Duration,
    /// Duration of each chunk
    chunk_duration: Duration,
    /// Next chunk ID for tracking
    next_chunk_id: usize,
}

impl FileBasedRingBufferTranscriber {
    /// Create a new file-based ring buffer transcriber
    pub fn new(
        wav_file_path: PathBuf,
        transcriber: Arc<Mutex<Transcriber>>,
        temp_dir: PathBuf,
    ) -> Result<Self, String> {
        // Wait for file to exist and be readable instead of artificial delay
        let mut attempts = 0;
        let wav_reader = loop {
            match WavFileReader::new(&wav_file_path) {
                Ok(reader) => break reader,
                Err(e) if attempts < 50 => {
                    // File might not be ready yet, wait 1ms and retry
                    attempts += 1;
                    std::thread::sleep(Duration::from_millis(1));
                    continue;
                }
                Err(e) => return Err(format!("Failed to open WAV file after {} attempts: {}", attempts, e)),
            }
        };
        
        info(
            Component::RingBuffer,
            &format!(
                "FileBasedRingBufferTranscriber created for {:?}",
                wav_file_path
            ),
        );

        Ok(Self {
            wav_file_path,
            wav_reader,
            transcriber,
            temp_dir,
            current_position: Duration::ZERO,
            chunk_duration: Duration::from_secs(5), // 5-second chunks
            next_chunk_id: 0,
        })
    }

    /// Process a chunk at the current position
    pub async fn process_next_chunk(&mut self) -> Result<Option<String>, String> {
        // Check if we have enough audio data for a chunk
        let available_duration = self.wav_reader.get_available_duration()?;
        let required_duration = self.current_position + self.chunk_duration;
        
        if available_duration < required_duration {
            // Not enough data yet
            debug(
                Component::RingBuffer,
                &format!(
                    "Not enough audio data: available={:?}, required={:?}",
                    available_duration, required_duration
                ),
            );
            return Ok(None);
        }

        debug(
            Component::RingBuffer,
            &format!(
                "Processing chunk {} at position {:?} (duration {:?})",
                self.next_chunk_id, self.current_position, self.chunk_duration
            ),
        );

        // Extract chunk from WAV file
        let chunk_data = self.wav_reader.extract_chunk(
            self.current_position,
            self.chunk_duration,
        )?;

        if chunk_data.is_empty() {
            debug(Component::RingBuffer, "Empty chunk extracted, skipping");
            self.advance_position();
            return Ok(None);
        }

        // Save chunk to temporary file
        let chunk_filename = format!("file_chunk_{}_{}.wav", 
            self.next_chunk_id, 
            self.current_position.as_millis());
        let chunk_path = self.temp_dir.join(chunk_filename);

        self.wav_reader.save_chunk_to_file(&chunk_data, &chunk_path)?;

        // Transcribe the chunk
        let text = {
            let transcriber = self.transcriber.lock().await;
            transcriber
                .transcribe_file(&chunk_path)
                .map_err(|e| format!("Transcription failed: {}", e))?
        };

        // Clean up temporary file
        if chunk_path.exists() {
            if let Err(e) = std::fs::remove_file(&chunk_path) {
                warn(
                    Component::RingBuffer,
                    &format!("Failed to clean up chunk file: {}", e),
                );
            }
        }

        info(
            Component::RingBuffer,
            &format!(
                "File-based chunk {} completed: \"{}\"",
                self.next_chunk_id, text
            ),
        );

        self.advance_position();

        Ok(Some(text))
    }

    /// Advance to the next chunk position
    fn advance_position(&mut self) {
        self.current_position += self.chunk_duration;
        self.next_chunk_id += 1;
    }

    /// Process any remaining audio at the end of recording
    pub async fn process_final_chunk(&mut self) -> Result<Option<String>, String> {
        let available_duration = self.wav_reader.get_available_duration()?;
        let remaining_duration = available_duration.saturating_sub(self.current_position);
        
        // Only process if we have at least 100ms of audio
        if remaining_duration < Duration::from_millis(100) {
            return Ok(None);
        }

        info(
            Component::RingBuffer,
            &format!(
                "Processing final chunk {} at position {:?} (duration {:?})",
                self.next_chunk_id, self.current_position, remaining_duration
            ),
        );

        // Extract remaining audio
        let chunk_data = self.wav_reader.extract_chunk(
            self.current_position,
            remaining_duration,
        )?;

        if chunk_data.is_empty() {
            return Ok(None);
        }

        // Save chunk to temporary file
        let chunk_filename = format!("file_final_chunk_{}_{}.wav", 
            self.next_chunk_id, 
            self.current_position.as_millis());
        let chunk_path = self.temp_dir.join(chunk_filename);

        self.wav_reader.save_chunk_to_file(&chunk_data, &chunk_path)?;

        // Transcribe the chunk
        let text = {
            let transcriber = self.transcriber.lock().await;
            transcriber
                .transcribe_file(&chunk_path)
                .map_err(|e| format!("Final chunk transcription failed: {}", e))?
        };

        // Clean up temporary file
        if chunk_path.exists() {
            if let Err(e) = std::fs::remove_file(&chunk_path) {
                warn(
                    Component::RingBuffer,
                    &format!("Failed to clean up final chunk file: {}", e),
                );
            }
        }

        info(
            Component::RingBuffer,
            &format!(
                "File-based final chunk {} completed: \"{}\"",
                self.next_chunk_id, text
            ),
        );

        Ok(Some(text))
    }

    /// Check if more audio data is available for processing
    pub fn has_new_data(&self) -> Result<bool, String> {
        let available_duration = self.wav_reader.get_available_duration()?;
        let next_chunk_end = self.current_position + self.chunk_duration;
        
        Ok(available_duration >= next_chunk_end)
    }

    /// Wait for the WAV file to have enough data for the next chunk
    pub async fn wait_for_next_chunk(&self) -> Result<bool, String> {
        let required_duration = self.current_position + self.chunk_duration;
        self.wav_reader.wait_for_data(required_duration).await
    }

    /// Get the current processing position
    pub fn get_current_position(&self) -> Duration {
        self.current_position
    }

    /// Get the chunk duration
    pub fn get_chunk_duration(&self) -> Duration {
        self.chunk_duration
    }

    /// Reset position to start (useful for testing)
    pub fn reset_position(&mut self) {
        self.current_position = Duration::ZERO;
        self.next_chunk_id = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use hound::{WavWriter, WavSpec, SampleFormat};
    use tempfile::tempdir;
    use std::sync::Arc;
    use tokio::sync::Mutex;

    // Mock transcriber for testing
    struct MockTranscriber;
    
    impl MockTranscriber {
        fn transcribe_file(&self, _path: &Path) -> Result<String, String> {
            Ok("test transcription".to_string())
        }
    }

    fn create_test_wav_file(path: &Path, duration_secs: f32) -> Result<(), Box<dyn std::error::Error>> {
        let spec = WavSpec {
            channels: 1,
            sample_rate: 16000,
            bits_per_sample: 32,
            sample_format: SampleFormat::Float,
        };

        let mut writer = WavWriter::create(path, spec)?;
        
        // Write sine wave
        let samples_count = (duration_secs * spec.sample_rate as f32) as usize;
        for i in 0..samples_count {
            let t = i as f32 / spec.sample_rate as f32;
            let sample = (2.0 * std::f32::consts::PI * 440.0 * t).sin() * 0.5;
            writer.write_sample(sample)?;
        }
        
        writer.finalize()?;
        Ok(())
    }

    #[tokio::test]
    async fn test_file_based_transcriber_creation() {
        let temp_dir = tempdir().unwrap();
        let wav_path = temp_dir.path().join("test.wav");
        let temp_chunk_dir = temp_dir.path().join("chunks");
        std::fs::create_dir_all(&temp_chunk_dir).unwrap();
        
        // Create a test WAV file
        create_test_wav_file(&wav_path, 10.0).unwrap();
        
        // Create a mock transcriber (this would normally be a real Transcriber)
        // For testing, we'll skip the actual transcriber creation
        // let transcriber = Arc::new(Mutex::new(MockTranscriber));
        
        // Note: In a real test, we'd need to create a proper Transcriber instance
        // For now, we just test that the file reader works
        let wav_reader = WavFileReader::new(&wav_path).unwrap();
        let duration = wav_reader.get_available_duration().unwrap();
        assert!((duration.as_secs_f32() - 10.0).abs() < 0.1);
    }

    #[test]
    fn test_chunk_positioning() {
        let temp_dir = tempdir().unwrap();
        let wav_path = temp_dir.path().join("test.wav");
        
        // Create a 15-second test file
        create_test_wav_file(&wav_path, 15.0).unwrap();
        
        let wav_reader = WavFileReader::new(&wav_path).unwrap();
        
        // Test chunk extraction at different positions
        let chunk1 = wav_reader.extract_chunk(
            Duration::ZERO,
            Duration::from_secs(5)
        ).unwrap();
        
        let chunk2 = wav_reader.extract_chunk(
            Duration::from_secs(5),
            Duration::from_secs(5)
        ).unwrap();
        
        let chunk3 = wav_reader.extract_chunk(
            Duration::from_secs(10),
            Duration::from_secs(5)
        ).unwrap();
        
        // Each chunk should have roughly the same number of samples
        // (5 seconds at 16kHz = 80,000 samples)
        assert!(chunk1.len() > 75000 && chunk1.len() < 85000);
        assert!(chunk2.len() > 75000 && chunk2.len() < 85000);
        assert!(chunk3.len() > 75000 && chunk3.len() < 85000);
    }
}
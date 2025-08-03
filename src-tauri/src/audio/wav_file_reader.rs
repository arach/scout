use crate::logger::{debug, error, info, warn, Component};
use hound::{WavReader, WavSpec};
use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// A file-based WAV reader that can read chunks from a growing WAV file
/// This provides a clean separation between recording and transcription
pub struct WavFileReader {
    file_path: std::path::PathBuf,
    /// WAV specification from the file header
    spec: Option<WavSpec>,
    /// Current read position (in samples, not bytes)
    read_position: Arc<Mutex<usize>>,
    /// When we started monitoring this file
    start_time: Instant,
    /// Cached file size to detect growth
    last_known_size: Arc<Mutex<u64>>,
}

impl WavFileReader {
    /// Create a new WAV file reader for the given file path
    pub fn new(file_path: &Path) -> Result<Self, String> {
        // Verify file exists (it should be created by AudioRecorder)
        if !file_path.exists() {
            return Err(format!("WAV file does not exist: {:?}", file_path));
        }

        // Try to read WAV spec from file header
        let spec = Self::read_wav_spec(file_path)?;
        
        info(
            Component::RingBuffer,
            &format!(
                "WavFileReader initialized for {:?} - {} Hz, {} channels, {:?} format",
                file_path, spec.sample_rate, spec.channels, spec.sample_format
            ),
        );

        Ok(Self {
            file_path: file_path.to_path_buf(),
            spec: Some(spec),
            read_position: Arc::new(Mutex::new(0)),
            start_time: Instant::now(),
            last_known_size: Arc::new(Mutex::new(0)),
        })
    }

    /// Read the WAV specification from file header
    fn read_wav_spec(file_path: &Path) -> Result<WavSpec, String> {
        let file = File::open(file_path)
            .map_err(|e| format!("Failed to open WAV file: {}", e))?;
        let reader = WavReader::new(BufReader::new(file))
            .map_err(|e| format!("Failed to read WAV header: {}", e))?;
        
        Ok(reader.spec())
    }

    /// Get the current file size in bytes
    fn get_file_size(&self) -> Result<u64, String> {
        std::fs::metadata(&self.file_path)
            .map(|m| m.len())
            .map_err(|e| format!("Failed to get file size: {}", e))
    }

    /// Check if the file has grown since last check
    pub fn has_new_data(&self) -> Result<bool, String> {
        let current_size = self.get_file_size()?;
        let mut last_size = self.last_known_size.lock().unwrap();
        
        if current_size > *last_size {
            *last_size = current_size;
            debug(Component::WavReader, &format!("WAV file grew from {} to {} bytes", *last_size, current_size));
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// Get the current duration of audio available in the file
    pub fn get_available_duration(&self) -> Result<Duration, String> {
        let spec = self.spec.as_ref().ok_or("WAV spec not available")?;
        let file_size = self.get_file_size()?;
        
        // Calculate approximate duration based on file size
        // WAV header is ~44 bytes, rest is audio data
        let audio_data_size = file_size.saturating_sub(44);
        let bytes_per_second = spec.sample_rate as u64 * spec.channels as u64 * 4; // 4 bytes per f32 sample
        let duration_secs = audio_data_size / bytes_per_second;
        
        Ok(Duration::from_secs(duration_secs))
    }

    /// Extract a chunk of audio from the WAV file starting at the given offset
    pub fn extract_chunk(
        &self,
        start_offset: Duration,
        chunk_duration: Duration,
    ) -> Result<Vec<f32>, String> {
        let spec = self.spec.as_ref().ok_or("WAV spec not available")?;
        
        // Calculate sample positions
        let start_sample = (start_offset.as_secs_f32() 
            * spec.sample_rate as f32 
            * spec.channels as f32) as usize;
        let chunk_samples = (chunk_duration.as_secs_f32() 
            * spec.sample_rate as f32 
            * spec.channels as f32) as usize;

        debug(
            Component::RingBuffer,
            &format!(
                "Extracting chunk: start_sample={}, chunk_samples={}, offset={:?}, duration={:?}",
                start_sample, chunk_samples, start_offset, chunk_duration
            ),
        );

        // Open file and read samples
        let file = File::open(&self.file_path)
            .map_err(|e| format!("Failed to open WAV file for reading: {}", e))?;
        let mut reader = WavReader::new(BufReader::new(file))
            .map_err(|e| format!("Failed to create WAV reader: {}", e))?;

        // Skip to start position
        let mut samples_read = 0;
        let mut chunk_data = Vec::with_capacity(chunk_samples);

        // Read samples and skip to start position
        for (i, sample_result) in reader.samples::<f32>().enumerate() {
            if i < start_sample {
                // Skip samples before our chunk
                continue;
            }
            
            if samples_read >= chunk_samples {
                // We have enough samples for this chunk
                break;
            }

            match sample_result {
                Ok(sample) => {
                    chunk_data.push(sample);
                    samples_read += 1;
                }
                Err(e) => {
                    warn(
                        Component::RingBuffer,
                        &format!("Error reading sample at position {}: {}", i, e),
                    );
                    break;
                }
            }
        }

        if chunk_data.is_empty() {
            return Ok(Vec::new()); // Return empty vec if no data available
        }

        debug(
            Component::RingBuffer,
            &format!(
                "Extracted {} samples from WAV file (requested {})",
                chunk_data.len(), chunk_samples
            ),
        );

        Ok(chunk_data)
    }


    /// Get the WAV specification
    pub fn get_spec(&self) -> Option<&WavSpec> {
        self.spec.as_ref()
    }

    /// Save a chunk of samples to a temporary WAV file for transcription
    pub fn save_chunk_to_file(&self, chunk_data: &[f32], output_path: &Path) -> Result<(), String> {
        let spec = self.spec.as_ref().ok_or("WAV spec not available")?;
        
        if chunk_data.is_empty() {
            return Err("Cannot save empty chunk".to_string());
        }

        let mut writer = hound::WavWriter::create(output_path, *spec)
            .map_err(|e| format!("Failed to create chunk WAV file: {}", e))?;

        for &sample in chunk_data {
            writer
                .write_sample(sample)
                .map_err(|e| format!("Failed to write chunk sample: {}", e))?;
        }

        writer
            .finalize()
            .map_err(|e| format!("Failed to finalize chunk WAV file: {}", e))?;

        debug(
            Component::RingBuffer,
            &format!(
                "Saved chunk: {} samples to {:?}",
                chunk_data.len(),
                output_path
            ),
        );

        Ok(())
    }

    /// Check if the WAV file appears to be still growing (recording in progress)
    pub fn is_recording_active(&self) -> bool {
        // Heuristic: if file size changed in the last 2 seconds, assume recording is active
        let current_size = self.get_file_size().unwrap_or(0);
        let last_size = *self.last_known_size.lock().unwrap();
        
        // If file is growing, recording is likely active
        current_size > last_size
    }

    /// Wait for the file to have sufficient data for the requested chunk
    pub async fn wait_for_data(&self, required_duration: Duration) -> Result<bool, String> {
        let max_wait = Duration::from_secs(10); // Don't wait forever
        let start_wait = Instant::now();
        
        while start_wait.elapsed() < max_wait {
            match self.get_available_duration() {
                Ok(available) => {
                    if available >= required_duration {
                        return Ok(true);
                    }
                }
                Err(e) => {
                    debug(Component::RingBuffer, &format!("Error checking file duration: {}", e));
                }
            }
            
            // Wait a bit before checking again
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        
        warn(
            Component::RingBuffer,
            &format!(
                "Timeout waiting for sufficient audio data (needed {:?})",
                required_duration
            ),
        );
        Ok(false) // Timeout
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use hound::{WavWriter, WavSpec, SampleFormat};
    use tempfile::tempdir;

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

    #[test]
    fn test_wav_file_reader_basic() {
        let temp_dir = tempdir().unwrap();
        let wav_path = temp_dir.path().join("test.wav");
        
        // Create a 2-second test file
        create_test_wav_file(&wav_path, 2.0).unwrap();
        
        let reader = WavFileReader::new(&wav_path).unwrap();
        
        // Check spec
        let spec = reader.get_spec().unwrap();
        assert_eq!(spec.sample_rate, 16000);
        assert_eq!(spec.channels, 1);
        
        // Check duration
        let duration = reader.get_available_duration().unwrap();
        assert!((duration.as_secs_f32() - 2.0).abs() < 0.1); // Within 100ms
    }

    #[test]
    fn test_chunk_extraction() {
        let temp_dir = tempdir().unwrap();
        let wav_path = temp_dir.path().join("test.wav");
        
        // Create a 5-second test file
        create_test_wav_file(&wav_path, 5.0).unwrap();
        
        let reader = WavFileReader::new(&wav_path).unwrap();
        
        // Extract first 1-second chunk
        let chunk = reader.extract_chunk(
            Duration::ZERO,
            Duration::from_secs(1)
        ).unwrap();
        
        // Should have ~16000 samples for 1 second at 16kHz mono
        assert!(chunk.len() > 15000 && chunk.len() < 17000);
        
        // Extract chunk from middle
        let chunk2 = reader.extract_chunk(
            Duration::from_secs(2),
            Duration::from_secs(1)
        ).unwrap();
        
        assert!(chunk2.len() > 15000 && chunk2.len() < 17000);
    }

    #[test]
    fn test_save_chunk_to_file() {
        let temp_dir = tempdir().unwrap();
        let wav_path = temp_dir.path().join("test.wav");
        let chunk_path = temp_dir.path().join("chunk.wav");
        
        // Create a test file
        create_test_wav_file(&wav_path, 2.0).unwrap();
        
        let reader = WavFileReader::new(&wav_path).unwrap();
        
        // Extract and save a chunk
        let chunk = reader.extract_chunk(
            Duration::ZERO,
            Duration::from_secs(1)
        ).unwrap();
        
        reader.save_chunk_to_file(&chunk, &chunk_path).unwrap();
        
        // Verify chunk file was created and has correct format
        assert!(chunk_path.exists());
        
        let chunk_reader = WavFileReader::new(&chunk_path).unwrap();
        let chunk_spec = chunk_reader.get_spec().unwrap();
        assert_eq!(chunk_spec.sample_rate, 16000);
        assert_eq!(chunk_spec.channels, 1);
    }
}
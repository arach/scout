use std::sync::{Arc, Mutex};
use std::collections::VecDeque;
use std::time::{Duration, Instant};
use std::path::Path;
use hound::{WavSpec, WavWriter};
use std::io::BufWriter;
use std::fs::File;

/// A ring buffer that captures audio samples in real-time for chunked processing
pub struct RingBufferRecorder {
    /// Circular buffer storing audio samples
    samples: Arc<Mutex<VecDeque<f32>>>,
    /// WAV specification for the recording
    spec: WavSpec,
    /// When the recording started
    start_time: Instant,
    /// WAV writer for the main recording file
    writer: Arc<Mutex<Option<WavWriter<BufWriter<File>>>>>,
    /// Maximum buffer size (5 minutes of audio to prevent unbounded growth)
    max_samples: usize,
}

impl RingBufferRecorder {
    pub fn new(spec: WavSpec, output_path: &Path) -> Result<Self, String> {
        let writer = WavWriter::create(output_path, spec)
            .map_err(|e| format!("Failed to create WAV writer: {}", e))?;
        
        // Calculate max samples for 5 minutes of audio
        let max_samples = (spec.sample_rate as usize * spec.channels as usize) * 300;
        
        Ok(Self {
            samples: Arc::new(Mutex::new(VecDeque::new())),
            spec,
            start_time: Instant::now(),
            writer: Arc::new(Mutex::new(Some(writer))),
            max_samples,
        })
    }
    
    /// Add new audio samples to both the ring buffer and the WAV file
    pub fn add_samples(&self, new_samples: &[f32]) -> Result<(), String> {
        // Add to ring buffer first
        {
            let mut samples = self.samples.lock().unwrap();
            for &sample in new_samples {
                samples.push_back(sample);
            }
            
            // Maintain maximum buffer size
            while samples.len() > self.max_samples {
                samples.pop_front();
            }
        }
        
        // Write to WAV file
        if let Some(ref mut writer) = *self.writer.lock().unwrap() {
            for &sample in new_samples {
                writer.write_sample(sample)
                    .map_err(|e| format!("Failed to write sample to WAV: {}", e))?;
            }
        }
        
        Ok(())
    }
    
    /// Extract a chunk of audio from the ring buffer
    pub fn extract_chunk(&self, start_offset: Duration, chunk_duration: Duration) -> Result<Vec<f32>, String> {
        let samples = self.samples.lock().unwrap();
        
        let start_sample = (start_offset.as_secs_f32() * self.spec.sample_rate as f32 * self.spec.channels as f32) as usize;
        let chunk_samples = (chunk_duration.as_secs_f32() * self.spec.sample_rate as f32 * self.spec.channels as f32) as usize;
        
        if start_sample >= samples.len() {
            return Err("Start offset beyond available audio".to_string());
        }
        
        let end_sample = (start_sample + chunk_samples).min(samples.len());
        
        // Convert VecDeque range to Vec
        let chunk: Vec<f32> = samples.range(start_sample..end_sample).copied().collect();
        
        Ok(chunk)
    }
    
    /// Get the current duration of audio in the buffer
    pub fn get_duration(&self) -> Duration {
        let samples = self.samples.lock().unwrap();
        let duration_secs = samples.len() as f32 / (self.spec.sample_rate as f32 * self.spec.channels as f32);
        Duration::from_secs_f32(duration_secs)
    }
    
    /// Save a chunk to a WAV file
    pub fn save_chunk_to_file(
        &self,
        chunk_data: &[f32],
        output_path: &Path,
    ) -> Result<(), String> {
        let mut writer = WavWriter::create(output_path, self.spec)
            .map_err(|e| format!("Failed to create chunk WAV file: {}", e))?;
        
        for &sample in chunk_data {
            writer.write_sample(sample)
                .map_err(|e| format!("Failed to write chunk sample: {}", e))?;
        }
        
        writer.finalize()
            .map_err(|e| format!("Failed to finalize chunk WAV file: {}", e))?;
        
        Ok(())
    }
    
    /// Get the current number of samples in the buffer
    pub fn sample_count(&self) -> usize {
        self.samples.lock().unwrap().len()
    }
    
    /// Get the WAV specification
    pub fn get_spec(&self) -> WavSpec {
        self.spec
    }
    
    /// Get recording start time
    pub fn recording_start_time(&self) -> Instant {
        self.start_time
    }
    
    /// Finalize the main recording file
    pub fn finalize_recording(&self) -> Result<(), String> {
        if let Some(writer) = self.writer.lock().unwrap().take() {
            writer.finalize()
                .map_err(|e| format!("Failed to finalize recording: {}", e))?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use hound::SampleFormat;
    use tempfile::tempdir;
    
    #[test]
    fn test_ring_buffer_basic() {
        let temp_dir = tempdir().unwrap();
        let output_path = temp_dir.path().join("test.wav");
        
        let spec = WavSpec {
            channels: 1,
            sample_rate: 48000,
            bits_per_sample: 32,
            sample_format: SampleFormat::Float,
        };
        
        let recorder = RingBufferRecorder::new(spec, &output_path).unwrap();
        
        // Add 1 second of samples (silence)
        let samples: Vec<f32> = vec![0.1; 48000];
        recorder.add_samples(&samples).unwrap();
        
        assert_eq!(recorder.get_duration().as_secs(), 1);
        
        // Extract first 0.5 seconds
        let chunk = recorder.extract_chunk(Duration::ZERO, Duration::from_millis(500)).unwrap();
        assert_eq!(chunk.len(), 24000);
        
        // Finalize
        recorder.finalize_recording().unwrap();
    }
}
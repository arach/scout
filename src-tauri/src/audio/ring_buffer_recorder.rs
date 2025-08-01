use crate::logger::{debug, info, warn, Component};
use hound::{WavSpec, WavWriter};
use std::collections::VecDeque;
use std::fs::File;
use std::io::BufWriter;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

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
    /// Whether recording has been finalized
    is_finalized: Arc<Mutex<bool>>,
}

impl RingBufferRecorder {
    pub fn new(spec: WavSpec, output_path: &Path) -> Result<Self, String> {
        let writer = WavWriter::create(output_path, spec)
            .map_err(|e| format!("Failed to create WAV writer: {}", e))?;

        // Calculate max samples for 5 minutes of audio
        let max_samples = (spec.sample_rate as usize * spec.channels as usize) * 300;

        info(
            Component::RingBuffer,
            &format!("RingBufferRecorder created with native format:"),
        );
        info(
            Component::RingBuffer,
            &format!("  Sample Rate: {} Hz (hardware native)", spec.sample_rate),
        );
        info(
            Component::RingBuffer,
            &format!(
                "  Channels: {} ({})",
                spec.channels,
                if spec.channels == 1 {
                    "mono"
                } else if spec.channels == 2 {
                    "stereo"
                } else {
                    "multi-channel"
                }
            ),
        );
        info(
            Component::RingBuffer,
            &format!(
                "  Format: {:?} ({} bits)",
                spec.sample_format, spec.bits_per_sample
            ),
        );
        info(
            Component::RingBuffer,
            &format!("  Buffer: {} max samples ({} seconds)", max_samples, 300),
        );

        Ok(Self {
            samples: Arc::new(Mutex::new(VecDeque::new())),
            spec,
            start_time: Instant::now(),
            writer: Arc::new(Mutex::new(Some(writer))),
            max_samples,
            is_finalized: Arc::new(Mutex::new(false)),
        })
    }

    /// Add new audio samples to both the ring buffer and the WAV file
    /// Samples are expected to be in the device's native format (preserved as-is)
    pub fn add_samples(&self, new_samples: &[f32]) -> Result<(), String> {
        let new_sample_count = new_samples.len();

        // Add to ring buffer first
        {
            let mut samples = self.samples.lock().unwrap();
            let before_size = samples.len();

            for &sample in new_samples {
                samples.push_back(sample);
            }

            let _after_push = samples.len();

            // Maintain maximum buffer size
            let mut removed = 0;
            while samples.len() > self.max_samples {
                samples.pop_front();
                removed += 1;
            }

            let final_size = samples.len();

            // Debug logging for troubleshooting
            if new_sample_count > 0 && (before_size + new_sample_count - removed != final_size) {
                warn(
                    Component::RingBuffer,
                    &format!(
                        "Ring buffer math issue: before={}, added={}, removed={}, final={}, max={}",
                        before_size, new_sample_count, removed, final_size, self.max_samples
                    ),
                );
            }
        }

        // Write to WAV file
        if let Some(ref mut writer) = *self.writer.lock().unwrap() {
            for &sample in new_samples {
                writer
                    .write_sample(sample)
                    .map_err(|e| format!("Failed to write sample to WAV: {}", e))?;
            }
        }

        Ok(())
    }

    /// Extract a chunk of audio from the ring buffer
    pub fn extract_chunk(
        &self,
        start_offset: Duration,
        chunk_duration: Duration,
    ) -> Result<Vec<f32>, String> {
        let samples = self.samples.lock().unwrap();

        let channels = self.spec.channels as usize;
        let start_sample = (start_offset.as_secs_f32()
            * self.spec.sample_rate as f32
            * self.spec.channels as f32) as usize;
        let chunk_samples = (chunk_duration.as_secs_f32()
            * self.spec.sample_rate as f32
            * self.spec.channels as f32) as usize;

        if start_sample >= samples.len() {
            return Err("Start offset beyond available audio".to_string());
        }

        // Ensure start is aligned to channel boundaries
        let start_sample_aligned = (start_sample / channels) * channels;
        let end_sample = (start_sample + chunk_samples).min(samples.len());

        // Ensure end is aligned to channel boundaries
        let end_sample_aligned = (end_sample / channels) * channels;

        // Make sure we have at least one full frame
        if end_sample_aligned <= start_sample_aligned {
            return Ok(Vec::new());
        }

        // Convert VecDeque range to Vec
        let chunk: Vec<f32> = samples
            .range(start_sample_aligned..end_sample_aligned)
            .copied()
            .collect();

        // Verify the chunk size is a multiple of channels
        if chunk.len() % channels != 0 {
            warn(
                Component::RingBuffer,
                &format!(
                    "Chunk size {} is not a multiple of channels {}",
                    chunk.len(),
                    channels
                ),
            );
        }

        Ok(chunk)
    }

    /// Get the current duration of audio in the buffer
    pub fn get_duration(&self) -> Duration {
        let samples = self.samples.lock().unwrap();
        let duration_secs =
            samples.len() as f32 / (self.spec.sample_rate as f32 * self.spec.channels as f32);
        Duration::from_secs_f32(duration_secs)
    }

    /// Save a chunk to a WAV file in native format
    /// The chunk will be saved exactly as recorded (no conversion)
    pub fn save_chunk_to_file(&self, chunk_data: &[f32], output_path: &Path) -> Result<(), String> {
        // Validate chunk data
        if chunk_data.is_empty() {
            return Err("Cannot save empty chunk".to_string());
        }

        let channels = self.spec.channels as usize;
        if chunk_data.len() % channels != 0 {
            return Err(format!(
                "Chunk size {} is not a multiple of channels {}. Samples must be aligned to channel boundaries.",
                chunk_data.len(),
                channels
            ));
        }

        let mut writer = WavWriter::create(output_path, self.spec)
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
                "Saved native format chunk: {} samples ({} frames) at {} Hz to {:?}",
                chunk_data.len(),
                chunk_data.len() / channels,
                self.spec.sample_rate,
                output_path
            ),
        );

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
            writer
                .finalize()
                .map_err(|e| format!("Failed to finalize recording: {}", e))?;
        }
        *self.is_finalized.lock().unwrap() = true;
        Ok(())
    }

    /// Clear all samples from the ring buffer
    pub fn clear(&self) {
        let mut samples = self.samples.lock().unwrap();
        let count = samples.len();
        samples.clear();
        debug(
            Component::RingBuffer,
            &format!("Ring buffer cleared - {} samples removed", count),
        );
    }

    /// Check if recording has been finalized
    pub fn is_finalized(&self) -> bool {
        *self.is_finalized.lock().unwrap()
    }

    /// Get total number of samples currently in the buffer
    pub fn get_total_samples(&self) -> usize {
        self.samples.lock().unwrap().len()
    }

    /// Get samples within a specific range
    pub fn get_samples_range(&self, range: std::ops::Range<usize>) -> Result<Vec<f32>, String> {
        let samples = self.samples.lock().unwrap();

        if range.start > samples.len() || range.end > samples.len() {
            return Err(format!(
                "Range {:?} out of bounds for buffer size {}",
                range,
                samples.len()
            ));
        }

        // Convert VecDeque range to Vec
        let result: Vec<f32> = samples.range(range.clone()).cloned().collect();
        Ok(result)
    }
}

/// Helper function to save samples to a WAV file in native format
pub fn save_samples_to_wav(samples: &[f32], path: &Path, spec: WavSpec) -> Result<(), String> {
    let mut writer =
        WavWriter::create(path, spec).map_err(|e| format!("Failed to create WAV writer: {}", e))?;

    for &sample in samples {
        writer
            .write_sample(sample)
            .map_err(|e| format!("Failed to write sample: {}", e))?;
    }

    writer
        .finalize()
        .map_err(|e| format!("Failed to finalize WAV file: {}", e))?;

    Ok(())
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
            sample_rate: 48000, // Use a realistic native sample rate for tests
            bits_per_sample: 32,
            sample_format: SampleFormat::Float,
        };

        let recorder = RingBufferRecorder::new(spec, &output_path).unwrap();

        // Add 1 second of samples (silence) at 48kHz
        let samples: Vec<f32> = vec![0.1; 48000];
        recorder.add_samples(&samples).unwrap();

        assert_eq!(recorder.get_duration().as_secs(), 1);

        // Extract first 0.5 seconds
        let chunk = recorder
            .extract_chunk(Duration::ZERO, Duration::from_millis(500))
            .unwrap();
        assert_eq!(chunk.len(), 24000); // 0.5 seconds at 48kHz

        // Finalize
        recorder.finalize_recording().unwrap();
    }
}

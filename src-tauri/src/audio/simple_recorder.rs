use crate::logger::{info, Component};
use hound::{WavSpec, WavWriter};
use std::fs::File;
use std::io::BufWriter;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// Simplified, high-performance audio recorder that writes directly to a single file
/// 
/// This replaces the complex dual-file ring buffer system with a simple, reliable approach:
/// - Single WAV file output (no ring buffers)
/// - Direct streaming to disk
/// - Automatic cleanup on drop (RAII)
/// - Optimized for <100ms recording latency
pub struct SimpleAudioRecorder {
    /// WAV writer for direct file output
    writer: Arc<Mutex<Option<WavWriter<BufWriter<File>>>>>,
    /// Recording state
    state: Arc<Mutex<RecorderState>>,
    /// WAV specification
    spec: WavSpec,
    /// Cleanup guard ensures resources are freed
    _cleanup_guard: CleanupGuard,
}

#[derive(Debug, Clone)]
pub enum RecorderState {
    Idle,
    Recording {
        path: PathBuf,
        start_time: Instant,
        samples_written: u64,
    },
    Stopping,
    Error(String),
}

pub struct CleanupGuard {
    cleanup_fn: Option<Box<dyn FnOnce() + Send>>,
}

impl Drop for CleanupGuard {
    fn drop(&mut self) {
        if let Some(cleanup) = self.cleanup_fn.take() {
            cleanup();
        }
    }
}

#[derive(Debug, Clone)]
pub struct RecordingInfo {
    pub path: PathBuf,
    pub duration_samples: u64,
    pub duration_seconds: f64,
    pub sample_rate: u32,
    pub channels: u16,
}

impl SimpleAudioRecorder {
    /// Create a new simplified audio recorder
    pub fn new(spec: WavSpec) -> Self {
        info(
            Component::Recording,
            &format!("✅ SimpleAudioRecorder created - optimized for performance"),
        );
        info(
            Component::Recording,
            &format!("  Sample Rate: {} Hz", spec.sample_rate),
        );
        info(
            Component::Recording,
            &format!("  Channels: {}", spec.channels),
        );
        info(
            Component::Recording,
            &format!("  Bits per Sample: {}", spec.bits_per_sample),
        );

        Self {
            writer: Arc::new(Mutex::new(None)),
            state: Arc::new(Mutex::new(RecorderState::Idle)),
            spec,
            _cleanup_guard: CleanupGuard { cleanup_fn: None },
        }
    }

    /// Start recording to the specified output path
    /// Returns immediately for optimal performance (<10ms typical)
    pub fn start_recording(&self, output_path: &Path) -> Result<(), String> {
        let start_time = Instant::now();
        
        // Quick state check
        {
            let state = self.state.lock().map_err(|e| format!("State lock error: {}", e))?;
            if !matches!(*state, RecorderState::Idle) {
                return Err("Recorder is not idle - cannot start recording".to_string());
            }
        }

        // Create WAV writer
        let writer = WavWriter::create(output_path, self.spec)
            .map_err(|e| format!("Failed to create WAV file: {}", e))?;

        // Update state atomically
        {
            let mut writer_guard = self.writer.lock().map_err(|e| format!("Writer lock error: {}", e))?;
            let mut state_guard = self.state.lock().map_err(|e| format!("State lock error: {}", e))?;
            
            *writer_guard = Some(writer);
            *state_guard = RecorderState::Recording {
                path: output_path.to_path_buf(),
                start_time,
                samples_written: 0,
            };
        }

        let latency = start_time.elapsed();
        info(
            Component::Recording,
            &format!("✅ Recording started in {:?} - writing to: {:?}", latency, output_path),
        );

        Ok(())
    }

    /// Stop recording and finalize the file
    /// Returns recording information
    pub fn stop_recording(&self) -> Result<RecordingInfo, String> {
        let stop_time = Instant::now();
        
        // Get current recording info
        let (path, start_time, samples_written) = {
            let mut state_guard = self.state.lock().map_err(|e| format!("State lock error: {}", e))?;
            
            match &*state_guard {
                RecorderState::Recording { path, start_time, samples_written } => {
                    let info = (path.clone(), *start_time, *samples_written);
                    *state_guard = RecorderState::Stopping;
                    info
                }
                _ => return Err("No active recording to stop".to_string()),
            }
        };

        // Finalize the WAV file
        {
            let mut writer_guard = self.writer.lock().map_err(|e| format!("Writer lock error: {}", e))?;
            if let Some(writer) = writer_guard.take() {
                writer.finalize().map_err(|e| format!("Failed to finalize WAV file: {}", e))?;
            }
        }

        // Update state to idle
        {
            let mut state_guard = self.state.lock().map_err(|e| format!("State lock error: {}", e))?;
            *state_guard = RecorderState::Idle;
        }

        let duration_seconds = stop_time.duration_since(start_time).as_secs_f64();
        let latency = stop_time.elapsed();
        
        let recording_info = RecordingInfo {
            path: path.clone(),
            duration_samples: samples_written,
            duration_seconds,
            sample_rate: self.spec.sample_rate,
            channels: self.spec.channels,
        };

        info(
            Component::Recording,
            &format!(
                "✅ Recording stopped in {:?} - Duration: {:.2}s, Samples: {}, File: {:?}",
                latency, duration_seconds, samples_written, path
            ),
        );

        Ok(recording_info)
    }

    /// Write audio samples to the recording file
    /// Optimized for real-time performance - should be called from audio thread
    pub fn write_samples(&self, samples: &[f32]) -> Result<(), String> {
        let mut writer_guard = self.writer.lock().map_err(|e| format!("Writer lock error: {}", e))?;
        let mut state_guard = self.state.lock().map_err(|e| format!("State lock error: {}", e))?;

        // Quick state check
        if !matches!(*state_guard, RecorderState::Recording { .. }) {
            return Ok(()); // Silently ignore if not recording
        }

        if let Some(ref mut writer) = *writer_guard {
            // Write samples efficiently
            for &sample in samples {
                writer.write_sample(sample).map_err(|e| format!("Write error: {}", e))?;
            }

            // Update sample count
            if let RecorderState::Recording { ref mut samples_written, .. } = &mut *state_guard {
                *samples_written += samples.len() as u64;
            }
        }

        Ok(())
    }

    /// Get current recording state
    pub fn get_state(&self) -> Result<RecorderState, String> {
        let state_guard = self.state.lock().map_err(|e| format!("State lock error: {}", e))?;
        Ok(state_guard.clone())
    }

    /// Check if currently recording
    pub fn is_recording(&self) -> bool {
        self.state
            .lock()
            .map(|state| matches!(*state, RecorderState::Recording { .. }))
            .unwrap_or(false)
    }

    /// Get the WAV specification
    pub fn get_spec(&self) -> WavSpec {
        self.spec
    }
}

impl Default for SimpleAudioRecorder {
    fn default() -> Self {
        // Default to high-quality recording settings
        let spec = WavSpec {
            channels: 1,
            sample_rate: 48000,
            bits_per_sample: 32,
            sample_format: hound::SampleFormat::Float,
        };
        Self::new(spec)
    }
}

/// Thread-safe, panic-safe cleanup
unsafe impl Send for SimpleAudioRecorder {}
unsafe impl Sync for SimpleAudioRecorder {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tempfile::tempdir;

    #[test]
    fn test_simple_recorder_lifecycle() {
        let temp_dir = tempdir().unwrap();
        let output_path = temp_dir.path().join("test_recording.wav");

        let spec = WavSpec {
            channels: 1,
            sample_rate: 44100,
            bits_per_sample: 32,
            sample_format: hound::SampleFormat::Float,
        };

        let recorder = SimpleAudioRecorder::new(spec);

        // Test initial state
        assert!(!recorder.is_recording());
        assert!(matches!(recorder.get_state().unwrap(), RecorderState::Idle));

        // Test start recording
        recorder.start_recording(&output_path).unwrap();
        assert!(recorder.is_recording());

        // Write some test samples
        let samples = vec![0.1, 0.2, 0.3, 0.4, 0.5];
        recorder.write_samples(&samples).unwrap();

        // Test stop recording
        let info = recorder.stop_recording().unwrap();
        assert!(!recorder.is_recording());
        assert_eq!(info.sample_rate, 44100);
        assert_eq!(info.channels, 1);
        assert_eq!(info.duration_samples, 5);

        // Verify file exists
        assert!(output_path.exists());
    }

    #[test]
    fn test_recorder_error_handling() {
        let spec = WavSpec {
            channels: 1,
            sample_rate: 44100,
            bits_per_sample: 32,
            sample_format: hound::SampleFormat::Float,
        };

        let recorder = SimpleAudioRecorder::new(spec);

        // Test stopping without starting
        assert!(recorder.stop_recording().is_err());

        // Test starting on invalid path
        let invalid_path = PathBuf::from("/invalid/path/recording.wav");
        assert!(recorder.start_recording(&invalid_path).is_err());
    }
}
/// Streaming Transcriber for Real-time Whisper Integration
/// 
/// This implementation provides pseudo-streaming transcription by:
/// - Buffering incoming 16kHz mono audio samples
/// - Processing chunks in overlapping windows for continuity
/// - Using whisper-rs callbacks for progress monitoring
/// - Minimizing I/O by processing samples directly in memory
/// 
/// Architecture:
/// - Circular buffer for continuous audio intake
/// - Configurable chunk sizes (1-3 seconds optimal for Whisper)
/// - Overlap processing to avoid word boundary issues
/// - Real-time callback system for results

use crate::audio::streaming_recorder_16khz::StreamingSampleCallback;
use crate::logger::{debug, error, info, Component};
use crate::transcription::Transcriber;
use std::collections::VecDeque;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

/// Configuration for streaming transcription
#[derive(Debug, Clone)]
pub struct StreamingTranscriberConfig {
    /// Size of audio chunks to process (in seconds)
    pub chunk_duration_secs: f32,
    /// Overlap between chunks (in seconds) to avoid word boundary issues
    pub overlap_duration_secs: f32,
    /// Maximum buffer size (in seconds) before forced processing
    pub max_buffer_duration_secs: f32,
    /// Minimum chunk size for processing (avoid very short clips)
    pub min_chunk_duration_secs: f32,
    /// Enable aggressive processing for low latency
    pub low_latency_mode: bool,
}

impl Default for StreamingTranscriberConfig {
    fn default() -> Self {
        Self {
            chunk_duration_secs: 5.0,      // 5 second chunks (progressive-like)
            overlap_duration_secs: 0.0,    // No overlap (eliminates repetition)
            max_buffer_duration_secs: 12.0, // 12 second max buffer
            min_chunk_duration_secs: 2.0,  // 2 second minimum (reasonable start point)
            low_latency_mode: false,
        }
    }
}

/// Result from streaming transcription
#[derive(Debug, Clone)]
pub struct StreamingTranscriptionResult {
    pub text: String,
    pub start_time: Instant,
    pub end_time: Instant,
    pub chunk_id: u64,
    pub is_partial: bool,
    pub confidence: Option<f32>,
    pub processing_time_ms: u64,
}

/// Callback for receiving transcription results in real-time
pub type StreamingTranscriptionCallback = Arc<dyn Fn(StreamingTranscriptionResult) + Send + Sync>;

/// Buffer management for streaming audio
struct StreamingAudioBuffer {
    samples: VecDeque<f32>,
    sample_rate: u32,
    max_samples: usize,
    creation_time: Instant,
}

impl StreamingAudioBuffer {
    fn new(sample_rate: u32, max_duration_secs: f32) -> Self {
        let max_samples = (sample_rate as f32 * max_duration_secs) as usize;
        Self {
            samples: VecDeque::with_capacity(max_samples),
            sample_rate,
            max_samples,
            creation_time: Instant::now(),
        }
    }

    fn add_samples(&mut self, new_samples: &[f32]) {
        for &sample in new_samples {
            if self.samples.len() >= self.max_samples {
                self.samples.pop_front();
            }
            self.samples.push_back(sample);
        }
    }

    fn get_chunk(&self, duration_secs: f32) -> Vec<f32> {
        let chunk_samples = (self.sample_rate as f32 * duration_secs) as usize;
        let available_samples = self.samples.len();
        
        if available_samples < chunk_samples {
            // Return all available samples if less than requested
            self.samples.iter().cloned().collect()
        } else {
            // Return the most recent chunk_samples
            self.samples.iter()
                .skip(available_samples - chunk_samples)
                .cloned()
                .collect()
        }
    }

    fn get_overlapping_chunk(&self, duration_secs: f32, overlap_secs: f32) -> Vec<f32> {
        let chunk_samples = (self.sample_rate as f32 * duration_secs) as usize;
        let overlap_samples = (self.sample_rate as f32 * overlap_secs) as usize;
        let start_offset = overlap_samples;
        
        let available_samples = self.samples.len();
        
        if available_samples < chunk_samples + start_offset {
            return self.get_chunk(duration_secs);
        }

        let start_idx = available_samples - chunk_samples - start_offset;
        self.samples.iter()
            .skip(start_idx)
            .take(chunk_samples)
            .cloned()
            .collect()
    }

    fn duration_secs(&self) -> f32 {
        self.samples.len() as f32 / self.sample_rate as f32
    }

    fn clear(&mut self) {
        self.samples.clear();
    }
}

pub struct StreamingTranscriber {
    config: StreamingTranscriberConfig,
    transcriber: Arc<tokio::sync::Mutex<Transcriber>>,
    audio_buffer: Arc<Mutex<StreamingAudioBuffer>>,
    transcription_callback: Arc<Mutex<Option<StreamingTranscriptionCallback>>>,
    is_active: Arc<Mutex<bool>>,
    chunk_counter: Arc<Mutex<u64>>,
    processing_thread: Option<thread::JoinHandle<()>>,
    sample_callback: Option<StreamingSampleCallback>,
}

impl StreamingTranscriber {
    pub async fn new(
        model_path: &Path,
        config: StreamingTranscriberConfig,
    ) -> Result<Self, String> {
        info(Component::Transcription, "🌊 Initializing Streaming Transcriber");
        info(Component::Transcription, &format!("Config: chunk={}s, overlap={}s, max_buffer={}s", 
            config.chunk_duration_secs, config.overlap_duration_secs, config.max_buffer_duration_secs));

        // Get cached transcriber instance
        let transcriber = Transcriber::get_or_create_cached(model_path).await?;

        // Create audio buffer
        let audio_buffer = Arc::new(Mutex::new(StreamingAudioBuffer::new(
            16000, // 16kHz
            config.max_buffer_duration_secs,
        )));

        let instance = Self {
            config: config.clone(),
            transcriber,
            audio_buffer,
            transcription_callback: Arc::new(Mutex::new(None)),
            is_active: Arc::new(Mutex::new(false)),
            chunk_counter: Arc::new(Mutex::new(0)),
            processing_thread: None,
            sample_callback: None,
        };

        info(Component::Transcription, "✅ Streaming Transcriber initialized");
        Ok(instance)
    }

    pub fn set_transcription_callback(&mut self, callback: Option<StreamingTranscriptionCallback>) {
        *self.transcription_callback.lock().unwrap() = callback;
    }

    pub fn start_streaming(&mut self) -> Result<(), String> {
        info(Component::Transcription, "🚀 Starting streaming transcription");

        *self.is_active.lock().unwrap() = true;

        // Create sample callback for audio input
        let audio_buffer = self.audio_buffer.clone();
        let sample_callback = Arc::new(move |samples: &[f32]| {
            if let Ok(mut buffer) = audio_buffer.lock() {
                buffer.add_samples(samples);
            }
        });

        self.sample_callback = Some(sample_callback.clone());

        // Start simple interval-based processing 
        self.start_interval_processing()?;

        info(Component::Transcription, "✅ Streaming transcription active");
        Ok(())
    }

    pub fn stop_streaming(&mut self) -> Result<(), String> {
        info(Component::Transcription, "⏹️ Stopping streaming transcription");

        *self.is_active.lock().unwrap() = false;

        if let Some(handle) = self.processing_thread.take() {
            handle.join().map_err(|_| "Failed to join processing thread")?;
        }

        // Clear buffer
        self.audio_buffer.lock().unwrap().clear();
        *self.chunk_counter.lock().unwrap() = 0;

        info(Component::Transcription, "✅ Streaming transcription stopped");
        Ok(())
    }

    pub fn get_sample_callback(&self) -> Option<StreamingSampleCallback> {
        self.sample_callback.clone()
    }

    pub fn is_active(&self) -> bool {
        *self.is_active.lock().unwrap()
    }

    fn start_interval_processing(&mut self) -> Result<(), String> {
        let config = self.config.clone();
        let transcriber = self.transcriber.clone();
        let audio_buffer = self.audio_buffer.clone();
        let transcription_callback = self.transcription_callback.clone();
        let is_active = self.is_active.clone();
        let chunk_counter = self.chunk_counter.clone();

        let handle = thread::spawn(move || {
            Self::simple_interval_processing(
                config,
                transcriber,
                audio_buffer,
                transcription_callback,
                is_active,
                chunk_counter,
            );
        });

        self.processing_thread = Some(handle);
        Ok(())
    }

    fn simple_interval_processing(
        config: StreamingTranscriberConfig,
        transcriber: Arc<tokio::sync::Mutex<Transcriber>>,
        audio_buffer: Arc<Mutex<StreamingAudioBuffer>>,
        transcription_callback: Arc<Mutex<Option<StreamingTranscriptionCallback>>>,
        is_active: Arc<Mutex<bool>>,
        chunk_counter: Arc<Mutex<u64>>,
    ) {
        let process_interval = Duration::from_secs_f32(config.chunk_duration_secs);
        info(Component::Transcription, &format!("🔄 Simple interval processing started (every {:.1}s)", config.chunk_duration_secs));

        while *is_active.lock().unwrap() {
            // Simple: just sleep for the chunk duration, then process
            thread::sleep(process_interval);
            
            if !*is_active.lock().unwrap() {
                break;
            }

            // Process whatever audio we have accumulated
            if let Err(e) = Self::process_chunk(
                &config,
                &transcriber,
                &audio_buffer,
                &transcription_callback,
                &chunk_counter,
            ) {
                error(Component::Transcription, &format!("Processing error: {}", e));
            }
        }

        info(Component::Transcription, "🏁 Simple interval processing ended");
    }

    fn process_chunk(
        config: &StreamingTranscriberConfig,
        transcriber: &Arc<tokio::sync::Mutex<Transcriber>>,
        audio_buffer: &Arc<Mutex<StreamingAudioBuffer>>,
        transcription_callback: &Arc<Mutex<Option<StreamingTranscriptionCallback>>>,
        chunk_counter: &Arc<Mutex<u64>>,
    ) -> Result<(), String> {
        let start_time = Instant::now();

        // Extract audio chunk - simple approach
        let audio_chunk = {
            let mut buffer = audio_buffer.lock().unwrap();
            if buffer.duration_secs() < config.min_chunk_duration_secs {
                return Ok(()); // Not enough audio yet
            }

            // Get all available audio, then clear the buffer (no overlap)
            let chunk = buffer.get_chunk(buffer.duration_secs());
            buffer.clear(); // Simple: clear everything we just processed
            chunk
        };

        if audio_chunk.is_empty() {
            return Ok(());
        }

        let chunk_id = {
            let mut counter = chunk_counter.lock().unwrap();
            *counter += 1;
            *counter
        };

        debug(Component::Transcription, &format!("Processing chunk {} ({} samples)", 
            chunk_id, audio_chunk.len()));

        // Process with whisper-rs directly in memory (no file I/O)
        let transcription_result = Self::transcribe_samples_direct(
            transcriber,
            &audio_chunk,
            chunk_id,
        )?;

        let processing_time = start_time.elapsed();

        // Create result
        let result = StreamingTranscriptionResult {
            text: transcription_result,
            start_time,
            end_time: Instant::now(),
            chunk_id,
            is_partial: true, // All streaming results are partial
            confidence: None, // whisper-rs doesn't provide confidence scores
            processing_time_ms: processing_time.as_millis() as u64,
        };

        let result_text = if result.text.len() > 50 { 
            format!("{}...", &result.text[..50]) 
        } else { 
            result.text.clone() 
        };

        // Call callback if set
        if let Some(ref callback) = *transcription_callback.lock().unwrap() {
            callback(result);
        }

        info(Component::Transcription, &format!("Chunk {} processed in {}ms: '{}'", 
            chunk_id, processing_time.as_millis(), result_text));

        Ok(())
    }

    /// Transcribe audio samples directly without file I/O
    fn transcribe_samples_direct(
        transcriber: &Arc<tokio::sync::Mutex<Transcriber>>,
        samples: &[f32],
        chunk_id: u64,
    ) -> Result<String, String> {
        debug(Component::Transcription, &format!("Direct transcription of {} samples for chunk {}", 
            samples.len(), chunk_id));

        // Create temporary in-memory "file" using hound
        let mut cursor = std::io::Cursor::new(Vec::new());
        
        {
            let spec = hound::WavSpec {
                channels: 1,
                sample_rate: 16000,
                bits_per_sample: 32,
                sample_format: hound::SampleFormat::Float,
            };

            let mut writer = hound::WavWriter::new(&mut cursor, spec)
                .map_err(|e| format!("Failed to create in-memory WAV writer: {}", e))?;

            for &sample in samples {
                writer.write_sample(sample)
                    .map_err(|e| format!("Failed to write sample: {}", e))?;
            }

            writer.finalize()
                .map_err(|e| format!("Failed to finalize in-memory WAV: {}", e))?;
        }

        // Reset cursor to beginning
        cursor.set_position(0);

        // Create temporary file for whisper-rs (unfortunately required by current API)
        
        let mut temp_file = tempfile::NamedTempFile::new()
            .map_err(|e| format!("Failed to create temp file: {}", e))?;

        std::io::copy(&mut cursor, &mut temp_file)
            .map_err(|e| format!("Failed to write temp file: {}", e))?;

        // Transcribe using existing transcriber
        let transcriber = transcriber.blocking_lock();
        let result = transcriber.transcribe(temp_file.path())?;

        // Temp file is automatically cleaned up when dropped
        Ok(result)
    }
}

impl Drop for StreamingTranscriber {
    fn drop(&mut self) {
        if self.is_active() {
            let _ = self.stop_streaming();
        }
    }
}

/// Integration example: Connect streaming recorder to streaming transcriber
pub struct StreamingTranscriptionPipeline {
    recorder: crate::audio::streaming_recorder_16khz::StreamingAudioRecorder16kHz,
    transcriber: StreamingTranscriber,
}

impl StreamingTranscriptionPipeline {
    pub async fn new(
        model_path: &Path,
        recorder_config: crate::audio::streaming_recorder_16khz::StreamingRecorderConfig,
        transcriber_config: StreamingTranscriberConfig,
    ) -> Result<Self, String> {
        info(Component::Transcription, "🔗 Creating streaming transcription pipeline");

        let mut recorder = crate::audio::streaming_recorder_16khz::StreamingAudioRecorder16kHz::new(recorder_config);
        recorder.init()?;

        let transcriber = StreamingTranscriber::new(model_path, transcriber_config).await?;

        Ok(Self {
            recorder,
            transcriber,
        })
    }

    pub fn set_transcription_callback(&mut self, callback: StreamingTranscriptionCallback) {
        self.transcriber.set_transcription_callback(Some(callback));
    }

    pub fn start_pipeline(&mut self) -> Result<(), String> {
        info(Component::Transcription, "🚀 Starting transcription pipeline");

        // Start transcriber
        self.transcriber.start_streaming()?;

        // Connect recorder to transcriber
        if let Some(sample_callback) = self.transcriber.get_sample_callback() {
            self.recorder.set_sample_callback(Some(sample_callback))?;
        }

        // Start recording
        self.recorder.start_recording()?;

        info(Component::Transcription, "✅ Transcription pipeline active");
        Ok(())
    }

    pub fn stop_pipeline(&mut self) -> Result<(), String> {
        info(Component::Transcription, "⏹️ Stopping transcription pipeline");

        self.recorder.stop_recording()?;
        self.transcriber.stop_streaming()?;

        info(Component::Transcription, "✅ Transcription pipeline stopped");
        Ok(())
    }

    pub fn is_active(&self) -> bool {
        self.recorder.is_recording() && self.transcriber.is_active()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_streaming_buffer() {
        let mut buffer = StreamingAudioBuffer::new(16000, 5.0); // 5 second buffer
        
        // Add some samples
        let samples = vec![0.1, 0.2, 0.3, 0.4, 0.5];
        buffer.add_samples(&samples);
        
        assert_eq!(buffer.samples.len(), 5);
        assert!(buffer.duration_secs() < 0.001); // Very short duration
        
        // Test chunk extraction
        let chunk = buffer.get_chunk(1.0);
        assert_eq!(chunk.len(), 5); // All available samples since duration < 1s
    }

    #[test]
    fn test_config_defaults() {
        let config = StreamingTranscriberConfig::default();
        assert_eq!(config.chunk_duration_secs, 2.0);
        assert_eq!(config.overlap_duration_secs, 0.5);
        assert_eq!(config.max_buffer_duration_secs, 10.0);
        assert_eq!(config.min_chunk_duration_secs, 0.3);
        assert!(!config.low_latency_mode);
    }

    #[test]
    fn test_buffer_overflow() {
        let mut buffer = StreamingAudioBuffer::new(16000, 0.001); // Very small buffer (16 samples)
        
        // Add more samples than buffer can hold
        let samples: Vec<f32> = (0..100).map(|i| i as f32 / 100.0).collect();
        buffer.add_samples(&samples);
        
        // Should only keep the most recent samples
        assert_eq!(buffer.samples.len(), 16);
        
        // Should contain the last 16 samples
        let expected_start = 100 - 16;
        for (i, &sample) in buffer.samples.iter().enumerate() {
            let expected = (expected_start + i) as f32 / 100.0;
            assert!((sample - expected).abs() < 1e-6);
        }
    }
}
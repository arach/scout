use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use hound::{WavSpec, WavWriter};
use std::fs::File;
use std::io::BufWriter;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Instant;
use crate::logger::{debug, info, warn, error, Component};

/// Ultra-simplified CPAL recorder that trusts the framework completely
/// 
/// Philosophy: CPAL handles device enumeration, format negotiation, and error recovery.
/// We just need to connect CPAL to a WAV writer. That's it.
/// 
/// IMPORTANT: To maintain Send+Sync compatibility, we don't store the Stream directly.
/// Instead, we leak it during recording and rely on the process cleanup.
pub struct SimpleCpalRecorder {
    writer: Arc<Mutex<Option<WavWriter<BufWriter<File>>>>>,
    state: Arc<Mutex<RecorderState>>,
    is_recording: Arc<AtomicBool>,
    callback_count: Arc<AtomicU64>,
    total_samples: Arc<AtomicU64>,
}

#[derive(Debug, Clone)]
pub enum RecorderState {
    Idle,
    Recording { 
        path: PathBuf,
        start_time: Instant,
        samples_written: u64,
        sample_rate: u32,
        channels: u16,
    },
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RecordingInfo {
    pub path: PathBuf,
    pub duration_samples: u64,
    pub duration_seconds: f64,
    pub sample_rate: u32,
    pub channels: u16,
}

impl SimpleCpalRecorder {
    /// Create a new recorder - no complex initialization needed
    pub fn new() -> Self {
        info(Component::Audio, "🎙️ [CPAL] Creating new SimpleCpalRecorder");
        Self {
            writer: Arc::new(Mutex::new(None)),
            state: Arc::new(Mutex::new(RecorderState::Idle)),
            is_recording: Arc::new(AtomicBool::new(false)),
            callback_count: Arc::new(AtomicU64::new(0)),
            total_samples: Arc::new(AtomicU64::new(0)),
        }
    }

    /// Start recording to a file
    /// Trust CPAL to handle device selection and format negotiation
    pub fn start_recording(&self, path: &Path, device_name: Option<&str>) -> Result<(), String> {
        info(Component::Audio, "🎙️ [RECORDER] ========== START RECORDING ==========");
        info(Component::Audio, &format!("🎙️ [RECORDER] Path: {:?}", path));
        info(Component::Audio, &format!("🎙️ [RECORDER] Device: {:?}", device_name));
        
        // Reset counters
        self.callback_count.store(0, Ordering::SeqCst);
        self.total_samples.store(0, Ordering::SeqCst);
        info(Component::Audio, "🎙️ [RECORDER] Reset counters - callback_count: 0, total_samples: 0");
        
        // Check current state
        {
            let state = self.state.lock().unwrap();
            if matches!(*state, RecorderState::Recording { .. }) {
                warn(Component::Audio, "🎙️ [RECORDER] Already recording, returning error");
                return Err("Already recording".to_string());
            }
            info(Component::Audio, "🎙️ [RECORDER] Current state: Idle, proceeding with recording");
        }

        // Get the device - trust CPAL's enumeration
        info(Component::Audio, "🎙️ [RECORDER] Getting audio host and device");
        let host = cpal::default_host();
        let device = if let Some(name) = device_name {
            info(Component::Audio, &format!("🎙️ [RECORDER] Looking for specific device: {}", name));
            host.input_devices()
                .map_err(|e| format!("Failed to enumerate devices: {}", e))?
                .find(|d| d.name().map(|n| n == name).unwrap_or(false))
                .ok_or_else(|| format!("Device '{}' not found", name))?
        } else {
            info(Component::Audio, "🎙️ [RECORDER] Using default input device");
            host.default_input_device()
                .ok_or_else(|| "No default input device".to_string())?
        };
        
        let device_name_str = device.name().unwrap_or_else(|_| "Unknown".to_string());
        info(Component::Audio, &format!("🎙️ [RECORDER] Selected device: {}", device_name_str));

        // Get the default config - trust CPAL's format selection
        info(Component::Audio, "🎙️ [RECORDER] Getting device config");
        let config = device
            .default_input_config()
            .map_err(|e| format!("Failed to get config: {}", e))?;
        
        info(Component::Audio, &format!("🎙️ [RECORDER] Device config: {} Hz, {} channels, format: {:?}", 
            config.sample_rate().0, config.channels(), config.sample_format()));

        // Create WAV spec based on what CPAL gives us
        let wav_spec = WavSpec {
            channels: config.channels(),
            sample_rate: config.sample_rate().0,
            bits_per_sample: match config.sample_format() {
                cpal::SampleFormat::I16 => 16,
                cpal::SampleFormat::F32 => 32,
                _ => return Err("Unsupported sample format".to_string()),
            },
            sample_format: match config.sample_format() {
                cpal::SampleFormat::I16 => hound::SampleFormat::Int,
                cpal::SampleFormat::F32 => hound::SampleFormat::Float,
                _ => return Err("Unsupported sample format".to_string()),
            },
        };
        info(Component::Audio, &format!("🎙️ [RECORDER] WAV spec created - {} Hz, {} channels, {} bits", 
            wav_spec.sample_rate, wav_spec.channels, wav_spec.bits_per_sample));

        // Create the WAV writer
        info(Component::Audio, &format!("🎙️ [RECORDER] Creating WAV writer at path: {:?}", path));
        let writer = WavWriter::create(path, wav_spec)
            .map_err(|e| format!("Failed to create WAV file: {}", e))?;
        info(Component::Audio, "🎙️ [RECORDER] WAV writer created successfully");
        
        // CRITICAL FIX: Store the writer in self.writer FIRST
        *self.writer.lock().unwrap() = Some(writer);
        info(Component::Audio, "🎙️ [RECORDER] Writer stored in self.writer");

        // Clone for the closure - now using self.writer instead of local variable
        let writer_clone = self.writer.clone();
        let state_clone = self.state.clone();
        let is_recording = self.is_recording.clone();
        let callback_count = self.callback_count.clone();
        let total_samples = self.total_samples.clone();
        
        // Build the stream - let CPAL handle everything
        info(Component::Audio, &format!("🎙️ [RECORDER] Building CPAL stream with format: {:?}", config.sample_format()));
        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => {
                info(Component::Audio, "🎙️ [RECORDER] Building F32 stream");
                device.build_input_stream(
                    &config.into(),
                    move |data: &[f32], _| {
                        // Increment callback counter
                        let callback_num = callback_count.fetch_add(1, Ordering::SeqCst) + 1;
                        
                        // Only process if recording
                        if !is_recording.load(Ordering::SeqCst) {
                            debug(Component::Audio, &format!("🎙️ [CALLBACK-{}] Not recording, skipping {} samples", callback_num, data.len()));
                            return;
                        }
                        
                        debug(Component::Audio, &format!("🎙️ [CALLBACK-{}] Received {} F32 samples", callback_num, data.len()));
                        
                        if let Ok(mut writer_guard) = writer_clone.try_lock() {
                            if let Some(ref mut writer) = *writer_guard {
                                let mut write_count = 0;
                                for &sample in data {
                                    if writer.write_sample(sample).is_ok() {
                                        write_count += 1;
                                    }
                                }
                                
                                // Update total samples counter
                                let new_total = total_samples.fetch_add(write_count, Ordering::SeqCst) + write_count;
                                
                                debug(Component::Audio, &format!("🎙️ [CALLBACK-{}] Wrote {} samples to WAV (total: {})", 
                                    callback_num, write_count, new_total));
                                
                                // Update sample count in state
                                if let Ok(mut state) = state_clone.try_lock() {
                                    if let RecorderState::Recording { samples_written, .. } = &mut *state {
                                        *samples_written += write_count;
                                        debug(Component::Audio, &format!("🎙️ [CALLBACK-{}] Updated state samples_written to {}", 
                                            callback_num, *samples_written));
                                    }
                                }
                            } else {
                                warn(Component::Audio, &format!("🎙️ [CALLBACK-{}] Writer is None!", callback_num));
                            }
                        } else {
                            warn(Component::Audio, &format!("🎙️ [CALLBACK-{}] Failed to lock writer", callback_num));
                        }
                    },
                    |err| error(Component::Audio, &format!("🎙️ [STREAM ERROR] {}", err)),
                    None,
                )
            }
            cpal::SampleFormat::I16 => {
                info(Component::Audio, "🎙️ [RECORDER] Building I16 stream");
                device.build_input_stream(
                    &config.into(),
                    move |data: &[i16], _| {
                        // Increment callback counter
                        let callback_num = callback_count.fetch_add(1, Ordering::SeqCst) + 1;
                        
                        // Only process if recording
                        if !is_recording.load(Ordering::SeqCst) {
                            debug(Component::Audio, &format!("🎙️ [CALLBACK-{}] Not recording, skipping {} samples", callback_num, data.len()));
                            return;
                        }
                        
                        debug(Component::Audio, &format!("🎙️ [CALLBACK-{}] Received {} I16 samples", callback_num, data.len()));
                        
                        if let Ok(mut writer_guard) = writer_clone.try_lock() {
                            if let Some(ref mut writer) = *writer_guard {
                                let mut write_count = 0;
                                for &sample in data {
                                    if writer.write_sample(sample).is_ok() {
                                        write_count += 1;
                                    }
                                }
                                
                                // Update total samples counter
                                let new_total = total_samples.fetch_add(write_count, Ordering::SeqCst) + write_count;
                                
                                debug(Component::Audio, &format!("🎙️ [CALLBACK-{}] Wrote {} samples to WAV (total: {})", 
                                    callback_num, write_count, new_total));
                                
                                // Update sample count in state
                                if let Ok(mut state) = state_clone.try_lock() {
                                    if let RecorderState::Recording { samples_written, .. } = &mut *state {
                                        *samples_written += write_count;
                                        debug(Component::Audio, &format!("🎙️ [CALLBACK-{}] Updated state samples_written to {}", 
                                            callback_num, *samples_written));
                                    }
                                }
                            } else {
                                warn(Component::Audio, &format!("🎙️ [CALLBACK-{}] Writer is None!", callback_num));
                            }
                        } else {
                            warn(Component::Audio, &format!("🎙️ [CALLBACK-{}] Failed to lock writer", callback_num));
                        }
                    },
                    |err| error(Component::Audio, &format!("🎙️ [STREAM ERROR] {}", err)),
                    None,
                )
            }
            _ => return Err("Unsupported sample format".to_string()),
        }
        .map_err(|e| format!("Failed to build stream: {}", e))?;
        info(Component::Audio, "🎙️ [RECORDER] Stream built successfully");

        // Start the stream
        info(Component::Audio, "🎙️ [RECORDER] Starting CPAL stream");
        stream.play().map_err(|e| format!("Failed to start stream: {}", e))?;
        info(Component::Audio, "🎙️ [RECORDER] CPAL stream started successfully");

        // IMPORTANT: We leak the stream to keep it alive
        // This is a simple solution to maintain Send+Sync compatibility
        // The stream will continue running until stop_recording is called
        info(Component::Audio, "🎙️ [RECORDER] Leaking stream to keep it alive (will be cleaned on process exit)");
        std::mem::forget(stream);

        // Update state
        self.is_recording.store(true, Ordering::SeqCst);
        info(Component::Audio, "🎙️ [RECORDER] Set is_recording flag to true");
        
        // Note: writer is already in self.writer, no need to move it again
        
        *self.state.lock().unwrap() = RecorderState::Recording {
            path: path.to_path_buf(),
            start_time: Instant::now(),
            samples_written: 0,
            sample_rate: wav_spec.sample_rate,
            channels: wav_spec.channels,
        };
        info(Component::Audio, &format!("🎙️ [RECORDER] Updated state to Recording with sample_rate: {}, channels: {}", 
            wav_spec.sample_rate, wav_spec.channels));

        info(Component::Audio, "🎙️ [RECORDER] ========== RECORDING STARTED ==========");
        Ok(())
    }

    /// Stop recording and return info about the recording
    pub fn stop_recording(&self) -> Result<RecordingInfo, String> {
        info(Component::Audio, "🎙️ [RECORDER] ========== STOP RECORDING ==========");
        
        // Log current counters
        let callback_total = self.callback_count.load(Ordering::SeqCst);
        let samples_total = self.total_samples.load(Ordering::SeqCst);
        info(Component::Audio, &format!("🎙️ [RECORDER] Total callbacks received: {}", callback_total));
        info(Component::Audio, &format!("🎙️ [RECORDER] Total samples written: {}", samples_total));
        
        // Get recording info before stopping
        let recording_info = {
            let state = self.state.lock().unwrap();
            match &*state {
                RecorderState::Recording { 
                    path, 
                    samples_written, 
                    sample_rate, 
                    channels, 
                    start_time,
                    .. 
                } => {
                    let elapsed = start_time.elapsed();
                    info(Component::Audio, &format!("🎙️ [RECORDER] Recording duration: {:.2}s", elapsed.as_secs_f64()));
                    info(Component::Audio, &format!("🎙️ [RECORDER] State samples_written: {}", samples_written));
                    info(Component::Audio, &format!("🎙️ [RECORDER] Sample rate: {} Hz, Channels: {}", sample_rate, channels));
                    
                    RecordingInfo {
                        path: path.clone(),
                        duration_samples: *samples_written / *channels as u64,
                        duration_seconds: (*samples_written as f64) / (*sample_rate as f64 * *channels as f64),
                        sample_rate: *sample_rate,
                        channels: *channels,
                    }
                },
                RecorderState::Idle => {
                    warn(Component::Audio, "🎙️ [RECORDER] Not recording, cannot stop");
                    return Err("Not recording".to_string());
                },
            }
        };

        // Stop recording
        info(Component::Audio, "🎙️ [RECORDER] Setting is_recording flag to false");
        self.is_recording.store(false, Ordering::SeqCst);

        // Finalize the WAV file
        info(Component::Audio, "🎙️ [RECORDER] Finalizing WAV file");
        if let Some(writer) = self.writer.lock().unwrap().take() {
            info(Component::Audio, "🎙️ [RECORDER] Writer found, calling finalize()");
            writer.finalize().map_err(|e| {
                error(Component::Audio, &format!("🎙️ [RECORDER] Failed to finalize WAV: {}", e));
                format!("Failed to finalize WAV: {}", e)
            })?;
            info(Component::Audio, "🎙️ [RECORDER] WAV file finalized successfully");
        } else {
            warn(Component::Audio, "🎙️ [RECORDER] No writer found to finalize!");
        }

        // Reset state
        *self.state.lock().unwrap() = RecorderState::Idle;
        info(Component::Audio, "🎙️ [RECORDER] State reset to Idle");
        
        info(Component::Audio, &format!("🎙️ [RECORDER] Recording info - path: {:?}, duration: {:.2}s, samples: {}", 
            recording_info.path, recording_info.duration_seconds, recording_info.duration_samples));
        info(Component::Audio, "🎙️ [RECORDER] ========== RECORDING STOPPED ==========");

        Ok(recording_info)
    }

    /// Check if recording
    pub fn is_recording(&self) -> bool {
        self.is_recording.load(Ordering::SeqCst)
    }

    /// Get current audio level (placeholder for now)
    pub fn get_audio_level(&self) -> f32 {
        // TODO: Implement if needed
        0.0
    }
}

impl Drop for SimpleCpalRecorder {
    fn drop(&mut self) {
        // Make sure any active recording is stopped
        if self.is_recording() {
            let _ = self.stop_recording();
        }
    }
}

// Mark as Send + Sync since we don't store the Stream directly
unsafe impl Send for SimpleCpalRecorder {}
unsafe impl Sync for SimpleCpalRecorder {}
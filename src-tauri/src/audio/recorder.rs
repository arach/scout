use std::path::Path;
use std::sync::{Arc, Mutex, Condvar};
use std::thread;
use std::sync::mpsc;
use std::any::TypeId;
use std::time::Duration;
use super::vad::VoiceActivityDetector;
use crate::logger::{info, debug, warn, error, Component};

// Type alias for sample callback
pub type SampleCallback = Arc<dyn Fn(&[f32]) + Send + Sync>;

pub struct AudioRecorder {
    control_tx: Option<mpsc::Sender<RecorderCommand>>,
    is_recording: Arc<Mutex<bool>>,
    vad_enabled: Arc<Mutex<bool>>,
    current_audio_level: Arc<Mutex<f32>>,
    current_device_info: Arc<Mutex<Option<DeviceInfo>>>,
    sample_callback: Arc<Mutex<Option<SampleCallback>>>,
    // Synchronization for recording state changes
    recording_state_changed: Arc<Condvar>,
}

#[derive(Debug, Clone)]
pub struct DeviceInfo {
    pub name: String,
    pub sample_rate: u32,
    pub channels: u16,
}

enum RecorderCommand {
    StartRecording(String, Option<String>), // (path, device_name)
    StopRecording,
    SetVadEnabled(bool),
    StartAudioLevelMonitoring(Option<String>), // device_name
    StopAudioLevelMonitoring,
    SetSampleCallback(Option<SampleCallback>),
}

impl AudioRecorder {
    pub fn new() -> Self {
        Self {
            control_tx: None,
            is_recording: Arc::new(Mutex::new(false)),
            vad_enabled: Arc::new(Mutex::new(false)),
            current_audio_level: Arc::new(Mutex::new(0.0)),
            current_device_info: Arc::new(Mutex::new(None)),
            sample_callback: Arc::new(Mutex::new(None)),
            recording_state_changed: Arc::new(Condvar::new()),
        }
    }
    
    pub fn get_current_device_info(&self) -> Option<DeviceInfo> {
        self.current_device_info.lock()
            .map(|guard| guard.clone())
            .unwrap_or_else(|_| {
                error(Component::Recording, "Failed to acquire device info lock - returning None");
                None
            })
    }
    
    pub fn get_current_audio_level(&self) -> f32 {
        self.current_audio_level.lock()
            .map(|guard| *guard)
            .unwrap_or_else(|_| {
                error(Component::Recording, "Failed to acquire audio level lock - returning 0.0");
                0.0
            })
    }

    pub fn init(&mut self) {
        let (tx, rx) = mpsc::channel();
        self.control_tx = Some(tx);
        let is_recording = self.is_recording.clone();
        let vad_enabled = self.vad_enabled.clone();
        let audio_level = self.current_audio_level.clone();
        let device_info = self.current_device_info.clone();
        let sample_callback = self.sample_callback.clone();
        let recording_state_changed = self.recording_state_changed.clone();

        thread::spawn(move || {
            let mut recorder = AudioRecorderWorker::new(is_recording, vad_enabled, audio_level, device_info, sample_callback, recording_state_changed);
            
            while let Ok(cmd) = rx.recv() {
                match cmd {
                    RecorderCommand::StartRecording(path, device_name) => {
                        if let Err(e) = recorder.start_recording(&path, device_name.as_deref()) {
                            error(Component::Recording, &format!("Failed to start recording: {}", e));
                        }
                    }
                    RecorderCommand::StopRecording => {
                        if let Err(e) = recorder.stop_recording() {
                            error(Component::Recording, &format!("Failed to stop recording: {}", e));
                        }
                    }
                    RecorderCommand::SetVadEnabled(enabled) => {
                        *recorder.vad_enabled.lock().unwrap() = enabled;
                    }
                    RecorderCommand::StartAudioLevelMonitoring(device_name) => {
                        if let Err(e) = recorder.start_audio_level_monitoring(device_name.as_deref()) {
                            error(Component::Recording, &format!("Failed to start audio level monitoring: {}", e));
                        }
                    }
                    RecorderCommand::StopAudioLevelMonitoring => {
                        if let Err(e) = recorder.stop_audio_level_monitoring() {
                            error(Component::Recording, &format!("Failed to stop audio level monitoring: {}", e));
                        }
                    }
                    RecorderCommand::SetSampleCallback(callback) => {
                        *recorder.sample_callback.lock().unwrap() = callback;
                    }
                }
            }
        });
    }

    pub fn start_recording(&self, output_path: &Path, device_name: Option<&str>) -> Result<(), String> {
        if self.control_tx.is_none() {
            return Err("Recorder not initialized".to_string());
        }

        let start_time = std::time::Instant::now();
        info(Component::Recording, &format!("AudioRecorder::start_recording called at {:?}", start_time));

        let result = self.control_tx
            .as_ref()
            .unwrap()
            .send(RecorderCommand::StartRecording(
                output_path.to_string_lossy().to_string(),
                device_name.map(|s| s.to_string()),
            ))
            .map_err(|e| format!("Failed to send start command: {}", e));
        
        let elapsed = start_time.elapsed();
        info(Component::Recording, &format!("AudioRecorder::start_recording command sent in {:?}", elapsed));
        
        result
    }

    pub fn stop_recording(&self) -> Result<(), String> {
        if self.control_tx.is_none() {
            return Err("Recorder not initialized".to_string());
        }

        let start_time = std::time::Instant::now();
        info(Component::Recording, &format!("AudioRecorder::stop_recording called at {:?}", start_time));

        // Clear the recording state immediately to prevent race conditions
        // This ensures that any concurrent is_recording() calls will return false
        info(Component::Recording, "AudioRecorder::stop_recording - clearing state immediately");
        *self.is_recording.lock().unwrap() = false;

        // Send stop command to the worker thread
        self.control_tx
            .as_ref()
            .unwrap()
            .send(RecorderCommand::StopRecording)
            .map_err(|e| {
                // If we fail to send the command, restore the state
                *self.is_recording.lock().unwrap() = true;
                format!("Failed to send stop command: {}", e)
            })?;
            
        let command_sent_time = start_time.elapsed();
        info(Component::Recording, &format!("AudioRecorder::stop_recording command sent in {:?}", command_sent_time));
            
        // Wait for the recording state to actually change instead of using sleep
        let wait_start = std::time::Instant::now();
        let _guard = self.recording_state_changed
            .wait_timeout(
                self.is_recording.lock().unwrap(),
                Duration::from_millis(100)
            ).unwrap();
        
        let wait_time = wait_start.elapsed();
        let total_time = start_time.elapsed();
        info(Component::Recording, &format!("AudioRecorder::stop_recording synchronization completed in {:?}, total time: {:?}", wait_time, total_time));
        
        // The worker thread will also clear the state, but we've already done it
        // to prevent race conditions with concurrent state queries
        
        Ok(())
    }

    pub fn is_recording(&self) -> bool {
        *self.is_recording.lock().unwrap()
    }

    pub fn set_vad_enabled(&self, enabled: bool) -> Result<(), String> {
        if self.control_tx.is_none() {
            return Err("Recorder not initialized".to_string());
        }

        self.control_tx
            .as_ref()
            .unwrap()
            .send(RecorderCommand::SetVadEnabled(enabled))
            .map_err(|e| format!("Failed to send VAD command: {}", e))
    }

    pub fn is_vad_enabled(&self) -> bool {
        *self.vad_enabled.lock().unwrap()
    }
    
    pub fn set_sample_callback(&self, callback: Option<SampleCallback>) -> Result<(), String> {
        if self.control_tx.is_none() {
            return Err("Recorder not initialized".to_string());
        }

        self.control_tx
            .as_ref()
            .unwrap()
            .send(RecorderCommand::SetSampleCallback(callback))
            .map_err(|e| format!("Failed to send sample callback command: {}", e))
    }
    
    pub fn start_audio_level_monitoring(&self, device_name: Option<&str>) -> Result<(), String> {
        if self.control_tx.is_none() {
            return Err("Recorder not initialized".to_string());
        }

        self.control_tx
            .as_ref()
            .unwrap()
            .send(RecorderCommand::StartAudioLevelMonitoring(
                device_name.map(|s| s.to_string()),
            ))
            .map_err(|e| format!("Failed to send audio level monitoring command: {}", e))
    }
    
    pub fn stop_audio_level_monitoring(&self) -> Result<(), String> {
        if self.control_tx.is_none() {
            return Err("Recorder not initialized".to_string());
        }

        self.control_tx
            .as_ref()
            .unwrap()
            .send(RecorderCommand::StopAudioLevelMonitoring)
            .map_err(|e| format!("Failed to send stop audio level monitoring command: {}", e))
    }
}

struct AudioRecorderWorker {
    stream: Option<cpal::Stream>,
    monitoring_stream: Option<cpal::Stream>,
    writer: Arc<Mutex<Option<hound::WavWriter<std::io::BufWriter<std::fs::File>>>>>,
    is_recording: Arc<Mutex<bool>>,
    vad_enabled: Arc<Mutex<bool>>,
    vad: Option<VoiceActivityDetector>,
    sample_count: Arc<Mutex<u64>>,
    sample_rate: u32,
    channels: u16,
    sample_format: Option<cpal::SampleFormat>,
    current_audio_level: Arc<Mutex<f32>>,
    current_device_info: Arc<Mutex<Option<DeviceInfo>>>,
    sample_callback: Arc<Mutex<Option<SampleCallback>>>,
    recording_state_changed: Arc<Condvar>,
}

impl AudioRecorderWorker {
    fn new(is_recording: Arc<Mutex<bool>>, vad_enabled: Arc<Mutex<bool>>, audio_level: Arc<Mutex<f32>>, device_info: Arc<Mutex<Option<DeviceInfo>>>, sample_callback: Arc<Mutex<Option<SampleCallback>>>, recording_state_changed: Arc<Condvar>) -> Self {
        Self {
            stream: None,
            monitoring_stream: None,
            writer: Arc::new(Mutex::new(None)),
            is_recording,
            vad_enabled,
            vad: None,
            sample_count: Arc::new(Mutex::new(0)),
            sample_rate: 48000, // default, will be updated when recording starts
            channels: 1, // default, will be updated when recording starts
            sample_format: None,
            current_audio_level: audio_level,
            current_device_info: device_info,
            sample_callback,
            recording_state_changed,
        }
    }

    fn start_recording(&mut self, output_path: &str, device_name: Option<&str>) -> Result<(), String> {
        use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

        // Stop monitoring if it's running but preserve the audio level
        if self.monitoring_stream.is_some() {
            // Don't reset audio level when transitioning from monitoring to recording
            if let Some(stream) = self.monitoring_stream.take() {
                drop(stream);
            }
        }

        let host = cpal::default_host();
        
        let device = match device_name {
            Some(name) => {
                info(Component::Recording, &format!("Attempting to use specified device: '{}'", name));
                
                // Find device by name
                let devices = host.input_devices()
                    .map_err(|e| format!("Failed to enumerate devices: {}", e))?;
                
                // List all available devices for debugging
                info(Component::Recording, "Available input devices:");
                let devices_vec: Vec<_> = devices.collect();
                for (i, device) in devices_vec.iter().enumerate() {
                    let device_name = device.name().unwrap_or_else(|_| "Unknown".to_string());
                    info(Component::Recording, &format!("  [{}] {}", i, device_name));
                }
                
                // Find the requested device
                let selected_device = devices_vec.into_iter()
                    .find(|d| d.name().map(|n| n == name).unwrap_or(false))
                    .ok_or_else(|| format!("Device '{}' not found", name))?;
                
                let actual_name = selected_device.name().unwrap_or_else(|_| "Unknown".to_string());
                info(Component::Recording, &format!("Selected device: '{}'", actual_name));
                selected_device
            },
            None => {
                info(Component::Recording, "Using default input device");
                
                // Use default device
                let default_device = host.default_input_device()
                    .ok_or("No input device available - please check microphone permissions")?;
                
                let device_name = default_device.name().unwrap_or_else(|_| "Unknown".to_string());
                info(Component::Recording, &format!("Default device: '{}'", device_name));
                
                // Log if this looks like AirPods
                if device_name.to_lowercase().contains("airpod") {
                    warn(Component::Recording, "AirPods detected - may experience audio quality issues");
                    info(Component::Recording, "Recommendation: Use a wired microphone for best results");
                }
                
                default_device
            }
        };


        let default_config = device
            .default_input_config()
            .map_err(|e| format!("Failed to get input config: {}", e))?;

        // Log detailed device information
        let device_name_for_metadata = device.name().unwrap_or_else(|_| "Unknown".to_string());
        info(Component::Recording, "Device details:");
        info(Component::Recording, &format!("  Name: {}", device_name_for_metadata));
        info(Component::Recording, &format!("  Sample Rate: {} Hz", default_config.sample_rate().0));
        info(Component::Recording, &format!("  Channels: {}", default_config.channels()));
        info(Component::Recording, &format!("  Format: {:?}", default_config.sample_format()));

        // Try stereo first, fallback to device capabilities if not supported
        let mut channels = 2; // Prefer stereo
        
        // Check if device supports stereo
        if let Ok(mut supported_configs) = device.supported_input_configs() {
            let stereo_supported = supported_configs
                .any(|supported_range| {
                    supported_range.channels() >= 2 &&
                    supported_range.min_sample_rate().0 <= default_config.sample_rate().0 &&
                    supported_range.max_sample_rate().0 >= default_config.sample_rate().0
                });
            
            if !stereo_supported {
                info(Component::Recording, "Device doesn't support stereo input, falling back to mono");
                channels = default_config.channels();
            }
        } else {
            info(Component::Recording, "Couldn't check device capabilities, using device default");
            channels = default_config.channels();
        }

        // Use a fixed low-latency buffer size of 128 samples for optimal performance
        // At 48kHz, this provides ~2.67ms latency vs potentially 10-100ms with Default
        let config = cpal::StreamConfig {
            channels,
            sample_rate: default_config.sample_rate(),
            buffer_size: cpal::BufferSize::Fixed(128),
        };

        // Store sample rate, channels, and format for later use
        self.sample_rate = config.sample_rate.0;
        self.channels = channels;
        self.sample_format = Some(default_config.sample_format());
        
        // Store device info for metadata
        let device_info = DeviceInfo {
            name: device_name_for_metadata.clone(),
            sample_rate: config.sample_rate.0,
            channels,
        };
        *self.current_device_info.lock().unwrap() = Some(device_info);
        
        info(Component::Recording, &format!("Recording started with device: {}", device_name_for_metadata));
        
        // Reset sample count
        *self.sample_count.lock().unwrap() = 0;

        // Match the WAV spec to the actual audio format
        let (bits_per_sample, sample_format) = match default_config.sample_format() {
            cpal::SampleFormat::I16 => (16, hound::SampleFormat::Int),
            cpal::SampleFormat::F32 => (32, hound::SampleFormat::Float),
            _ => return Err("Unsupported sample format".to_string()),
        };
        
        let spec = hound::WavSpec {
            channels: config.channels, // Use actual recording channels
            sample_rate: config.sample_rate.0,
            bits_per_sample,
            sample_format,
        };

        // Initialize VAD if enabled
        if *self.vad_enabled.lock().unwrap() {
            self.vad = Some(VoiceActivityDetector::new(config.sample_rate.0)?);
        }

        let writer = hound::WavWriter::create(output_path, spec)
            .map_err(|e| format!("Failed to create WAV writer: {}", e))?;


        let writer = Arc::new(Mutex::new(Some(writer)));
        self.writer = writer.clone();

        let is_recording = self.is_recording.clone();
        *is_recording.lock().unwrap() = true;

        let err_fn = |err| error(Component::Recording, &format!("An error occurred on the audio stream: {}", err));

        let stream = match default_config.sample_format() {
            cpal::SampleFormat::I16 => self.build_input_stream::<i16>(
                &device,
                &config,
                writer.clone(),
                is_recording.clone(),
                self.sample_count.clone(),
                self.current_audio_level.clone(),
                self.sample_callback.clone(),
                err_fn,
            ),
            cpal::SampleFormat::U16 => {
                return Err("U16 sample format not supported".to_string());
            }
            cpal::SampleFormat::F32 => self.build_input_stream::<f32>(
                &device,
                &config,
                writer.clone(),
                is_recording.clone(),
                self.sample_count.clone(),
                self.current_audio_level.clone(),
                self.sample_callback.clone(),
                err_fn,
            ),
            _ => return Err("Unsupported sample format".to_string()),
        }?;

        
        stream
            .play()
            .map_err(|e| format!("Failed to play stream: {}", e))?;

        
        self.stream = Some(stream);
        Ok(())
    }

    fn stop_recording(&mut self) -> Result<(), String> {
        info(Component::Recording, &format!("AudioRecorder::stop_recording called at {}", chrono::Local::now().format("%H:%M:%S%.3f")));
        
        // Set recording to false and notify waiting threads
        {
            let mut recording = self.is_recording.lock().unwrap();
            *recording = false;
            self.recording_state_changed.notify_all();
        }
        debug(Component::Recording, "Set is_recording to false and notified waiters");
        
        // Reset audio level only after recording stops
        *self.current_audio_level.lock().unwrap() = 0.0;

        // Drop the stream immediately - the stream itself handles proper shutdown
        if let Some(stream) = self.stream.take() {
            drop(stream);
        }

        // Check if we need to pad with silence
        let total_samples = *self.sample_count.lock().unwrap();
        let duration_seconds = total_samples as f32 / self.sample_rate as f32 / self.channels as f32;
        
        if duration_seconds < 1.0 && self.writer.lock().unwrap().is_some() {
            // Calculate how many silence samples we need to reach 1.1 seconds (with a small buffer)
            let target_samples = (self.sample_rate as f64 * self.channels as f64 * 1.1) as u64; // 1.1 seconds worth
            let silence_samples_needed = target_samples.saturating_sub(total_samples);
            
            if silence_samples_needed > 0 {
                
                // Write silence samples
                if let Some(ref mut writer) = *self.writer.lock().unwrap() {
                    match self.sample_format {
                        Some(cpal::SampleFormat::F32) => {
                            for _ in 0..silence_samples_needed {
                                writer.write_sample(0.0f32).ok();
                            }
                        }
                        Some(cpal::SampleFormat::I16) => {
                            for _ in 0..silence_samples_needed {
                                writer.write_sample(0i16).ok();
                            }
                        }
                        _ => {
                            // Default to i16 if format is unknown
                            for _ in 0..silence_samples_needed {
                                writer.write_sample(0i16).ok();
                            }
                        }
                    }
                }
            }
        }

        if let Some(writer) = self.writer.lock().unwrap().take() {
            writer
                .finalize()
                .map_err(|e| format!("Failed to finalize recording: {}", e))?;
        }

        Ok(())
    }

    fn build_input_stream<T>(
        &self,
        device: &cpal::Device,
        config: &cpal::StreamConfig,
        writer: Arc<Mutex<Option<hound::WavWriter<std::io::BufWriter<std::fs::File>>>>>,
        is_recording: Arc<Mutex<bool>>,
        sample_count: Arc<Mutex<u64>>,
        audio_level: Arc<Mutex<f32>>,
        sample_callback: Arc<Mutex<Option<SampleCallback>>>,
        err_fn: impl FnMut(cpal::StreamError) + Send + 'static,
    ) -> Result<cpal::Stream, String>
    where
        T: cpal::Sample + cpal::SizedSample + hound::Sample + Send + 'static,
    {
        use cpal::traits::DeviceTrait;
        
        device
            .build_input_stream(
                config,
                move |data: &[T], _: &cpal::InputCallbackInfo| {
                    if *is_recording.lock().unwrap() {
                        // Calculate RMS (Root Mean Square) level for volume
                        let mut sum_squares = 0.0f32;
                        
                        // Convert samples to f32 for RMS calculation
                        if TypeId::of::<T>() == TypeId::of::<f32>() {
                            // For f32 samples
                            for &sample in data.iter() {
                                let s = unsafe { *(&sample as *const T as *const f32) };
                                sum_squares += s * s;
                            }
                        } else if TypeId::of::<T>() == TypeId::of::<i16>() {
                            // For i16 samples
                            for &sample in data.iter() {
                                let s = unsafe { *(&sample as *const T as *const i16) } as f32 / 32768.0;
                                sum_squares += s * s;
                            }
                        }
                        
                        let rms = (sum_squares / data.len() as f32).sqrt();
                        
                        // Amplify the RMS value for better visual response
                        // Most speech is quite low in amplitude, so we need to scale it up
                        let amplified_rms = (rms * 40.0).min(1.0);  // Increased to 40x for better sensitivity
                        
                        // Debug logging for audio levels (only log significant changes)
                        // Commented out to reduce noise
                        // if rms > 0.001 {
                        // }
                        
                        // Update audio level (with some smoothing)
                        let current_level = *audio_level.lock().unwrap();
                        let new_level = current_level * 0.7 + amplified_rms * 0.3; // Smooth the level changes
                        *audio_level.lock().unwrap() = new_level; // Already capped by amplified_rms
                        
                        if let Some(ref mut writer) = *writer.lock().unwrap() {
                            let samples_written = data.len();
                            for &sample in data.iter() {
                                writer.write_sample(sample).ok();
                            }
                            *sample_count.lock().unwrap() += samples_written as u64;
                        }
                        
                        // Call sample callback for ring buffer processing
                        if let Some(ref callback) = *sample_callback.lock().unwrap() {
                            // Convert samples to f32 for consistent callback interface
                            let f32_samples: Vec<f32> = if TypeId::of::<T>() == TypeId::of::<f32>() {
                                // Already f32 - just copy
                                data.iter().map(|&sample| unsafe { *(&sample as *const T as *const f32) }).collect()
                            } else if TypeId::of::<T>() == TypeId::of::<i16>() {
                                // Convert i16 to f32
                                data.iter().map(|&sample| {
                                    let s = unsafe { *(&sample as *const T as *const i16) };
                                    s as f32 / 32768.0
                                }).collect()
                            } else {
                                // Fallback - should not happen with our current support
                                Vec::new()
                            };
                            
                            if !f32_samples.is_empty() {
                                callback(&f32_samples);
                            }
                        }
                    }
                },
                err_fn,
                None,
            )
            .map_err(|e| format!("Failed to build input stream: {}", e))
    }
    
    fn start_audio_level_monitoring(&mut self, device_name: Option<&str>) -> Result<(), String> {
        use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
        
        // Stop any existing monitoring
        if self.monitoring_stream.is_some() {
            self.stop_audio_level_monitoring()?;
        }
        
        let host = cpal::default_host();
        
        let device = match device_name {
            Some(name) => {
                // Find device by name
                let devices = host.input_devices()
                    .map_err(|e| format!("Failed to enumerate devices: {}", e))?;
                
                devices.into_iter()
                    .find(|d| d.name().map(|n| n == name).unwrap_or(false))
                    .ok_or_else(|| format!("Device '{}' not found", name))?
            },
            None => {
                // Use default device
                host.default_input_device()
                    .ok_or("No input device available")?
            }
        };
        
        let config = device
            .default_input_config()
            .map_err(|e| format!("Failed to get input config: {}", e))?;
            
        let audio_level = self.current_audio_level.clone();
        
        let err_fn = |err| error(Component::Recording, &format!("Audio level monitoring error: {}", err));
        
        // Build monitoring stream based on sample format
        let monitoring_stream = match config.sample_format() {
            cpal::SampleFormat::F32 => self.build_monitoring_stream::<f32>(&device, &config.into(), audio_level, err_fn),
            cpal::SampleFormat::I16 => self.build_monitoring_stream::<i16>(&device, &config.into(), audio_level, err_fn),
            _ => return Err("Unsupported sample format".to_string()),
        }?;
        
        monitoring_stream.play()
            .map_err(|e| format!("Failed to start monitoring stream: {}", e))?;
            
        self.monitoring_stream = Some(monitoring_stream);
        
        Ok(())
    }
    
    fn stop_audio_level_monitoring(&mut self) -> Result<(), String> {
        if let Some(stream) = self.monitoring_stream.take() {
            drop(stream);
        }
        
        // Reset audio level to 0
        *self.current_audio_level.lock().unwrap() = 0.0;
        
        Ok(())
    }
    
    fn build_monitoring_stream<T>(
        &self,
        device: &cpal::Device,
        config: &cpal::StreamConfig,
        audio_level: Arc<Mutex<f32>>,
        err_fn: impl FnMut(cpal::StreamError) + Send + 'static + Copy,
    ) -> Result<cpal::Stream, String>
    where
        T: cpal::Sample + cpal::SizedSample + Into<f32> + Send + 'static,
    {
        use cpal::traits::DeviceTrait;
        
        device.build_input_stream(
            config,
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                // Calculate RMS
                let sum_squares: f32 = data.iter()
                    .map(|&s| {
                        let sample_f32: f32 = s.into();
                        sample_f32 * sample_f32
                    })
                    .sum();
                    
                let rms = (sum_squares / data.len() as f32).sqrt();
                
                // Amplify for better response
                let amplified_rms = (rms * 40.0).min(1.0);
                
                // Update audio level with smoothing
                let current_level = *audio_level.lock().unwrap();
                let new_level = current_level * 0.7 + amplified_rms * 0.3;
                *audio_level.lock().unwrap() = new_level;
            },
            err_fn,
            None,
        )
        .map_err(|e| format!("Failed to build monitoring stream: {}", e))
    }
}
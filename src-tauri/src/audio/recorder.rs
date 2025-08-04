use super::device_monitor::{CapabilityCheckResult, DeviceCapabilityChecker, DeviceMonitor};
use super::format::NativeAudioFormat;
use super::metadata::AudioMetadata;
use super::notifications::notify_airpods_detected;
use super::validation::{AudioFormatValidator, CallbackInfo, ValidationResult};
use crate::logger::{debug, error, info, warn, Component};
use std::any::TypeId;
use std::path::Path;
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

// Type alias for sample callback
pub type SampleCallback = Arc<dyn Fn(&[f32]) + Send + Sync>;

// Validation data passed from callback to worker
#[derive(Debug)]
struct CallbackValidationData {
    samples: Vec<f32>,
    callback_time: Instant,
    sample_count: usize,
}

type ValidationDataSender = Arc<Mutex<Option<std::sync::mpsc::Sender<CallbackValidationData>>>>;

pub struct AudioRecorder {
    control_tx: Option<mpsc::Sender<RecorderCommand>>,
    is_recording: Arc<Mutex<bool>>,
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
    pub metadata: Option<AudioMetadata>,
}

enum RecorderCommand {
    StartRecording(String, Option<String>), // (path, device_name)
    StopRecording,
    StartAudioLevelMonitoring(Option<String>), // device_name
    StopAudioLevelMonitoring,
    SetSampleCallback(Option<SampleCallback>),
}

impl AudioRecorder {
    pub fn new() -> Self {
        Self {
            control_tx: None,
            is_recording: Arc::new(Mutex::new(false)),
            current_audio_level: Arc::new(Mutex::new(0.0)),
            current_device_info: Arc::new(Mutex::new(None)),
            sample_callback: Arc::new(Mutex::new(None)),
            recording_state_changed: Arc::new(Condvar::new()),
        }
    }

    pub fn get_current_device_info(&self) -> Option<DeviceInfo> {
        self.current_device_info
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_else(|_| {
                error(
                    Component::Recording,
                    "Failed to acquire device info lock - returning None",
                );
                None
            })
    }

    pub fn get_current_metadata(&self) -> Option<AudioMetadata> {
        self.current_device_info
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().and_then(|info| info.metadata.clone()))
    }

    pub fn get_current_audio_level(&self) -> f32 {
        self.current_audio_level
            .lock()
            .map(|guard| *guard)
            .unwrap_or_else(|_| {
                error(
                    Component::Recording,
                    "Failed to acquire audio level lock - returning 0.0",
                );
                0.0
            })
    }

    pub fn init(&mut self) {
        // Eagerly probe device capabilities to ensure we have device info available
        self.probe_and_cache_device_info();
        
        let (tx, rx) = mpsc::channel();
        self.control_tx = Some(tx);
        let is_recording = self.is_recording.clone();
        let audio_level = self.current_audio_level.clone();
        let device_info = self.current_device_info.clone();
        let sample_callback = self.sample_callback.clone();
        let recording_state_changed = self.recording_state_changed.clone();

        thread::spawn(move || {
            let mut recorder = AudioRecorderWorker::new(
                is_recording,
                audio_level,
                device_info,
                sample_callback,
                recording_state_changed,
            );

            while let Ok(cmd) = rx.recv() {
                match cmd {
                    RecorderCommand::StartRecording(path, device_name) => {
                        if let Err(e) = recorder.start_recording(&path, device_name.as_deref()) {
                            error(
                                Component::Recording,
                                &format!("Failed to start recording: {}", e),
                            );
                        }
                    }
                    RecorderCommand::StopRecording => {
                        if let Err(e) = recorder.stop_recording() {
                            error(
                                Component::Recording,
                                &format!("Failed to stop recording: {}", e),
                            );
                        }
                    }
                    RecorderCommand::StartAudioLevelMonitoring(device_name) => {
                        if let Err(e) =
                            recorder.start_audio_level_monitoring(device_name.as_deref())
                        {
                            error(
                                Component::Recording,
                                &format!("Failed to start audio level monitoring: {}", e),
                            );
                        }
                    }
                    RecorderCommand::StopAudioLevelMonitoring => {
                        if let Err(e) = recorder.stop_audio_level_monitoring() {
                            error(
                                Component::Recording,
                                &format!("Failed to stop audio level monitoring: {}", e),
                            );
                        }
                    }
                    RecorderCommand::SetSampleCallback(callback) => {
                        *recorder.sample_callback.lock().unwrap() = callback;
                    }
                }
            }
        });
    }

    pub fn start_recording(
        &self,
        output_path: &Path,
        device_name: Option<&str>,
    ) -> Result<(), String> {
        if self.control_tx.is_none() {
            return Err("Recorder not initialized".to_string());
        }

        let start_time = std::time::Instant::now();
        info(
            Component::Recording,
            &format!("AudioRecorder::start_recording called at {:?}", start_time),
        );

        let result = self
            .control_tx
            .as_ref()
            .unwrap()
            .send(RecorderCommand::StartRecording(
                output_path.to_string_lossy().to_string(),
                device_name.map(|s| s.to_string()),
            ))
            .map_err(|e| format!("Failed to send start command: {}", e));

        let elapsed = start_time.elapsed();
        info(
            Component::Recording,
            &format!(
                "AudioRecorder::start_recording command sent in {:?}",
                elapsed
            ),
        );

        result
    }

    pub fn stop_recording(&self) -> Result<(), String> {
        if self.control_tx.is_none() {
            return Err("Recorder not initialized".to_string());
        }

        let start_time = std::time::Instant::now();
        info(
            Component::Recording,
            &format!("AudioRecorder::stop_recording called at {:?}", start_time),
        );

        // Clear the recording state immediately to prevent race conditions
        // This ensures that any concurrent is_recording() calls will return false
        info(
            Component::Recording,
            "AudioRecorder::stop_recording - clearing state immediately",
        );
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
        info(
            Component::Recording,
            &format!(
                "AudioRecorder::stop_recording command sent in {:?}",
                command_sent_time
            ),
        );

        // Wait for the recording state to actually change with shorter timeout
        let wait_start = std::time::Instant::now();
        let wait_result = self
            .recording_state_changed
            .wait_timeout(
                self.is_recording.lock().unwrap(),
                Duration::from_millis(50),  // Reduced from 100ms for faster response
            );
        
        // Handle timeout gracefully - don't panic
        if wait_result.is_err() {
            warn(Component::Recording, "Recording state wait timed out, but continuing");
        }

        let wait_time = wait_start.elapsed();
        let total_time = start_time.elapsed();
        info(
            Component::Recording,
            &format!(
                "AudioRecorder::stop_recording synchronization completed in {:?}, total time: {:?}",
                wait_time, total_time
            ),
        );

        // The worker thread will also clear the state, but we've already done it
        // to prevent race conditions with concurrent state queries

        Ok(())
    }

    pub fn is_recording(&self) -> bool {
        *self.is_recording.lock().unwrap()
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

    /// Proactively probe and cache device information during initialization
    /// This prevents the "No device info available" warnings during recording
    fn probe_and_cache_device_info(&self) {
        info(Component::Recording, "🔍 Probing device capabilities during initialization...");
        
        // First try to get default device capabilities directly
        if let Some(capabilities) = DeviceMonitor::probe_default_device_capabilities() {
            if let Some(default_config) = &capabilities.default_config {
                let device_info = DeviceInfo {
                    name: "Default Device".to_string(),
                    sample_rate: default_config.sample_rate,
                    channels: default_config.channels,
                    metadata: None, // We'll populate this when we start recording
                };
                
                if let Ok(mut guard) = self.current_device_info.lock() {
                    *guard = Some(device_info.clone());
                    info(
                        Component::Recording,
                        &format!(
                            "✅ Cached default device info: {}Hz, {} channels", 
                            device_info.sample_rate, 
                            device_info.channels
                        )
                    );
                } else {
                    warn(Component::Recording, "Failed to cache device info: lock error");
                }
            } else {
                warn(Component::Recording, "⚠️ Default device has no default config");
            }
        } else {
            warn(Component::Recording, "⚠️ Failed to probe default device capabilities");
            
            // Fallback: try to get any available device info
            match DeviceMonitor::probe_device_capabilities() {
                Ok(devices) => {
                    if let Some((name, capabilities)) = devices.iter().next() {
                        if let Some(default_config) = &capabilities.default_config {
                            let device_info = DeviceInfo {
                                name: name.clone(),
                                sample_rate: default_config.sample_rate,
                                channels: default_config.channels,
                                metadata: None,
                            };
                            
                            if let Ok(mut guard) = self.current_device_info.lock() {
                                *guard = Some(device_info.clone());
                                info(
                                    Component::Recording,
                                    &format!(
                                        "✅ Cached fallback device info ({}): {}Hz, {} channels", 
                                        device_info.name,
                                        device_info.sample_rate, 
                                        device_info.channels
                                    )
                                );
                            }
                        }
                    } else {
                        warn(Component::Recording, "⚠️ No input devices found during probing");
                    }
                }
                Err(e) => {
                    error(Component::Recording, &format!("❌ Failed to probe device capabilities: {}", e));
                }
            }
        }
    }
}

struct AudioRecorderWorker {
    stream: Option<cpal::Stream>,
    monitoring_stream: Option<cpal::Stream>,
    writer: Arc<Mutex<Option<hound::WavWriter<std::io::BufWriter<std::fs::File>>>>>,
    is_recording: Arc<Mutex<bool>>,
    sample_count: Arc<Mutex<u64>>,
    sample_rate: u32,
    channels: u16,
    sample_format: Option<cpal::SampleFormat>,
    current_audio_level: Arc<Mutex<f32>>,
    current_device_info: Arc<Mutex<Option<DeviceInfo>>>,
    sample_callback: Arc<Mutex<Option<SampleCallback>>>,
    recording_state_changed: Arc<Condvar>,
    current_metadata: Option<AudioMetadata>,
    requested_config: Option<cpal::StreamConfig>,
    // New validation and monitoring components
    format_validator: Option<AudioFormatValidator>,
    capability_checker: Option<DeviceCapabilityChecker>,
    last_callback_time: Instant,
    callback_count: u64,
    // Channel for receiving validation data from audio callback
    validation_rx: Option<std::sync::mpsc::Receiver<CallbackValidationData>>,
}

impl AudioRecorderWorker {
    fn new(
        is_recording: Arc<Mutex<bool>>,
        audio_level: Arc<Mutex<f32>>,
        device_info: Arc<Mutex<Option<DeviceInfo>>>,
        sample_callback: Arc<Mutex<Option<SampleCallback>>>,
        recording_state_changed: Arc<Condvar>,
    ) -> Self {
        Self {
            stream: None,
            monitoring_stream: None,
            writer: Arc::new(Mutex::new(None)),
            is_recording,
            sample_count: Arc::new(Mutex::new(0)),
            sample_rate: 48000, // default, will be updated when recording starts
            channels: 1,        // default, will be updated when recording starts
            sample_format: None,
            current_audio_level: audio_level,
            current_device_info: device_info,
            sample_callback,
            recording_state_changed,
            current_metadata: None,
            requested_config: None,
            format_validator: None,
            capability_checker: None,
            last_callback_time: Instant::now(),
            callback_count: 0,
            validation_rx: None,
        }
    }

    fn start_recording(
        &mut self,
        output_path: &str,
        device_name: Option<&str>,
    ) -> Result<(), String> {
        use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

        // Stop monitoring if it's running but preserve the audio level
        if self.monitoring_stream.is_some() {
            // Don't reset audio level when transitioning from monitoring to recording
            if let Some(stream) = self.monitoring_stream.take() {
                drop(stream);
            }
        }

        // Pre-recording validation: ensure we have cached device info
        self.validate_device_info_available()?;

        let host = cpal::default_host();

        let device = match device_name {
            Some(name) => {
                info(
                    Component::Recording,
                    &format!("Attempting to use specified device: '{}'", name),
                );

                // Find device by name
                let devices = host
                    .input_devices()
                    .map_err(|e| format!("Failed to enumerate devices: {}", e))?;

                // List all available devices for debugging
                info(Component::Recording, "Available input devices:");
                let devices_vec: Vec<_> = devices.collect();
                for (i, device) in devices_vec.iter().enumerate() {
                    let device_name = device.name().unwrap_or_else(|_| "Unknown".to_string());
                    info(Component::Recording, &format!("  [{}] {}", i, device_name));
                }

                // Find the requested device
                let selected_device = devices_vec
                    .into_iter()
                    .find(|d| d.name().map(|n| n == name).unwrap_or(false))
                    .ok_or_else(|| format!("Device '{}' not found", name))?;

                let actual_name = selected_device
                    .name()
                    .unwrap_or_else(|_| "Unknown".to_string());
                info(
                    Component::Recording,
                    &format!("Selected device: '{}'", actual_name),
                );
                selected_device
            }
            None => {
                info(Component::Recording, "Using default input device");

                // Use default device
                let default_device = host
                    .default_input_device()
                    .ok_or("No input device available - please check microphone permissions")?;

                let device_name = default_device
                    .name()
                    .unwrap_or_else(|_| "Unknown".to_string());
                info(
                    Component::Recording,
                    &format!("Default device: '{}'", device_name),
                );

                // Log if this looks like AirPods and send notification
                if device_name.to_lowercase().contains("airpod") {
                    warn(
                        Component::Recording,
                        "AirPods detected - may experience audio quality issues",
                    );
                    info(
                        Component::Recording,
                        "Recommendation: Use a wired microphone for best results",
                    );
                    // Note: We'll notify about AirPods after we get the device configuration
                }

                default_device
            }
        };

        let default_config = device
            .default_input_config()
            .map_err(|e| format!("Failed to get input config: {}", e))?;

        // DIAGNOSTIC: Log raw device configuration
        info(
            Component::Recording,
            &format!(
                "Raw device config - Sample Rate: {}, Channels: {}, Format: {:?}",
                default_config.sample_rate().0,
                default_config.channels(),
                default_config.sample_format()
            ),
        );

        // Log detailed device information
        let device_name_for_metadata = device.name().unwrap_or_else(|_| "Unknown".to_string());
        info(Component::Recording, "Device details:");
        info(
            Component::Recording,
            &format!("  Name: {}", device_name_for_metadata),
        );
        info(
            Component::Recording,
            &format!("  Sample Rate: {} Hz", default_config.sample_rate().0),
        );
        info(
            Component::Recording,
            &format!("  Channels: {}", default_config.channels()),
        );
        info(
            Component::Recording,
            &format!("  Format: {:?}", default_config.sample_format()),
        );

        // Device capability detection - ALWAYS use device's native configuration
        let device_channels = default_config.channels(); // Store original device channels

        // Log supported device configurations for diagnostics
        if let Ok(supported_configs) = device.supported_input_configs() {
            let supported_vec: Vec<_> = supported_configs.collect();

            // DIAGNOSTIC: Log all supported configurations
            info(Component::Recording, "Supported device configurations:");
            for (i, config) in supported_vec.iter().enumerate() {
                info(
                    Component::Recording,
                    &format!(
                        "  Config {}: {} channels, {}-{} Hz, {:?}",
                        i,
                        config.channels(),
                        config.min_sample_rate().0,
                        config.max_sample_rate().0,
                        config.sample_format()
                    ),
                );
            }
        } else {
            warn(
                Component::Recording,
                "Cannot enumerate device capabilities - using device default",
            );
        }

        info(
            Component::Recording,
            &format!(
                "Audio configuration: Using device native format - {} channel(s), {} Hz",
                device_channels,
                default_config.sample_rate().0
            ),
        );

        // DIAGNOSTIC: Check for common problematic configurations
        if device_name_for_metadata.to_lowercase().contains("airpod") {
            warn(
                Component::Recording,
                &format!(
                    "AirPods detected with sample rate: {} Hz",
                    default_config.sample_rate().0
                ),
            );
            if default_config.sample_rate().0 == 8000 || default_config.sample_rate().0 == 16000 {
                error(
                    Component::Recording,
                    "AirPods in low-quality mode! This will cause chipmunk audio.",
                );
                error(
                    Component::Recording,
                    "Solution: Disconnect and reconnect AirPods, or use wired headphones.",
                );
                // Some AirPods report 8kHz or 16kHz in call mode but actually deliver 48kHz audio
                // This mismatch causes the chipmunk effect
            }
            warn(
                Component::Recording,
                "For best results, use wired headphones or ensure AirPods are in high-quality mode",
            );

            // Send notification to frontend about AirPods detection
            notify_airpods_detected(
                device_name_for_metadata.clone(),
                default_config.sample_rate().0,
            );
        }

        // Additional check for other Bluetooth devices
        if device_name_for_metadata
            .to_lowercase()
            .contains("bluetooth")
            || device_name_for_metadata.to_lowercase().contains("wireless")
        {
            info(
                Component::Recording,
                &format!(
                    "Bluetooth device detected: {} at {} Hz",
                    device_name_for_metadata,
                    default_config.sample_rate().0
                ),
            );
            if default_config.sample_rate().0 < 44100 {
                warn(
                    Component::Recording,
                    "Low sample rate detected on Bluetooth device - may cause audio quality issues",
                );
            }
        }

        // IMPORTANT: We now preserve the exact hardware format
        // No sample rate overrides - we trust what the device reports
        let actual_sample_rate = default_config.sample_rate();

        if device_name_for_metadata.to_lowercase().contains("airpod")
            && (actual_sample_rate.0 == 8000
                || actual_sample_rate.0 == 16000
                || actual_sample_rate.0 == 24000)
        {
            warn(
                Component::Recording,
                &format!(
                    "AirPods reporting {} Hz - this is the actual hardware rate",
                    actual_sample_rate.0
                ),
            );
            warn(
                Component::Recording,
                "AirPods may be in call mode. Audio will be preserved at native quality.",
            );
            info(
                Component::Recording,
                "Conversion to 16kHz for Whisper will happen during transcription.",
            );
        }

        // CRITICAL FIX: Always use device's native configuration
        // Forcing 16kHz was causing sample rate mismatches and garbled audio
        // Whisper conversion will handle resampling properly during transcription
        info(
            Component::Recording,
            &format!(
                "Using device native format: {} Hz, {} channels",
                actual_sample_rate.0,
                device_channels
            ),
        );
        info(
            Component::Recording,
            "Audio will be converted to 16kHz mono during transcription, not recording",
        );

        // Always use device's native config to avoid sample rate mismatches
        let mut config = cpal::StreamConfig {
            channels: device_channels, // Use device's native channels
            sample_rate: default_config.sample_rate(), // Use device's native sample rate
            buffer_size: cpal::BufferSize::Default,
        };

        // Try progressive buffer sizes for lower latency
        let buffer_sizes = [128, 256, 512, 1024];
        let mut buffer_size_used = "Default".to_string();
        for &size in &buffer_sizes {
            config.buffer_size = cpal::BufferSize::Fixed(size);

            // Test if this buffer size works by trying to create a dummy stream
            if let Ok(_) = device.supported_input_configs() {
                buffer_size_used = format!("Fixed({})", size);
                info(
                    Component::Recording,
                    &format!("Using buffer size: {} samples", size),
                );
                break;
            }
        }

        if buffer_size_used == "Default" {
            config.buffer_size = cpal::BufferSize::Default;
            info(
                Component::Recording,
                "Using default buffer size (device-dependent latency)",
            );
        }

        // Store sample rate, channels, and format for later use
        self.sample_rate = config.sample_rate.0;
        self.channels = config.channels; // Always matches device channels now
        self.sample_format = Some(default_config.sample_format());

        // Log what we're actually using
        info(
            Component::Recording,
            &format!(
                "Final recording config: {} Hz, {} channel(s), format: {:?}",
                self.sample_rate, self.channels, self.sample_format
            ),
        );

        // Store the requested config for metadata tracking
        self.requested_config = Some(cpal::StreamConfig {
            channels: default_config.channels(),
            sample_rate: default_config.sample_rate(),
            buffer_size: cpal::BufferSize::Default,
        });

        // Create comprehensive audio metadata
        let is_default = device_name.is_none();
        let mut audio_metadata = AudioMetadata::new(
            device_name_for_metadata.clone(),
            self.requested_config.as_ref(),
            &config,
            default_config.sample_format(),
            &config.buffer_size,
            is_default,
        );

        // Set recording-specific information
        audio_metadata.set_recording_info(
            false,    // VAD will be set later if enabled
            "manual", // Will be updated based on actual trigger
            None,     // Silence padding will be set if applied
        );

        // Log metadata issues if any
        if audio_metadata.has_critical_issues() {
            error(
                Component::Recording,
                &format!(
                    "Critical audio issues detected: {}",
                    audio_metadata.get_issues_summary()
                ),
            );
        } else if !audio_metadata.mismatches.is_empty() {
            warn(
                Component::Recording,
                &format!(
                    "Audio configuration notes: {}",
                    audio_metadata.get_issues_summary()
                ),
            );
        }

        // Store the metadata
        self.current_metadata = Some(audio_metadata.clone());

        // Initialize format validator for real-time validation
        self.format_validator = Some(AudioFormatValidator::new(
            config.sample_rate.0,
            config.channels,
        ));

        // Initialize capability checker for periodic device monitoring
        let validation_frequency = audio_metadata.get_validation_frequency_ms();
        self.capability_checker = Some(DeviceCapabilityChecker::new(
            device_name_for_metadata.clone(),
            Duration::from_millis(validation_frequency),
        ));

        info(
            Component::Recording,
            &format!(
                "Initialized validation systems - frequency: {}ms",
                validation_frequency
            ),
        );

        // Create native format info with actual recording format
        let native_format = NativeAudioFormat::new(
            config.sample_rate.0,
            config.channels, // Use actual recording channels (1 for mono optimization)
            default_config.sample_format(),
            device_name_for_metadata.clone(),
        );

        // DEBUG: Log the channel configuration details
        info(Component::Recording, &format!(
            "Channel configuration - Device: {} channels, Config: {} channels, Native format: {} channels",
            default_config.channels(), config.channels, native_format.channels
        ));

        // Log the native format we're preserving
        native_format.log_format_info("Recording Configuration");
        info(
            Component::Recording,
            "WAV file will preserve this exact format for archival quality",
        );

        // Update global device sample rate and channels cache for transcription strategies
        crate::update_device_sample_rate(config.sample_rate.0);
        crate::update_device_channels(config.channels);

        // Store device info with metadata
        let device_info = DeviceInfo {
            name: device_name_for_metadata.clone(),
            sample_rate: config.sample_rate.0,
            channels: config.channels, // Use the actual config channels, not the potentially modified variable
            metadata: Some(audio_metadata),
        };
        *self.current_device_info.lock().unwrap() = Some(device_info);

        info(
            Component::Recording,
            &format!(
                "Recording started with device: {}",
                device_name_for_metadata
            ),
        );

        // Reset sample count
        *self.sample_count.lock().unwrap() = 0;

        // Create WAV spec that exactly matches hardware format
        let spec = native_format.to_wav_spec();

        info(Component::Recording, &format!("WAV file specification:"));
        info(
            Component::Recording,
            &format!(
                "  Sample Rate: {} Hz (native hardware rate)",
                spec.sample_rate
            ),
        );
        info(
            Component::Recording,
            &format!(
                "  Channels: {} (preserving hardware configuration)",
                spec.channels
            ),
        );
        info(
            Component::Recording,
            &format!("  Bit Depth: {} bits", spec.bits_per_sample),
        );
        info(
            Component::Recording,
            &format!("  Format: {:?}", spec.sample_format),
        );

        // CRITICAL: Verify channel count matches between config and WAV spec
        if spec.channels != config.channels {
            error(
                Component::Recording,
                &format!(
                    "CHANNEL MISMATCH DETECTED! Config channels: {}, WAV spec channels: {}",
                    config.channels, spec.channels
                ),
            );
            error(
                Component::Recording,
                "This will cause chipmunk effect! Audio data and header don't match.",
            );
        }

        let writer = hound::WavWriter::create(output_path, spec)
            .map_err(|e| format!("Failed to create WAV writer: {}", e))?;

        let writer = Arc::new(Mutex::new(Some(writer)));
        self.writer = writer.clone();

        let is_recording = self.is_recording.clone();
        *is_recording.lock().unwrap() = true;

        let err_fn = |err| {
            error(
                Component::Recording,
                &format!("An error occurred on the audio stream: {}", err),
            )
        };

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

        // Start periodic validation thread for device capability checking
        if let Some(ref metadata) = self.current_metadata {
            if metadata.needs_special_handling() {
                info(
                    Component::Recording,
                    "Device requires special handling - starting enhanced monitoring",
                );
                self.start_validation_monitoring();
            }
        }

        Ok(())
    }

    fn stop_recording(&mut self) -> Result<(), String> {
        info(
            Component::Recording,
            &format!(
                "AudioRecorder::stop_recording called at {}",
                chrono::Local::now().format("%H:%M:%S%.3f")
            ),
        );

        // Log final recording statistics for debugging
        let total_samples = *self.sample_count.lock().unwrap();
        let expected_channels = self.channels;
        let sample_rate = self.sample_rate;
        let total_frames = total_samples / expected_channels as u64;
        let duration_seconds = total_frames as f32 / sample_rate as f32;

        info(Component::Recording, &format!(
            "Recording statistics - Total samples: {}, Channels: {}, Sample rate: {} Hz, Frames: {}, Duration: {:.2}s",
            total_samples, expected_channels, sample_rate, total_frames, duration_seconds
        ));

        // Set recording to false and notify waiting threads
        {
            let mut recording = self.is_recording.lock().unwrap();
            *recording = false;
            self.recording_state_changed.notify_all();
        }
        debug(
            Component::Recording,
            "Set is_recording to false and notified waiters",
        );

        // Reset audio level only after recording stops
        *self.current_audio_level.lock().unwrap() = 0.0;

        // Drop the stream immediately - the stream itself handles proper shutdown
        if let Some(stream) = self.stream.take() {
            drop(stream);
        }

        // Check if we need to pad with silence
        let total_samples = *self.sample_count.lock().unwrap();
        let samples_per_second = self.sample_rate as f32 * self.channels as f32; // Account for all channels
        let duration_seconds = total_samples as f32 / samples_per_second;

        let mut _silence_padding_applied = false;
        let _silence_padding_ms;

        // Only pad very short recordings (less than 0.3 seconds) to avoid Whisper issues
        // Whisper performs poorly on extremely short audio, but 0.3-1.0 second clips are fine
        if duration_seconds < 0.3 && self.writer.lock().unwrap().is_some() {
            // Calculate how many silence samples we need to reach 0.5 seconds minimum
            let target_samples = (samples_per_second * 0.5) as u64; // 0.5 seconds minimum for Whisper
            let silence_samples_needed = target_samples.saturating_sub(total_samples);

            if silence_samples_needed > 0 {
                _silence_padding_applied = true;
                _silence_padding_ms =
                    ((silence_samples_needed as f32 / samples_per_second) * 1000.0) as u32;

                // Update metadata with silence padding info
                if let Some(ref mut metadata) = self.current_metadata {
                    metadata.recording.silence_padding_ms = Some(_silence_padding_ms);
                    metadata
                        .recording
                        .processing_applied
                        .push("silence_padding".to_string());
                }

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

    /// Perform periodic capability checking during recording
    fn check_device_capabilities(&mut self) -> Result<(), String> {
        if let Some(ref mut checker) = self.capability_checker {
            if checker.should_check() {
                match checker.check_capabilities() {
                    Ok(CapabilityCheckResult::FirstCheck(_)) => {
                        info(Component::Recording, "First capability check completed");
                        if let Some(ref mut metadata) = self.current_metadata {
                            metadata.update_monitoring(true, false);
                        }
                    }
                    Ok(CapabilityCheckResult::Unchanged) => {
                        debug(Component::Recording, "Device capabilities unchanged");
                        if let Some(ref mut metadata) = self.current_metadata {
                            metadata.update_monitoring(true, false);
                        }
                    }
                    Ok(CapabilityCheckResult::Changed { old: _, new: _ }) => {
                        warn(
                            Component::Recording,
                            "Device capabilities changed during recording!",
                        );
                        if let Some(ref mut metadata) = self.current_metadata {
                            metadata.update_monitoring(true, true);
                        }
                        // TODO: Emit device change event to frontend
                    }
                    Err(e) => {
                        error(
                            Component::Recording,
                            &format!("Capability check failed: {}", e),
                        );
                        // Device might have been disconnected
                        return Err(format!("Device capability check failed: {}", e));
                    }
                }
            }
        }
        Ok(())
    }

    /// Update validation statistics from callback data
    fn update_validation_from_callback(&mut self, samples: &[f32], callback_duration: Duration) {
        if let Some(ref mut validator) = self.format_validator {
            let frames = samples.len() / self.channels as usize;
            let callback_info = CallbackInfo {
                frames,
                samples_received: samples.len(),
                time_since_last: callback_duration,
            };

            match validator.process_callback(samples, &callback_info) {
                ValidationResult::Ok => {
                    // All good, update statistics
                    if let Some(ref mut metadata) = self.current_metadata {
                        if let Some(pattern_analysis) = validator.generate_pattern_analysis() {
                            metadata.update_validation(1, 0, Some(pattern_analysis));
                        }
                    }
                }
                ValidationResult::IssuesDetected(issues, severity) => {
                    warn(
                        Component::Recording,
                        &format!(
                            "Audio validation issues detected: {} issues, max severity: {:?}",
                            issues.len(),
                            severity
                        ),
                    );

                    for issue in &issues {
                        match issue.severity {
                            super::validation::InconsistencySeverity::Critical => {
                                error(
                                    Component::Recording,
                                    &format!("CRITICAL audio issue: {}", issue.details),
                                );
                            }
                            super::validation::InconsistencySeverity::High => {
                                error(
                                    Component::Recording,
                                    &format!("HIGH audio issue: {}", issue.details),
                                );
                            }
                            super::validation::InconsistencySeverity::Medium => {
                                warn(
                                    Component::Recording,
                                    &format!("MEDIUM audio issue: {}", issue.details),
                                );
                            }
                            super::validation::InconsistencySeverity::Low => {
                                info(
                                    Component::Recording,
                                    &format!("LOW audio issue: {}", issue.details),
                                );
                            }
                        }
                    }

                    if let Some(ref mut metadata) = self.current_metadata {
                        metadata.update_validation(
                            1,
                            issues.len() as u32,
                            validator.generate_pattern_analysis(),
                        );
                    }
                }
                ValidationResult::InsufficientData => {
                    // Normal during startup
                }
            }
        }

        self.callback_count += 1;
    }

    /// Start validation monitoring thread for problematic devices
    fn start_validation_monitoring(&self) {
        info(
            Component::Recording,
            "Starting validation monitoring thread for enhanced device checking",
        );
        // TODO: Implement validation monitoring thread
        // This would periodically check device capabilities and emit warnings
        // For now, we'll rely on the capability checker integration
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

        // Clone config values to move into closure
        let channels = config.channels;
        let device_sample_rate = config.sample_rate.0;

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
                                let s = unsafe { *(&sample as *const T as *const i16) } as f32
                                    / 32768.0;
                                sum_squares += s * s;
                            }
                        }

                        let rms = (sum_squares / data.len() as f32).sqrt();

                        // Amplify the RMS value for better visual response
                        // Most speech is quite low in amplitude, so we need to scale it up
                        let amplified_rms = (rms * 40.0).min(1.0); // Increased to 40x for better sensitivity

                        // Debug logging for audio levels (only log significant changes)
                        // Commented out to reduce noise
                        // if rms > 0.001 {
                        // }

                        // Update audio level (with some smoothing)
                        let current_level = *audio_level.lock().unwrap();
                        let new_level = current_level * 0.7 + amplified_rms * 0.3; // Smooth the level changes
                        *audio_level.lock().unwrap() = new_level; // Already capped by amplified_rms

                        // Acquire sample count lock first to minimize lock contention
                        let prev_count = *sample_count.lock().unwrap();
                        
                        if let Some(ref mut writer) = *writer.lock().unwrap() {
                            // Log first callback to verify actual data rate (per recording)
                            if prev_count == 0 {
                                info(
                                    Component::Recording,
                                    &format!(
                                        "First audio callback - {} samples, {} channels",
                                        data.len(),
                                        channels
                                    ),
                                );
                                info(
                                    Component::Recording,
                                    &format!(
                                        "Preserving native format: {} Hz, {} channel(s)",
                                        device_sample_rate, channels
                                    ),
                                );
                            }

                            // Write samples directly in their native format
                            // NO conversion, NO resampling, NO channel mixing
                            for &sample in data.iter() {
                                if let Err(e) = writer.write_sample(sample) {
                                    error(Component::Recording, &format!("Sample write failed: {}", e));
                                }
                            }

                            // Periodic validation logging
                            if prev_count == 0 {
                                debug(
                                    Component::Recording,
                                    &format!(
                                        "First write - {} samples written, expected {} channels",
                                        data.len(),
                                        channels
                                    ),
                                );
                            }
                        }
                        
                        // Update sample count after writing (separate lock to minimize contention)
                        *sample_count.lock().unwrap() += data.len() as u64;

                        // Call sample callback for ring buffer processing
                        if let Some(ref callback) = *sample_callback.lock().unwrap() {
                            // Convert samples to f32 - data is already mono if we're recording in mono
                            let f32_samples: Vec<f32> = if TypeId::of::<T>() == TypeId::of::<f32>()
                            {
                                data.iter()
                                    .map(|&sample| unsafe { *(&sample as *const T as *const f32) })
                                    .collect()
                            } else if TypeId::of::<T>() == TypeId::of::<i16>() {
                                data.iter()
                                    .map(|&sample| {
                                        let s = unsafe { *(&sample as *const T as *const i16) };
                                        s as f32 / 32768.0
                                    })
                                    .collect()
                            } else {
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
                let devices = host
                    .input_devices()
                    .map_err(|e| format!("Failed to enumerate devices: {}", e))?;

                devices
                    .into_iter()
                    .find(|d| d.name().map(|n| n == name).unwrap_or(false))
                    .ok_or_else(|| format!("Device '{}' not found", name))?
            }
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

        let err_fn = |err| {
            error(
                Component::Recording,
                &format!("Audio level monitoring error: {}", err),
            )
        };

        // Build monitoring stream based on sample format
        let monitoring_stream = match config.sample_format() {
            cpal::SampleFormat::F32 => {
                self.build_monitoring_stream::<f32>(&device, &config.into(), audio_level, err_fn)
            }
            cpal::SampleFormat::I16 => {
                self.build_monitoring_stream::<i16>(&device, &config.into(), audio_level, err_fn)
            }
            _ => return Err("Unsupported sample format".to_string()),
        }?;

        monitoring_stream
            .play()
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

        device
            .build_input_stream(
                config,
                move |data: &[T], _: &cpal::InputCallbackInfo| {
                    // Calculate RMS
                    let sum_squares: f32 = data
                        .iter()
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

    /// Validate that device info is available before starting recording
    /// This prevents the "No device info available" warnings
    fn validate_device_info_available(&self) -> Result<(), String> {
        match self.current_device_info.lock() {
            Ok(guard) => {
                if let Some(ref device_info) = *guard {
                    info(
                        Component::Recording,
                        &format!(
                            "✅ Device info validation passed: {} ({}Hz, {} channels)",
                            device_info.name,
                            device_info.sample_rate,
                            device_info.channels
                        )
                    );
                    Ok(())
                } else {
                    // Device info not available - try to probe it now as a last resort
                    warn(Component::Recording, "⚠️ Device info not cached - attempting immediate probe");
                    
                    drop(guard); // Release the lock before calling probe methods
                    
                    if let Some(capabilities) = DeviceMonitor::probe_default_device_capabilities() {
                        if let Some(default_config) = &capabilities.default_config {
                            let device_info = DeviceInfo {
                                name: "Default Device (emergency probe)".to_string(),
                                sample_rate: default_config.sample_rate,
                                channels: default_config.channels,
                                metadata: None,
                            };
                            
                            // Try to cache it for next time
                            if let Ok(mut guard) = self.current_device_info.lock() {
                                *guard = Some(device_info.clone());
                                info(
                                    Component::Recording,
                                    &format!(
                                        "🔧 Emergency device probe successful: {}Hz, {} channels",
                                        device_info.sample_rate,
                                        device_info.channels
                                    )
                                );
                                return Ok(());
                            }
                        }
                    }
                    
                    Err("No device info available and emergency probe failed. Cannot start recording without device information.".to_string())
                }
            }
            Err(_) => {
                Err("Failed to acquire device info lock for validation".to_string())
            }
        }
    }
}

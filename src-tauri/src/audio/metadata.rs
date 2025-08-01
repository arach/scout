use cpal::{BufferSize, SampleFormat};
use serde::{Deserialize, Serialize};

/// Comprehensive audio metadata captured during recording
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioMetadata {
    /// Device information
    pub device: DeviceMetadata,

    /// Audio format configuration
    pub format: FormatMetadata,

    /// Recording configuration
    pub recording: RecordingMetadata,

    /// System information
    pub system: SystemMetadata,

    /// Configuration mismatches detected
    pub mismatches: Vec<ConfigMismatch>,

    /// Timestamp when metadata was captured
    pub captured_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceMetadata {
    /// Device name as reported by the OS
    pub name: String,

    /// Device type (if detectable)
    pub device_type: Option<String>,

    /// Whether this is the default device
    pub is_default: bool,

    /// Device-specific notes (e.g., "AirPods detected")
    pub notes: Vec<String>,

    /// Device quirks and special handling flags
    pub quirks: DeviceQuirks,

    /// Device monitoring information
    pub monitoring: DeviceMonitoring,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormatMetadata {
    /// Actual sample rate used
    pub sample_rate: u32,

    /// Requested sample rate (what we asked for)
    pub requested_sample_rate: Option<u32>,

    /// Detected sample rate from audio analysis (may differ from reported)
    pub detected_sample_rate: Option<u32>,

    /// Actual number of channels
    pub channels: u16,

    /// Requested number of channels
    pub requested_channels: Option<u16>,

    /// Sample format (I16, F32, etc.)
    pub sample_format: String,

    /// Bits per sample
    pub bit_depth: u16,

    /// Buffer configuration
    pub buffer_config: BufferConfig,

    /// Calculated data rate in bytes/sec
    pub data_rate_bytes_per_sec: u32,

    /// Format validation results
    pub validation: FormatValidation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BufferConfig {
    /// Buffer size type (Fixed or Default)
    pub buffer_type: String,

    /// Buffer size in samples (if fixed)
    pub size_samples: Option<u32>,

    /// Estimated latency in milliseconds
    pub estimated_latency_ms: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordingMetadata {
    /// Input gain/volume setting (if available)
    pub input_gain: Option<f32>,

    /// Any audio processing applied
    pub processing_applied: Vec<String>,

    /// Voice Activity Detection enabled
    pub vad_enabled: bool,

    /// Silence padding applied
    pub silence_padding_ms: Option<u32>,

    /// Recording trigger type (manual, push-to-talk, VAD)
    pub trigger_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemMetadata {
    /// Operating system
    pub os: String,

    /// OS version
    pub os_version: String,

    /// Audio backend (CoreAudio, WASAPI, ALSA, etc.)
    pub audio_backend: String,

    /// System audio settings that might affect recording
    pub system_notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigMismatch {
    /// Type of mismatch
    pub mismatch_type: String,

    /// What was requested
    pub requested: String,

    /// What was actually provided
    pub actual: String,

    /// Potential impact on audio quality
    pub impact: String,

    /// Suggested resolution
    pub resolution: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceQuirks {
    /// Is this an AirPods device
    pub is_airpods: bool,

    /// Is this a Bluetooth device
    pub is_bluetooth: bool,

    /// Device may report incorrect sample rates
    pub has_sample_rate_quirks: bool,

    /// Device may change capabilities during use
    pub has_dynamic_capabilities: bool,

    /// Special handling mode (e.g., "call_mode", "high_quality")
    pub mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceMonitoring {
    /// Number of capability checks performed
    pub capability_checks: u32,

    /// Number of format changes detected
    pub format_changes: u32,

    /// Last time device capabilities were verified
    pub last_check: Option<String>,

    /// Device stability score (0.0 = unstable, 1.0 = stable)
    pub stability_score: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormatValidation {
    /// Real-time format validation enabled
    pub validation_enabled: bool,

    /// Number of audio callbacks validated
    pub callbacks_validated: u32,

    /// Number of format inconsistencies detected
    pub inconsistencies_detected: u32,

    /// Audio pattern analysis results
    pub pattern_analysis: Option<AudioPatternAnalysis>,

    /// Last validation timestamp
    pub last_validation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioPatternAnalysis {
    /// Average signal level
    pub avg_signal_level: f32,

    /// Frequency content analysis (simplified)
    pub frequency_content: String,

    /// Detected vs reported sample rate confidence
    pub sample_rate_confidence: f32,

    /// Pattern-based format detection
    pub detected_format: Option<String>,
}

impl AudioMetadata {
    /// Create new audio metadata from recording context
    pub fn new(
        device_name: String,
        requested_config: Option<&cpal::StreamConfig>,
        actual_config: &cpal::StreamConfig,
        sample_format: SampleFormat,
        buffer_size: &BufferSize,
        is_default_device: bool,
    ) -> Self {
        let mut notes = Vec::new();
        let mut mismatches = Vec::new();

        // Detect device type and potential issues
        let device_type = detect_device_type(&device_name);

        // Initialize device quirks
        let device_name_lower = device_name.to_lowercase();
        let is_airpods = device_name_lower.contains("airpod");
        let is_bluetooth = device_name_lower.contains("bluetooth")
            || device_name_lower.contains("wireless")
            || is_airpods;

        let mut device_mode = None;
        let mut has_sample_rate_quirks = false;

        // Check for AirPods or Bluetooth devices
        if is_airpods {
            notes.push("AirPods detected - may experience audio quality issues".to_string());
            has_sample_rate_quirks = true;

            if actual_config.sample_rate.0 == 8000
                || actual_config.sample_rate.0 == 16000
                || actual_config.sample_rate.0 == 24000
            {
                device_mode = Some("call_mode".to_string());
                notes.push("AirPods in low-quality/call mode detected!".to_string());
                mismatches.push(ConfigMismatch {
                    mismatch_type: "sample_rate".to_string(),
                    requested: "48000 Hz expected".to_string(),
                    actual: format!("{} Hz", actual_config.sample_rate.0),
                    impact: "Audio may have incorrect pitch if sample rate mismatch not handled"
                        .to_string(),
                    resolution: Some(
                        "Disconnect and reconnect AirPods, or use wired headphones".to_string(),
                    ),
                });
            } else if actual_config.sample_rate.0 >= 44100 {
                device_mode = Some("high_quality".to_string());
            }
        }

        if is_bluetooth && !is_airpods {
            notes.push(
                "Bluetooth device detected - potential latency and quality limitations".to_string(),
            );
            has_sample_rate_quirks = true;
        }

        let device_quirks = DeviceQuirks {
            is_airpods,
            is_bluetooth,
            has_sample_rate_quirks,
            has_dynamic_capabilities: is_bluetooth, // Bluetooth devices often change capabilities
            mode: device_mode,
        };

        let device_monitoring = DeviceMonitoring {
            capability_checks: 0,
            format_changes: 0,
            last_check: None,
            stability_score: if is_bluetooth { 0.7 } else { 1.0 }, // Lower initial score for Bluetooth
        };

        // Check for sample rate mismatches
        if let Some(requested) = requested_config {
            if requested.sample_rate != actual_config.sample_rate {
                mismatches.push(ConfigMismatch {
                    mismatch_type: "sample_rate".to_string(),
                    requested: format!("{} Hz", requested.sample_rate.0),
                    actual: format!("{} Hz", actual_config.sample_rate.0),
                    impact: "Audio may have incorrect pitch if not handled properly".to_string(),
                    resolution: None,
                });
            }

            if requested.channels != actual_config.channels {
                mismatches.push(ConfigMismatch {
                    mismatch_type: "channels".to_string(),
                    requested: format!("{} channels", requested.channels),
                    actual: format!("{} channels", actual_config.channels),
                    impact: "Channel mixing may affect audio quality".to_string(),
                    resolution: None,
                });
            }
        }

        // Calculate buffer latency
        let (buffer_type, size_samples, estimated_latency_ms) = match buffer_size {
            BufferSize::Default => ("Default".to_string(), None, None),
            BufferSize::Fixed(size) => {
                let latency = (*size as f32 / actual_config.sample_rate.0 as f32) * 1000.0;
                ("Fixed".to_string(), Some(*size), Some(latency))
            }
        };

        // Get system information
        let (os, os_version) = get_os_info();
        let audio_backend = get_audio_backend();

        Self {
            device: DeviceMetadata {
                name: device_name,
                device_type,
                is_default: is_default_device,
                notes: notes.clone(),
                quirks: device_quirks,
                monitoring: device_monitoring,
            },
            format: FormatMetadata {
                sample_rate: actual_config.sample_rate.0,
                requested_sample_rate: requested_config.map(|c| c.sample_rate.0),
                detected_sample_rate: None, // Will be filled by real-time analysis
                channels: actual_config.channels,
                requested_channels: requested_config.map(|c| c.channels),
                sample_format: format!("{:?}", sample_format),
                bit_depth: match sample_format {
                    SampleFormat::I16 | SampleFormat::U16 => 16,
                    SampleFormat::F32 => 32,
                    _ => 16,
                },
                buffer_config: BufferConfig {
                    buffer_type,
                    size_samples,
                    estimated_latency_ms,
                },
                data_rate_bytes_per_sec: calculate_data_rate(actual_config, sample_format),
                validation: FormatValidation {
                    validation_enabled: true,
                    callbacks_validated: 0,
                    inconsistencies_detected: 0,
                    pattern_analysis: None,
                    last_validation: None,
                },
            },
            recording: RecordingMetadata {
                input_gain: None, // TODO: Get from system if available
                processing_applied: vec![],
                vad_enabled: false, // Will be set by recorder
                silence_padding_ms: None,
                trigger_type: "manual".to_string(), // Will be updated by recorder
            },
            system: SystemMetadata {
                os,
                os_version,
                audio_backend,
                system_notes: notes,
            },
            mismatches,
            captured_at: chrono::Local::now().to_rfc3339(),
        }
    }

    /// Add a configuration mismatch
    pub fn add_mismatch(&mut self, mismatch: ConfigMismatch) {
        self.mismatches.push(mismatch);
    }

    /// Set recording-specific metadata
    pub fn set_recording_info(
        &mut self,
        vad_enabled: bool,
        trigger_type: &str,
        silence_padding_ms: Option<u32>,
    ) {
        self.recording.vad_enabled = vad_enabled;
        self.recording.trigger_type = trigger_type.to_string();
        self.recording.silence_padding_ms = silence_padding_ms;
    }

    /// Convert to JSON string for database storage
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }

    /// Check if there are any critical mismatches
    pub fn has_critical_issues(&self) -> bool {
        self.mismatches.iter().any(|m| {
            m.mismatch_type == "sample_rate"
                && (m.impact.contains("chipmunk") || m.impact.contains("pitch"))
        })
    }

    /// Get a summary of issues for logging
    pub fn get_issues_summary(&self) -> String {
        if self.mismatches.is_empty() {
            "No configuration issues detected".to_string()
        } else {
            let issues: Vec<String> = self
                .mismatches
                .iter()
                .map(|m| format!("{}: {} (Impact: {})", m.mismatch_type, m.actual, m.impact))
                .collect();
            format!("Configuration issues: {}", issues.join("; "))
        }
    }

    /// Update device monitoring stats
    pub fn update_monitoring(&mut self, capability_check: bool, format_change: bool) {
        if capability_check {
            self.device.monitoring.capability_checks += 1;
            self.device.monitoring.last_check = Some(chrono::Local::now().to_rfc3339());
        }

        if format_change {
            self.device.monitoring.format_changes += 1;
            // Decrease stability score when format changes are detected
            self.device.monitoring.stability_score =
                (self.device.monitoring.stability_score * 0.9).max(0.1);
        } else if capability_check {
            // Increase stability score for successful checks without changes
            self.device.monitoring.stability_score =
                (self.device.monitoring.stability_score * 1.01).min(1.0);
        }
    }

    /// Update format validation stats
    pub fn update_validation(
        &mut self,
        callbacks_validated: u32,
        inconsistencies: u32,
        pattern_analysis: Option<AudioPatternAnalysis>,
    ) {
        self.format.validation.callbacks_validated += callbacks_validated;
        self.format.validation.inconsistencies_detected += inconsistencies;

        if pattern_analysis.is_some() {
            self.format.validation.pattern_analysis = pattern_analysis;
        }

        self.format.validation.last_validation = Some(chrono::Local::now().to_rfc3339());
    }

    /// Set detected sample rate from audio analysis
    pub fn set_detected_sample_rate(&mut self, detected_rate: u32, confidence: f32) {
        self.format.detected_sample_rate = Some(detected_rate);

        // Check for significant mismatch
        if (detected_rate as i32 - self.format.sample_rate as i32).abs() > 1000 {
            self.add_mismatch(ConfigMismatch {
                mismatch_type: "detected_sample_rate".to_string(),
                requested: format!("{} Hz (reported)", self.format.sample_rate),
                actual: format!(
                    "{} Hz (detected, confidence: {:.1}%)",
                    detected_rate,
                    confidence * 100.0
                ),
                impact: "Significant sample rate mismatch detected via audio analysis".to_string(),
                resolution: Some(
                    "Consider device reconfiguration or alternative input method".to_string(),
                ),
            });
        }
    }

    /// Check if device needs special handling for AirPods/Bluetooth quirks
    pub fn needs_special_handling(&self) -> bool {
        self.device.quirks.has_sample_rate_quirks
            || self.device.quirks.has_dynamic_capabilities
            || self.device.monitoring.stability_score < 0.8
    }

    /// Get recommended validation frequency based on device stability
    pub fn get_validation_frequency_ms(&self) -> u64 {
        if self.device.monitoring.stability_score < 0.5 {
            1000 // Check every second for unstable devices
        } else if self.device.monitoring.stability_score < 0.8 {
            5000 // Check every 5 seconds for moderately stable devices
        } else {
            15000 // Check every 15 seconds for stable devices
        }
    }
}

fn detect_device_type(device_name: &str) -> Option<String> {
    let name_lower = device_name.to_lowercase();

    if name_lower.contains("airpod") {
        Some("AirPods".to_string())
    } else if name_lower.contains("bluetooth") || name_lower.contains("wireless") {
        Some("Bluetooth".to_string())
    } else if name_lower.contains("usb") {
        Some("USB".to_string())
    } else if name_lower.contains("built-in") || name_lower.contains("internal") {
        Some("Built-in".to_string())
    } else if name_lower.contains("headset") || name_lower.contains("headphone") {
        Some("Headset".to_string())
    } else {
        None
    }
}

fn calculate_data_rate(config: &cpal::StreamConfig, sample_format: SampleFormat) -> u32 {
    let bytes_per_sample = match sample_format {
        SampleFormat::I16 | SampleFormat::U16 => 2,
        SampleFormat::F32 => 4,
        _ => 2,
    };

    config.sample_rate.0 * config.channels as u32 * bytes_per_sample
}

fn get_os_info() -> (String, String) {
    #[cfg(target_os = "macos")]
    {
        ("macOS".to_string(), std::env::consts::OS.to_string())
    }
    #[cfg(target_os = "windows")]
    {
        ("Windows".to_string(), std::env::consts::OS.to_string())
    }
    #[cfg(target_os = "linux")]
    {
        ("Linux".to_string(), std::env::consts::OS.to_string())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        ("Unknown".to_string(), std::env::consts::OS.to_string())
    }
}

fn get_audio_backend() -> String {
    #[cfg(target_os = "macos")]
    {
        "CoreAudio".to_string()
    }
    #[cfg(target_os = "windows")]
    {
        "WASAPI".to_string()
    }
    #[cfg(target_os = "linux")]
    {
        "ALSA/PulseAudio".to_string()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        "Unknown".to_string()
    }
}

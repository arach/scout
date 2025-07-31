use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use crate::logger::{info, warn, error, Component};

/// Audio-related notification events that can be sent to the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AudioNotificationEvent {
    /// Device with known issues detected
    ProblematicDeviceDetected {
        device_name: String,
        device_type: String,
        issues: Vec<String>,
        recommendations: Vec<String>,
        severity: NotificationSeverity,
    },
    
    /// Device capabilities changed during recording
    DeviceCapabilitiesChanged {
        device_name: String,
        changes: Vec<String>,
        impact: String,
    },
    
    /// Sample rate mismatch detected
    SampleRateMismatch {
        device_name: String,
        reported_rate: u32,
        detected_rate: Option<u32>,
        severity: NotificationSeverity,
    },
    
    /// Audio quality issues detected
    AudioQualityIssue {
        device_name: String,
        issue_type: String,
        description: String,
        severity: NotificationSeverity,
    },
    
    /// Device disconnected during recording
    DeviceDisconnected {
        device_name: String,
        recording_interrupted: bool,
    },
    
    /// Format validation failed
    FormatValidationFailed {
        device_name: String,
        validation_errors: Vec<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum NotificationSeverity {
    Info,    // General information
    Warning, // Should be aware but not critical
    Error,   // Likely to cause issues
    Critical, // Will definitely cause problems
}

/// Audio notification service for sending events to the frontend
pub struct AudioNotificationService {
    app_handle: Option<AppHandle>,
}

impl AudioNotificationService {
    pub fn new() -> Self {
        Self {
            app_handle: None,
        }
    }
    
    /// Initialize with Tauri app handle
    pub fn initialize(&mut self, app_handle: AppHandle) {
        self.app_handle = Some(app_handle);
        info(Component::Recording, "Audio notification service initialized");
    }
    
    /// Send notification to frontend
    pub fn send_notification(&self, event: AudioNotificationEvent) {
        if let Some(ref app_handle) = self.app_handle {
            let severity = self.get_event_severity(&event);
            let event_name = self.get_event_name(&event);
            
            // Log the notification
            match severity {
                NotificationSeverity::Critical => {
                    error(Component::Recording, &format!("CRITICAL AUDIO ISSUE: {}", event_name));
                },
                NotificationSeverity::Error => {
                    error(Component::Recording, &format!("AUDIO ERROR: {}", event_name));
                },
                NotificationSeverity::Warning => {
                    warn(Component::Recording, &format!("AUDIO WARNING: {}", event_name));
                },
                NotificationSeverity::Info => {
                    info(Component::Recording, &format!("AUDIO INFO: {}", event_name));
                },
            }
            
            // Emit to frontend
            if let Err(e) = app_handle.emit("audio-notification", &event) {
                error(Component::Recording, &format!("Failed to emit audio notification: {}", e));
            }
        } else {
            warn(Component::Recording, "Audio notification service not initialized - cannot send notification");
        }
    }
    
    /// Notify about problematic device detection
    pub fn notify_problematic_device(
        &self,
        device_name: String,
        device_type: String,
        issues: Vec<String>,
        recommendations: Vec<String>,
        severity: NotificationSeverity,
    ) {
        self.send_notification(AudioNotificationEvent::ProblematicDeviceDetected {
            device_name,
            device_type,
            issues,
            recommendations,
            severity,
        });
    }
    
    /// Notify about AirPods specific issues
    pub fn notify_airpods_issues(&self, device_name: String, sample_rate: u32) {
        let mut issues = vec!["AirPods detected".to_string()];
        let mut recommendations = vec!["For best audio quality, consider using wired headphones".to_string()];
        let severity;
        
        if sample_rate <= 24000 {
            issues.push(format!("Low sample rate: {} Hz (call mode)", sample_rate));
            issues.push("May cause transcription quality issues".to_string());
            recommendations.push("Disconnect and reconnect AirPods to exit call mode".to_string());
            recommendations.push("Ensure AirPods are fully connected before recording".to_string());
            severity = NotificationSeverity::Warning;
        } else {
            issues.push("Good quality mode detected".to_string());
            severity = NotificationSeverity::Info;
        }
        
        self.notify_problematic_device(
            device_name,
            "AirPods".to_string(),
            issues,
            recommendations,
            severity,
        );
    }
    
    /// Notify about Bluetooth device issues
    pub fn notify_bluetooth_issues(&self, device_name: String, has_dropouts: bool) {
        let mut issues = vec!["Bluetooth device detected".to_string()];
        let mut recommendations = vec![
            "Bluetooth devices may have latency and quality limitations".to_string(),
            "Keep device close to reduce interference".to_string(),
        ];
        let severity;
        
        if has_dropouts {
            issues.push("Audio dropouts detected".to_string());
            issues.push("Possible interference or connectivity issues".to_string());
            recommendations.push("Try moving closer to the device".to_string());
            recommendations.push("Check for interference from other Bluetooth devices".to_string());
            severity = NotificationSeverity::Warning;
        } else {
            severity = NotificationSeverity::Info;
        }
        
        self.notify_problematic_device(
            device_name,
            "Bluetooth".to_string(),
            issues,
            recommendations,
            severity,
        );
    }
    
    /// Notify about sample rate mismatch
    pub fn notify_sample_rate_mismatch(
        &self,
        device_name: String,
        reported_rate: u32,
        detected_rate: Option<u32>,
    ) {
        let severity = if let Some(detected) = detected_rate {
            let diff = (detected as i32 - reported_rate as i32).abs();
            if diff > 8000 {
                NotificationSeverity::Critical
            } else if diff > 4000 {
                NotificationSeverity::Error
            } else {
                NotificationSeverity::Warning
            }
        } else {
            NotificationSeverity::Warning
        };
        
        self.send_notification(AudioNotificationEvent::SampleRateMismatch {
            device_name,
            reported_rate,
            detected_rate,
            severity,
        });
    }
    
    /// Notify about audio quality issues
    pub fn notify_audio_quality_issue(
        &self,
        device_name: String,
        issue_type: String,
        description: String,
        severity: NotificationSeverity,
    ) {
        self.send_notification(AudioNotificationEvent::AudioQualityIssue {
            device_name,
            issue_type,
            description,
            severity,
        });
    }
    
    /// Notify about device disconnection
    pub fn notify_device_disconnected(&self, device_name: String, recording_interrupted: bool) {
        self.send_notification(AudioNotificationEvent::DeviceDisconnected {
            device_name,
            recording_interrupted,
        });
    }
    
    /// Get event severity
    fn get_event_severity(&self, event: &AudioNotificationEvent) -> NotificationSeverity {
        match event {
            AudioNotificationEvent::ProblematicDeviceDetected { severity, .. } => severity.clone(),
            AudioNotificationEvent::SampleRateMismatch { severity, .. } => severity.clone(),
            AudioNotificationEvent::AudioQualityIssue { severity, .. } => severity.clone(),
            AudioNotificationEvent::DeviceCapabilitiesChanged { .. } => NotificationSeverity::Warning,
            AudioNotificationEvent::DeviceDisconnected { recording_interrupted, .. } => {
                if *recording_interrupted {
                    NotificationSeverity::Error
                } else {
                    NotificationSeverity::Info
                }
            },
            AudioNotificationEvent::FormatValidationFailed { .. } => NotificationSeverity::Error,
        }
    }
    
    /// Get event name for logging
    fn get_event_name(&self, event: &AudioNotificationEvent) -> String {
        match event {
            AudioNotificationEvent::ProblematicDeviceDetected { device_name, device_type, .. } => {
                format!("{} device detected: {}", device_type, device_name)
            },
            AudioNotificationEvent::DeviceCapabilitiesChanged { device_name, .. } => {
                format!("Device capabilities changed: {}", device_name)
            },
            AudioNotificationEvent::SampleRateMismatch { device_name, reported_rate, detected_rate, .. } => {
                if let Some(detected) = detected_rate {
                    format!("Sample rate mismatch on {}: reported {} Hz, detected {} Hz", device_name, reported_rate, detected)
                } else {
                    format!("Sample rate issue on {}: {} Hz", device_name, reported_rate)
                }
            },
            AudioNotificationEvent::AudioQualityIssue { device_name, issue_type, .. } => {
                format!("Audio quality issue on {}: {}", device_name, issue_type)
            },
            AudioNotificationEvent::DeviceDisconnected { device_name, .. } => {
                format!("Device disconnected: {}", device_name)
            },
            AudioNotificationEvent::FormatValidationFailed { device_name, .. } => {
                format!("Format validation failed: {}", device_name)
            },
        }
    }
}

// Global notification service instance
use std::sync::{Arc, Mutex};
use once_cell::sync::Lazy;

static NOTIFICATION_SERVICE: Lazy<Arc<Mutex<AudioNotificationService>>> = 
    Lazy::new(|| Arc::new(Mutex::new(AudioNotificationService::new())));

/// Initialize the global notification service with app handle
pub fn initialize_notification_service(app_handle: AppHandle) {
    if let Ok(mut service) = NOTIFICATION_SERVICE.lock() {
        service.initialize(app_handle);
    }
}

/// Get the global notification service
pub fn get_notification_service() -> Arc<Mutex<AudioNotificationService>> {
    NOTIFICATION_SERVICE.clone()
}

/// Convenience function to send notifications
pub fn notify_audio_event(event: AudioNotificationEvent) {
    if let Ok(service) = NOTIFICATION_SERVICE.lock() {
        service.send_notification(event);
    }
}

/// Convenience function for AirPods notifications
pub fn notify_airpods_detected(device_name: String, sample_rate: u32) {
    if let Ok(service) = NOTIFICATION_SERVICE.lock() {
        service.notify_airpods_issues(device_name, sample_rate);
    }
}

/// Convenience function for Bluetooth notifications
pub fn notify_bluetooth_detected(device_name: String, has_dropouts: bool) {
    if let Ok(service) = NOTIFICATION_SERVICE.lock() {
        service.notify_bluetooth_issues(device_name, has_dropouts);
    }
}

/// Convenience function for sample rate mismatch notifications
pub fn notify_sample_rate_mismatch(device_name: String, reported_rate: u32, detected_rate: Option<u32>) {
    if let Ok(service) = NOTIFICATION_SERVICE.lock() {
        service.notify_sample_rate_mismatch(device_name, reported_rate, detected_rate);
    }
}
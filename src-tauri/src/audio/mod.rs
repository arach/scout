pub mod recorder;
pub mod converter;
pub mod ring_buffer_recorder;
pub mod format;
pub mod metadata;
pub mod validation;
pub mod device_monitor;
pub mod notifications;
pub mod wav_validator;

#[cfg(test)]
mod test_metadata;

pub use recorder::AudioRecorder;
pub use converter::AudioConverter;
pub use format::WhisperAudioConverter;
pub use metadata::AudioMetadata;
pub use validation::{AudioFormatValidator, ValidationResult, CallbackInfo};
pub use device_monitor::{DeviceMonitor, DeviceChangeEvent, DeviceCapabilityChecker};
pub use notifications::{AudioNotificationEvent, NotificationSeverity, initialize_notification_service, notify_airpods_detected, notify_bluetooth_detected, notify_sample_rate_mismatch};
pub use wav_validator::{WavValidator, WavValidationResult};
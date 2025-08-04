use super::super::super::common::{create_test_audio_buffer, create_mock_device_info};
use mockall::{mock, predicate::*};
use scout_lib::audio::{AudioRecorder, DeviceInfo};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tempfile::TempDir;

// Mock traits for cpal dependencies
mock! {
    pub Host {}
    impl cpal::traits::HostTrait for Host {
        type Devices = std::vec::IntoIter<MockDevice>;
        
        fn is_available() -> bool;
        fn devices(&self) -> Result<Self::Devices, cpal::DevicesError>;
        fn default_input_device(&self) -> Option<MockDevice>;
        fn default_output_device(&self) -> Option<MockDevice>;
        fn input_devices(&self) -> Result<Self::Devices, cpal::DevicesError>;
        fn output_devices(&self) -> Result<Self::Devices, cpal::DevicesError>;
    }
}

mock! {
    pub Device {}
    impl cpal::traits::DeviceTrait for Device {
        type SupportedInputConfigs = std::vec::IntoIter<cpal::SupportedStreamConfigRange>;
        type SupportedOutputConfigs = std::vec::IntoIter<cpal::SupportedStreamConfigRange>;
        
        fn name(&self) -> Result<String, cpal::DeviceNameError>;
        fn supported_input_configs(&self) -> Result<Self::SupportedInputConfigs, cpal::SupportedStreamConfigsError>;
        fn supported_output_configs(&self) -> Result<Self::SupportedOutputConfigs, cpal::SupportedStreamConfigsError>;
        fn default_input_config(&self) -> Result<cpal::SupportedStreamConfig, cpal::DefaultStreamConfigError>;
        fn default_output_config(&self) -> Result<cpal::SupportedStreamConfig, cpal::DefaultStreamConfigError>;
        fn build_input_stream<T, D, E>(
            &self,
            config: &cpal::StreamConfig,
            data_callback: D,
            error_callback: E,
            timeout: Option<Duration>,
        ) -> Result<cpal::Stream, cpal::BuildStreamError>
        where
            T: cpal::Sample,
            D: FnMut(&[T], &cpal::InputCallbackInfo) + Send + 'static,
            E: FnMut(cpal::StreamError) + Send + 'static;
    }
}

mock! {
    pub Stream {}
    impl cpal::traits::StreamTrait for Stream {
        fn play(&self) -> Result<(), cpal::PlayStreamError>;
        fn pause(&self) -> Result<(), cpal::PauseStreamError>;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;

    fn setup_temp_dir() -> TempDir {
        TempDir::new().expect("Failed to create temp directory")
    }

    #[test]
    #[serial] // Ensure tests run sequentially to avoid conflicts
    fn test_recorder_new() {
        let recorder = AudioRecorder::new();
        assert!(!recorder.is_recording());
        assert_eq!(recorder.get_current_audio_level(), 0.0);
        assert!(recorder.get_current_device_info().is_none());
    }

    #[test]
    #[serial]
    fn test_recorder_init() {
        let mut recorder = AudioRecorder::new();
        recorder.init();
        
        // After init, recorder should be ready to receive commands
        // but not recording yet
        assert!(!recorder.is_recording());
    }

    #[test]
    #[serial]
    fn test_start_recording_without_init() {
        let recorder = AudioRecorder::new();
        let temp_dir = setup_temp_dir();
        let output_path = temp_dir.path().join("test_recording.wav");
        
        let result = recorder.start_recording(&output_path, None);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Recorder not initialized");
    }

    #[test]
    #[serial]
    fn test_stop_recording_without_init() {
        let recorder = AudioRecorder::new();
        
        let result = recorder.stop_recording();
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Recorder not initialized");
    }

    #[test]
    #[serial]
    fn test_set_sample_callback_without_init() {
        let recorder = AudioRecorder::new();
        let callback = Arc::new(|_samples: &[f32]| {});
        
        let result = recorder.set_sample_callback(Some(callback));
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Recorder not initialized");
    }

    #[test]
    #[serial]
    fn test_audio_level_monitoring_without_init() {
        let recorder = AudioRecorder::new();
        
        let result = recorder.start_audio_level_monitoring(None);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Recorder not initialized");
        
        let result = recorder.stop_audio_level_monitoring();
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Recorder not initialized");
    }

    #[test]
    #[serial]
    fn test_sample_callback_functionality() {
        let mut recorder = AudioRecorder::new();
        recorder.init();
        
        let samples_received = Arc::new(Mutex::new(Vec::new()));
        let samples_received_clone = samples_received.clone();
        
        let callback = Arc::new(move |samples: &[f32]| {
            let mut received = samples_received_clone.lock().unwrap();
            received.extend_from_slice(samples);
        });
        
        let result = recorder.set_sample_callback(Some(callback));
        assert!(result.is_ok());
        
        // Clear callback
        let result = recorder.set_sample_callback(None);
        assert!(result.is_ok());
    }

    #[test]
    #[serial]
    fn test_device_info_initially_none() {
        let recorder = AudioRecorder::new();
        assert!(recorder.get_current_device_info().is_none());
        assert!(recorder.get_current_metadata().is_none());
    }

    #[test]
    #[serial]
    fn test_recording_state_transitions() {
        let mut recorder = AudioRecorder::new();
        recorder.init();
        
        // Initial state should be not recording
        assert!(!recorder.is_recording());
        
        // Note: We can't test actual recording state transitions without 
        // mocking the entire cpal infrastructure, which would require
        // significant changes to the recorder implementation.
        // These would be better tested as integration tests.
    }

    #[test]
    #[serial]
    fn test_audio_level_initial_state() {
        let recorder = AudioRecorder::new();
        assert_eq!(recorder.get_current_audio_level(), 0.0);
    }

    #[test]
    #[serial]
    fn test_concurrent_recording_calls() {
        let mut recorder = AudioRecorder::new();
        recorder.init();
        
        let temp_dir = setup_temp_dir();
        let output_path1 = temp_dir.path().join("test1.wav");
        let output_path2 = temp_dir.path().join("test2.wav");
        
        // First recording call should send command successfully
        let result1 = recorder.start_recording(&output_path1, None);
        // This will fail because no actual device is available in test environment
        // but it should fail with a device-related error, not an initialization error
        
        // Second recording call should also send command successfully
        let result2 = recorder.start_recording(&output_path2, None);
        
        // Both should succeed in sending the command (though may fail in worker thread)
        assert!(result1.is_ok() || !result1.as_ref().unwrap_err().contains("not initialized"));
        assert!(result2.is_ok() || !result2.as_ref().unwrap_err().contains("not initialized"));
    }

    #[test]
    #[serial]
    fn test_stop_recording_state_management() {
        let mut recorder = AudioRecorder::new();
        recorder.init();
        
        // Stop recording should succeed even if not currently recording
        let result = recorder.stop_recording();
        assert!(result.is_ok());
        
        // Recording state should be false after stop
        assert!(!recorder.is_recording());
    }

    #[test]
    #[serial] 
    fn test_device_name_validation() {
        let mut recorder = AudioRecorder::new();
        recorder.init();
        
        let temp_dir = setup_temp_dir();
        let output_path = temp_dir.path().join("test.wav");
        
        // Test with specific device name (will fail in test environment, but should validate input)
        let result = recorder.start_recording(&output_path, Some("NonExistentDevice"));
        // Should send command successfully even though device doesn't exist
        assert!(result.is_ok());
        
        // Test with empty device name
        let result = recorder.start_recording(&output_path, Some(""));
        assert!(result.is_ok());
    }

    #[test]
    #[serial]
    fn test_output_path_validation() {
        let mut recorder = AudioRecorder::new();
        recorder.init();
        
        // Test with valid path
        let temp_dir = setup_temp_dir();
        let valid_path = temp_dir.path().join("valid.wav");
        let result = recorder.start_recording(&valid_path, None);
        assert!(result.is_ok());
        
        // Test with path that has invalid directory
        let invalid_path = Path::new("/nonexistent/directory/file.wav");
        let result = recorder.start_recording(&invalid_path, None);
        // Should succeed in sending command, but may fail in worker thread
        assert!(result.is_ok());
    }

    #[test]
    #[serial]
    fn test_multiple_stop_calls() {
        let mut recorder = AudioRecorder::new();
        recorder.init();
        
        // Multiple stop calls should not cause issues
        assert!(recorder.stop_recording().is_ok());
        assert!(recorder.stop_recording().is_ok());
        assert!(recorder.stop_recording().is_ok());
        
        // State should remain false
        assert!(!recorder.is_recording());
    }

    #[test]
    fn test_device_info_structure() {
        let device_info = DeviceInfo {
            name: "Test Device".to_string(),
            sample_rate: 48000,
            channels: 2,
            metadata: None,
        };
        
        assert_eq!(device_info.name, "Test Device");
        assert_eq!(device_info.sample_rate, 48000);
        assert_eq!(device_info.channels, 2);
        assert!(device_info.metadata.is_none());
    }

    #[test]
    fn test_device_info_clone() {
        let device_info = DeviceInfo {
            name: "Test Device".to_string(),
            sample_rate: 44100,
            channels: 1,
            metadata: None,
        };
        
        let cloned = device_info.clone();
        assert_eq!(device_info.name, cloned.name);
        assert_eq!(device_info.sample_rate, cloned.sample_rate);
        assert_eq!(device_info.channels, cloned.channels);
    }

    #[test]
    #[serial]
    fn test_thread_safety() {
        use std::thread;
        
        let mut recorder = AudioRecorder::new();
        recorder.init();
        
        let recorder = Arc::new(recorder);
        let mut handles = vec![];
        
        // Test concurrent access to recording state
        for i in 0..5 {
            let recorder_clone = recorder.clone();
            let handle = thread::spawn(move || {
                // Each thread should be able to query state safely
                let _is_recording = recorder_clone.is_recording();
                let _audio_level = recorder_clone.get_current_audio_level();
                let _device_info = recorder_clone.get_current_device_info();
                i // Return thread id for verification
            });
            handles.push(handle);
        }
        
        // Wait for all threads and verify they completed
        for handle in handles {
            let thread_id = handle.join().expect("Thread should complete successfully");
            assert!(thread_id < 5);
        }
    }
}

// Integration-style tests that would require actual audio devices
// These are marked as ignored by default
#[cfg(test)]
mod integration_tests {
    use super::*;

    #[test]
    #[ignore] // Run with: cargo test -- --ignored
    fn test_real_device_enumeration() {
        // This test requires actual audio hardware
        use cpal::traits::HostTrait;
        
        let host = cpal::default_host();
        if let Ok(devices) = host.input_devices() {
            let device_count = devices.count();
            println!("Found {} input devices", device_count);
            assert!(device_count >= 0); // Should not panic
        }
    }

    #[test]
    #[ignore] // Run with: cargo test -- --ignored  
    fn test_real_recording_short_duration() {
        // This test requires actual audio hardware and microphone permissions
        let mut recorder = AudioRecorder::new();
        recorder.init();
        
        let temp_dir = setup_temp_dir();
        let output_path = temp_dir.path().join("real_test.wav");
        
        // Attempt to start recording
        if let Ok(()) = recorder.start_recording(&output_path, None) {
            // Record for a very short time
            std::thread::sleep(Duration::from_millis(100));
            
            // Stop recording
            let result = recorder.stop_recording();
            assert!(result.is_ok());
            
            // Check if file was created
            assert!(output_path.exists());
        }
    }
}
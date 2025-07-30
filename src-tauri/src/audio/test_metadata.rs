#[cfg(test)]
mod tests {
    use super::super::metadata::*;
    use cpal::{SampleFormat, BufferSize};
    
    #[test]
    fn test_audio_metadata_creation() {
        let actual_config = cpal::StreamConfig {
            channels: 2,
            sample_rate: cpal::SampleRate(48000),
            buffer_size: BufferSize::Fixed(256),
        };
        
        let requested_config = cpal::StreamConfig {
            channels: 2,
            sample_rate: cpal::SampleRate(44100),
            buffer_size: BufferSize::Default,
        };
        
        let metadata = AudioMetadata::new(
            "Test Device".to_string(),
            Some(&requested_config),
            &actual_config,
            SampleFormat::F32,
            &BufferSize::Fixed(256),
            true,
        );
        
        // Check basic metadata
        assert_eq!(metadata.device.name, "Test Device");
        assert!(metadata.device.is_default);
        assert_eq!(metadata.format.sample_rate, 48000);
        assert_eq!(metadata.format.channels, 2);
        assert_eq!(metadata.format.bit_depth, 32);
        
        // Check for sample rate mismatch
        assert!(!metadata.mismatches.is_empty());
        let sample_rate_mismatch = metadata.mismatches.iter()
            .find(|m| m.mismatch_type == "sample_rate")
            .expect("Should have sample rate mismatch");
        assert!(sample_rate_mismatch.requested.contains("44100"));
        assert!(sample_rate_mismatch.actual.contains("48000"));
    }
    
    #[test]
    fn test_airpods_detection() {
        let config = cpal::StreamConfig {
            channels: 1,
            sample_rate: cpal::SampleRate(8000),
            buffer_size: BufferSize::Default,
        };
        
        let metadata = AudioMetadata::new(
            "AirPods Pro".to_string(),
            None,
            &config,
            SampleFormat::I16,
            &BufferSize::Default,
            false,
        );
        
        // Check that AirPods issues are detected
        assert!(!metadata.device.notes.is_empty());
        assert!(metadata.device.notes[0].contains("AirPods detected"));
        
        // Check for critical issues
        assert!(metadata.has_critical_issues());
        assert!(metadata.get_issues_summary().contains("chipmunk"));
    }
    
    #[test]
    fn test_metadata_json_serialization() {
        let config = cpal::StreamConfig {
            channels: 1,
            sample_rate: cpal::SampleRate(16000),
            buffer_size: BufferSize::Fixed(512),
        };
        
        let mut metadata = AudioMetadata::new(
            "Test Mic".to_string(),
            None,
            &config,
            SampleFormat::F32,
            &BufferSize::Fixed(512),
            true,
        );
        
        metadata.set_recording_info(true, "push-to-talk", Some(100));
        
        let json = metadata.to_json().expect("Should serialize to JSON");
        assert!(json.contains("\"vad_enabled\":true"));
        assert!(json.contains("\"trigger_type\":\"push-to-talk\""));
        assert!(json.contains("\"silence_padding_ms\":100"));
    }
}
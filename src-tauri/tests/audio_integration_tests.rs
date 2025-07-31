// Integration tests for Scout audio module
//
// These tests complement the unit tests by testing public APIs
// and integration scenarios without accessing private modules.

use tempfile::TempDir;
use hound::{WavSpec, SampleFormat, WavReader};
use std::fs;

mod common;
use common::*;

#[test]
fn test_wav_file_creation() {
    let temp_dir = TempDir::new().unwrap();
    let file_path = temp_dir.path().join("test.wav");
    
    // Create a test WAV file
    let spec = WavSpec {
        channels: 1,
        sample_rate: 16000,
        bits_per_sample: 16,
        sample_format: SampleFormat::Int,
    };
    
    let samples = create_test_audio_buffer(1.0, 16000, 440.0);
    let i16_samples = convert_f32_to_i16(&samples);
    
    create_wav_file(&file_path, spec, &i16_samples).unwrap();
    
    // Verify the file was created
    assert!(file_path.exists());
    
    // Read it back and verify
    let mut reader = WavReader::open(&file_path).unwrap();
    let read_spec = reader.spec();
    assert_eq!(read_spec.channels, 1);
    assert_eq!(read_spec.sample_rate, 16000);
    assert_eq!(read_spec.bits_per_sample, 16);
    
    let read_samples: Vec<i16> = reader.samples::<i16>()
        .map(|s| s.unwrap())
        .collect();
    
    assert_eq!(read_samples.len(), i16_samples.len());
}

#[test]
fn test_audio_buffer_generation() {
    // Test various audio generation functions
    let sine = create_test_audio_buffer(0.5, 16000, 440.0);
    assert_eq!(sine.len(), 8000);
    
    let silence = create_silence_buffer(0.5, 16000);
    assert_eq!(silence.len(), 8000);
    assert!(silence.iter().all(|&s| s == 0.0));
    
    let mixed = create_mixed_audio_buffer(0.1, 0.1, 16000, 440.0, 3);
    assert_eq!(mixed.len(), 9600); // (0.1 + 0.1) * 16000 * 3
}

#[test]
fn test_audio_format_conversions() {
    let f32_samples = vec![-1.0, -0.5, 0.0, 0.5, 1.0];
    let i16_samples = convert_f32_to_i16(&f32_samples);
    
    // Test conversion boundaries
    assert_eq!(i16_samples[0], i16::MIN + 1); // -1.0 maps to near i16::MIN
    assert_eq!(i16_samples[2], 0); // 0.0 maps to 0
    assert_eq!(i16_samples[4], i16::MAX); // 1.0 maps to i16::MAX
    
    // Test clamping
    let out_of_range = vec![-2.0, 2.0];
    let clamped = convert_f32_to_i16(&out_of_range);
    assert_eq!(clamped[0], i16::MIN + 1);
    assert_eq!(clamped[1], i16::MAX);
}

#[test]
fn test_concurrent_file_operations() {
    use std::thread;
    use std::sync::Arc;
    
    let temp_dir = Arc::new(TempDir::new().unwrap());
    let mut handles = vec![];
    
    // Spawn multiple threads writing different files
    for i in 0..5 {
        let dir = Arc::clone(&temp_dir);
        let handle = thread::spawn(move || {
            let file_path = dir.path().join(format!("concurrent_{}.wav", i));
            let spec = WavSpec {
                channels: 1,
                sample_rate: 16000,
                bits_per_sample: 16,
                sample_format: SampleFormat::Int,
            };
            
            let frequency = 440.0 + (i as f32 * 100.0);
            let samples = create_test_audio_buffer(0.1, 16000, frequency);
            let i16_samples = convert_f32_to_i16(&samples);
            
            create_wav_file(&file_path, spec, &i16_samples).unwrap();
            assert!(file_path.exists());
        });
        handles.push(handle);
    }
    
    // Wait for all threads
    for handle in handles {
        handle.join().unwrap();
    }
    
    // Verify all files were created
    let entries = fs::read_dir(temp_dir.path()).unwrap();
    let wav_files: Vec<_> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map_or(false, |ext| ext == "wav"))
        .collect();
    
    assert_eq!(wav_files.len(), 5);
}

#[test]
#[ignore] // This test requires audio hardware
fn test_real_audio_device_enumeration() {
    use cpal::traits::{DeviceTrait, HostTrait};
    
    let host = cpal::default_host();
    
    // Test default device access
    if let Some(device) = host.default_input_device() {
        println!("Default input device: {}", device.name().unwrap_or_default());
        
        // Test supported configs
        let configs: Vec<_> = device.supported_input_configs()
            .map(|configs| configs.collect::<Vec<_>>())
            .unwrap_or_default();
        
        assert!(!configs.is_empty(), "Device should support at least one config");
        
        for config in configs.iter().take(3) {
            println!("  Supported config: {:?}", config);
        }
    }
    
    // Test device enumeration
    let devices: Vec<_> = host.input_devices()
        .map(|devices| devices.collect::<Vec<_>>())
        .unwrap_or_default();
    
    println!("Found {} input devices", devices.len());
    for device in devices {
        println!("  Device: {}", device.name().unwrap_or_default());
    }
}
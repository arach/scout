/// Unit tests for SimpleAudioRecorder
/// 
/// Tests focus on:
/// - Recording lifecycle management
/// - Sample writing performance
/// - State transitions
/// - Error handling
/// - Resource cleanup

use scout::audio::simple_recorder::{SimpleAudioRecorder, RecorderState, RecordingInfo};
use hound::WavSpec;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tempfile::TempDir;

// Import common test utilities
#[path = "../common/simplified_pipeline.rs"]
mod common;
use common::*;

#[test]
fn test_recorder_creation() {
    let spec = WavSpec {
        channels: 1,
        sample_rate: 48000,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    
    let recorder = SimpleAudioRecorder::new(spec.clone());
    
    // Should start in idle state
    assert!(matches!(recorder.get_state(), RecorderState::Idle));
}

#[test]
fn test_recording_state_transitions() {
    let temp_dir = TempDir::new().unwrap();
    let output_path = temp_dir.path().join("state_test.wav");
    
    let spec = WavSpec {
        channels: 1,
        sample_rate: 48000,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    
    let recorder = SimpleAudioRecorder::new(spec);
    
    // Initial state: Idle
    assert!(matches!(recorder.get_state(), RecorderState::Idle));
    
    // Start recording -> Recording state
    recorder.start_recording(&output_path).unwrap();
    if let RecorderState::Recording { path, .. } = recorder.get_state() {
        assert_eq!(path, output_path);
    } else {
        panic!("Expected Recording state");
    }
    
    // Stop recording -> back to Idle
    recorder.stop_recording().unwrap();
    assert!(matches!(recorder.get_state(), RecorderState::Idle));
}

#[test]
fn test_sample_writing() {
    let temp_dir = TempDir::new().unwrap();
    let output_path = temp_dir.path().join("samples.wav");
    
    let spec = WavSpec {
        channels: 1,
        sample_rate: 48000,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    
    let recorder = SimpleAudioRecorder::new(spec);
    recorder.start_recording(&output_path).unwrap();
    
    // Write various sample sizes
    let test_cases = vec![
        vec![0.0f32; 100],       // Small buffer
        vec![0.5f32; 1000],      // Medium buffer  
        vec![-0.5f32; 48000],    // 1 second
        vec![1.0f32; 480000],    // 10 seconds
    ];
    
    for samples in test_cases {
        let count = samples.len();
        recorder.write_samples(&samples).unwrap();
        
        // Verify samples are tracked
        if let RecorderState::Recording { samples_written, .. } = recorder.get_state() {
            assert!(samples_written > 0);
        }
    }
    
    let info = recorder.stop_recording().unwrap();
    assert!(info.duration_samples > 0);
    assert!(output_path.exists());
    
    // Verify file integrity
    let wav_info = verify_wav_file(&output_path).unwrap();
    assert_eq!(wav_info.sample_rate, 48000);
    assert_eq!(wav_info.channels, 1);
}

#[test]
fn test_recording_info_accuracy() {
    let temp_dir = TempDir::new().unwrap();
    let output_path = temp_dir.path().join("info_test.wav");
    
    let spec = WavSpec {
        channels: 2,
        sample_rate: 44100,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    
    let recorder = SimpleAudioRecorder::new(spec);
    recorder.start_recording(&output_path).unwrap();
    
    // Write exactly 44100 samples (1 second at 44.1kHz)
    let samples = vec![0.0f32; 44100 * 2]; // 2 channels
    recorder.write_samples(&samples).unwrap();
    
    let info = recorder.stop_recording().unwrap();
    
    assert_eq!(info.path, output_path);
    assert_eq!(info.sample_rate, 44100);
    assert_eq!(info.channels, 2);
    assert_eq!(info.duration_samples, 44100);
    assert_approx_eq(info.duration_seconds, 1.0, 0.01, "Duration should be ~1 second");
}

#[test]
fn test_concurrent_recording_prevention() {
    let temp_dir = TempDir::new().unwrap();
    let path1 = temp_dir.path().join("recording1.wav");
    let path2 = temp_dir.path().join("recording2.wav");
    
    let spec = WavSpec {
        channels: 1,
        sample_rate: 48000,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    
    let recorder = SimpleAudioRecorder::new(spec);
    
    // Start first recording
    recorder.start_recording(&path1).unwrap();
    
    // Second recording should fail
    let result = recorder.start_recording(&path2);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("not idle"));
    
    // Clean up
    recorder.stop_recording().unwrap();
}

#[test]
fn test_stop_without_start() {
    let spec = WavSpec {
        channels: 1,
        sample_rate: 48000,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    
    let recorder = SimpleAudioRecorder::new(spec);
    
    // Stopping when not recording should return error
    let result = recorder.stop_recording();
    assert!(result.is_err());
}

#[test]
fn test_write_samples_without_recording() {
    let spec = WavSpec {
        channels: 1,
        sample_rate: 48000,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    
    let recorder = SimpleAudioRecorder::new(spec);
    let samples = vec![0.0f32; 100];
    
    // Writing samples when not recording should fail
    let result = recorder.write_samples(&samples);
    assert!(result.is_err());
}

#[test]
fn test_invalid_file_path() {
    let spec = WavSpec {
        channels: 1,
        sample_rate: 48000,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    
    let recorder = SimpleAudioRecorder::new(spec);
    
    // Test with non-existent directory
    let invalid_path = PathBuf::from("/nonexistent/directory/file.wav");
    let result = recorder.start_recording(&invalid_path);
    assert!(result.is_err());
    
    // Recorder should remain in valid state
    assert!(matches!(
        recorder.get_state(),
        RecorderState::Idle | RecorderState::Error(_)
    ));
}

#[test]
fn test_recording_startup_performance() {
    let temp_dir = TempDir::new().unwrap();
    let spec = WavSpec {
        channels: 1,
        sample_rate: 48000,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    
    let recorder = SimpleAudioRecorder::new(spec);
    
    // Measure startup times for multiple recordings
    let mut startup_times = Vec::new();
    
    for i in 0..10 {
        let output_path = temp_dir.path().join(format!("perf_{}.wav", i));
        
        let start = Instant::now();
        recorder.start_recording(&output_path).unwrap();
        let startup_time = start.elapsed();
        startup_times.push(startup_time);
        
        // Write minimal data and stop
        recorder.write_samples(&vec![0.0f32; 100]).unwrap();
        recorder.stop_recording().unwrap();
    }
    
    // All startups should be under 100ms
    for (i, time) in startup_times.iter().enumerate() {
        assert!(
            time.as_millis() < 100,
            "Recording {} startup took {:?}, expected < 100ms",
            i,
            time
        );
    }
    
    // Calculate average
    let avg_ms = startup_times.iter()
        .map(|d| d.as_millis() as u64)
        .sum::<u64>() / startup_times.len() as u64;
    
    println!("Average recording startup time: {}ms", avg_ms);
}

#[test]
fn test_sample_writing_performance() {
    let temp_dir = TempDir::new().unwrap();
    let output_path = temp_dir.path().join("write_perf.wav");
    
    let spec = WavSpec {
        channels: 1,
        sample_rate: 48000,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    
    let recorder = SimpleAudioRecorder::new(spec);
    recorder.start_recording(&output_path).unwrap();
    
    // Test writing performance for various buffer sizes
    let buffer_sizes = vec![
        480,    // 10ms
        2400,   // 50ms  
        4800,   // 100ms
        48000,  // 1 second
        480000, // 10 seconds
    ];
    
    let mut perf_tracker = PerformanceTracker::new();
    
    for size in buffer_sizes {
        let samples = vec![0.0f32; size];
        
        let start = Instant::now();
        recorder.write_samples(&samples).unwrap();
        let duration = start.elapsed();
        
        perf_tracker.record(&format!("Write {} samples", size), duration);
        
        // Writing should be much faster than real-time
        let audio_duration_ms = (size as f64 / 48.0) as u64; // ms of audio
        assert!(
            duration.as_millis() < audio_duration_ms as u128 / 10,
            "Writing {}ms of audio took {:?}",
            audio_duration_ms,
            duration
        );
    }
    
    recorder.stop_recording().unwrap();
    perf_tracker.print_report();
}

#[test]
fn test_cleanup_on_drop() {
    let temp_dir = TempDir::new().unwrap();
    let output_path = temp_dir.path().join("drop_test.wav");
    
    {
        let spec = WavSpec {
            channels: 1,
            sample_rate: 48000,
            bits_per_sample: 32,
            sample_format: hound::SampleFormat::Float,
        };
        
        let recorder = SimpleAudioRecorder::new(spec);
        recorder.start_recording(&output_path).unwrap();
        recorder.write_samples(&vec![0.0f32; 1000]).unwrap();
        
        // Recorder dropped here without explicit stop
    }
    
    // File should still exist and be valid (RAII cleanup)
    assert!(output_path.exists());
    
    // Should be able to read the file
    let wav_info = verify_wav_file(&output_path);
    assert!(wav_info.is_ok());
}

#[test]
fn test_no_ring_buffer_files_created() {
    let temp_dir = TempDir::new().unwrap();
    let output_path = temp_dir.path().join("no_ring_buffer.wav");
    
    let spec = WavSpec {
        channels: 1,
        sample_rate: 48000,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    
    let recorder = SimpleAudioRecorder::new(spec);
    recorder.start_recording(&output_path).unwrap();
    
    // Write substantial amount of data
    for _ in 0..100 {
        recorder.write_samples(&vec![0.0f32; 4800]).unwrap();
    }
    
    recorder.stop_recording().unwrap();
    
    // Check that no ring buffer files were created
    let entries: Vec<_> = std::fs::read_dir(temp_dir.path())
        .unwrap()
        .filter_map(|e| e.ok())
        .collect();
    
    for entry in &entries {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        assert!(
            !name_str.contains("ring_buffer"),
            "Found unexpected ring buffer file: {}",
            name_str
        );
    }
    
    // Should only have the single output file
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].file_name(), "no_ring_buffer.wav");
}

#[test]
fn test_empty_recording() {
    let temp_dir = TempDir::new().unwrap();
    let output_path = temp_dir.path().join("empty.wav");
    
    let spec = WavSpec {
        channels: 1,
        sample_rate: 48000,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    
    let recorder = SimpleAudioRecorder::new(spec);
    recorder.start_recording(&output_path).unwrap();
    
    // Stop immediately without writing samples
    let info = recorder.stop_recording().unwrap();
    
    assert_eq!(info.duration_samples, 0);
    assert_eq!(info.duration_seconds, 0.0);
    
    // File should still be created and valid
    assert!(output_path.exists());
}

#[test] 
fn test_large_buffer_handling() {
    let temp_dir = TempDir::new().unwrap();
    let output_path = temp_dir.path().join("large_buffer.wav");
    
    let spec = WavSpec {
        channels: 1,
        sample_rate: 48000,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    
    let recorder = SimpleAudioRecorder::new(spec);
    recorder.start_recording(&output_path).unwrap();
    
    // Write 1 minute of audio in one go
    let large_buffer = vec![0.0f32; 48000 * 60];
    let start = Instant::now();
    recorder.write_samples(&large_buffer).unwrap();
    let duration = start.elapsed();
    
    println!("Writing 1 minute of audio took: {:?}", duration);
    assert!(duration.as_secs() < 1, "Should write 1 minute of audio in < 1 second");
    
    let info = recorder.stop_recording().unwrap();
    assert_eq!(info.duration_samples, 48000 * 60);
    assert_approx_eq(info.duration_seconds, 60.0, 0.01, "Should be 60 seconds");
}
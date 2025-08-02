/// Performance benchmarks for the simplified pipeline
/// 
/// Run with: cargo test --test simplified_benchmarks --release -- --nocapture
/// For stress tests: cargo test --test simplified_benchmarks --release -- --ignored --nocapture

use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};
use scout::{
    audio::simple_recorder::SimpleAudioRecorder,
    transcription::simple_transcriber::SimpleTranscriptionService,
};
use std::time::Duration;
use tempfile::TempDir;
use hound::WavSpec;

// Import common utilities
#[path = "../common/simplified_pipeline.rs"]
mod common;
use common::*;

/// Benchmark recording startup latency
fn bench_recording_startup(c: &mut Criterion) {
    let mut group = c.benchmark_group("recording_startup");
    group.measurement_time(Duration::from_secs(10));
    
    let temp_dir = TempDir::new().unwrap();
    
    // Test different sample rates
    for sample_rate in &[16000u32, 44100, 48000] {
        group.bench_with_input(
            BenchmarkId::from_parameter(format!("{}Hz", sample_rate)),
            sample_rate,
            |b, &sample_rate| {
                let spec = WavSpec {
                    channels: 1,
                    sample_rate,
                    bits_per_sample: 32,
                    sample_format: hound::SampleFormat::Float,
                };
                
                let recorder = SimpleAudioRecorder::new(spec);
                let mut counter = 0;
                
                b.iter(|| {
                    let path = temp_dir.path().join(format!("bench_{}.wav", counter));
                    counter += 1;
                    
                    // Measure startup time
                    recorder.start_recording(&path).unwrap();
                    recorder.stop_recording().unwrap();
                });
            },
        );
    }
    
    group.finish();
}

/// Benchmark sample writing throughput
fn bench_sample_writing(c: &mut Criterion) {
    let mut group = c.benchmark_group("sample_writing");
    group.measurement_time(Duration::from_secs(10));
    
    let temp_dir = TempDir::new().unwrap();
    
    // Test different buffer sizes
    for buffer_size in &[480usize, 4800, 48000, 480000] {
        let duration_ms = (*buffer_size as f64 / 48.0) as u64;
        
        group.bench_with_input(
            BenchmarkId::from_parameter(format!("{}ms", duration_ms)),
            buffer_size,
            |b, &buffer_size| {
                let spec = WavSpec {
                    channels: 1,
                    sample_rate: 48000,
                    bits_per_sample: 32,
                    sample_format: hound::SampleFormat::Float,
                };
                
                let recorder = SimpleAudioRecorder::new(spec);
                let path = temp_dir.path().join("write_bench.wav");
                recorder.start_recording(&path).unwrap();
                
                let samples = vec![0.0f32; buffer_size];
                
                b.iter(|| {
                    recorder.write_samples(black_box(&samples)).unwrap();
                });
                
                recorder.stop_recording().unwrap();
            },
        );
    }
    
    group.finish();
}

/// Benchmark complete recording session
fn bench_recording_session(c: &mut Criterion) {
    let mut group = c.benchmark_group("recording_session");
    group.measurement_time(Duration::from_secs(20));
    group.sample_size(20);
    
    let temp_dir = TempDir::new().unwrap();
    
    // Test different recording durations
    for duration_secs in &[1u64, 5, 10] {
        group.bench_with_input(
            BenchmarkId::from_parameter(format!("{}s", duration_secs)),
            duration_secs,
            |b, &duration_secs| {
                let spec = WavSpec {
                    channels: 1,
                    sample_rate: 48000,
                    bits_per_sample: 32,
                    sample_format: hound::SampleFormat::Float,
                };
                
                let mut counter = 0;
                
                b.iter(|| {
                    let recorder = SimpleAudioRecorder::new(spec.clone());
                    let path = temp_dir.path().join(format!("session_{}.wav", counter));
                    counter += 1;
                    
                    // Complete recording session
                    recorder.start_recording(&path).unwrap();
                    
                    // Write audio data
                    let total_samples = 48000 * duration_secs as usize;
                    let chunk_size = 4800; // 100ms chunks
                    
                    for _ in 0..(total_samples / chunk_size) {
                        let samples = vec![0.0f32; chunk_size];
                        recorder.write_samples(&samples).unwrap();
                    }
                    
                    let _info = recorder.stop_recording().unwrap();
                });
            },
        );
    }
    
    group.finish();
}

/// Benchmark memory allocation patterns
fn bench_memory_allocation(c: &mut Criterion) {
    let mut group = c.benchmark_group("memory_allocation");
    
    group.bench_function("buffer_allocation", |b| {
        b.iter(|| {
            // Simulate typical buffer allocation patterns
            let buffer_sizes = vec![480, 4800, 48000];
            for size in buffer_sizes {
                let _buffer: Vec<f32> = black_box(vec![0.0; size]);
            }
        });
    });
    
    group.bench_function("reusable_buffer", |b| {
        let mut buffer = vec![0.0f32; 48000];
        
        b.iter(|| {
            // Simulate reusing a buffer
            for i in 0..buffer.len() {
                buffer[i] = black_box(i as f32 * 0.001);
            }
        });
    });
    
    group.finish();
}

/// Benchmark file I/O operations
fn bench_file_io(c: &mut Criterion) {
    let mut group = c.benchmark_group("file_io");
    let temp_dir = TempDir::new().unwrap();
    
    // Generate test data
    let test_sizes = vec![
        ("1KB", 1024),
        ("100KB", 102400),
        ("1MB", 1048576),
        ("10MB", 10485760),
    ];
    
    for (label, size) in test_sizes {
        let data = vec![0u8; size];
        
        group.bench_with_input(
            BenchmarkId::from_parameter(label),
            &data,
            |b, data| {
                let mut counter = 0;
                
                b.iter(|| {
                    let path = temp_dir.path().join(format!("io_bench_{}.dat", counter));
                    counter += 1;
                    
                    // Write data
                    std::fs::write(&path, black_box(data)).unwrap();
                    
                    // Read back
                    let _read_data = std::fs::read(&path).unwrap();
                    
                    // Clean up
                    std::fs::remove_file(&path).unwrap();
                });
            },
        );
    }
    
    group.finish();
}

/// Stress test: Long duration recording
#[test]
#[ignore] // Run with --ignored flag
fn stress_test_long_recording() {
    let temp_dir = TempDir::new().unwrap();
    let output_path = temp_dir.path().join("long_recording.wav");
    
    let spec = WavSpec {
        channels: 1,
        sample_rate: 48000,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    
    let recorder = SimpleAudioRecorder::new(spec);
    recorder.start_recording(&output_path).unwrap();
    
    let start = std::time::Instant::now();
    let target_duration = Duration::from_secs(1800); // 30 minutes
    let chunk_size = 48000; // 1 second chunks
    let mut samples_written = 0u64;
    let mut max_memory = get_memory_usage_mb();
    
    while start.elapsed() < target_duration {
        let samples = vec![0.0f32; chunk_size];
        recorder.write_samples(&samples).unwrap();
        samples_written += chunk_size as u64;
        
        // Check memory every 60 seconds
        if samples_written % (48000 * 60) == 0 {
            let current_memory = get_memory_usage_mb();
            max_memory = max_memory.max(current_memory);
            
            let minutes = samples_written / (48000 * 60);
            println!("Progress: {} minutes, Memory: {}MB", minutes, current_memory);
        }
    }
    
    let info = recorder.stop_recording().unwrap();
    
    println!("\n=== Long Recording Stress Test Results ===");
    println!("Duration: {:.2} seconds", info.duration_seconds);
    println!("Samples: {}", info.duration_samples);
    println!("File size: {} MB", std::fs::metadata(&output_path).unwrap().len() / 1_000_000);
    println!("Max memory: {} MB", max_memory);
    
    // Verify no memory leaks (memory should be stable)
    assert!(max_memory < 300, "Memory usage exceeded 300MB: {}MB", max_memory);
}

/// Stress test: Rapid start/stop cycles
#[test]
#[ignore] // Run with --ignored flag
fn stress_test_rapid_cycles() {
    let temp_dir = TempDir::new().unwrap();
    let spec = WavSpec {
        channels: 1,
        sample_rate: 48000,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    
    let recorder = SimpleAudioRecorder::new(spec);
    let cycles = 1000;
    let mut startup_times = Vec::new();
    
    println!("\n=== Rapid Cycle Stress Test ===");
    println!("Running {} start/stop cycles...", cycles);
    
    for i in 0..cycles {
        let path = temp_dir.path().join(format!("cycle_{}.wav", i));
        
        let start = std::time::Instant::now();
        recorder.start_recording(&path).unwrap();
        let startup_time = start.elapsed();
        startup_times.push(startup_time.as_micros() as u64);
        
        // Write minimal data
        recorder.write_samples(&vec![0.0f32; 100]).unwrap();
        
        recorder.stop_recording().unwrap();
        
        // Progress report every 100 cycles
        if (i + 1) % 100 == 0 {
            let avg_startup = startup_times.iter().sum::<u64>() / startup_times.len() as u64;
            println!("Completed {} cycles, avg startup: {}µs", i + 1, avg_startup);
        }
    }
    
    // Calculate statistics
    let avg_startup = startup_times.iter().sum::<u64>() / startup_times.len() as u64;
    let max_startup = startup_times.iter().max().unwrap();
    let min_startup = startup_times.iter().min().unwrap();
    
    println!("\n=== Results ===");
    println!("Average startup: {}µs", avg_startup);
    println!("Min startup: {}µs", min_startup);
    println!("Max startup: {}µs", max_startup);
    
    // All startups should be under 100ms (100,000µs)
    assert!(*max_startup < 100_000, "Max startup exceeded 100ms: {}µs", max_startup);
}

/// Stress test: Concurrent write attempts
#[test]
#[ignore] // Run with --ignored flag
fn stress_test_concurrent_writes() {
    use std::sync::Arc;
    use std::thread;
    
    let temp_dir = TempDir::new().unwrap();
    let output_path = temp_dir.path().join("concurrent.wav");
    
    let spec = WavSpec {
        channels: 1,
        sample_rate: 48000,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    
    let recorder = Arc::new(SimpleAudioRecorder::new(spec));
    recorder.start_recording(&output_path).unwrap();
    
    let thread_count = 10;
    let writes_per_thread = 100;
    
    println!("\n=== Concurrent Write Stress Test ===");
    println!("Starting {} threads, each writing {} times", thread_count, writes_per_thread);
    
    let handles: Vec<_> = (0..thread_count)
        .map(|thread_id| {
            let recorder = recorder.clone();
            thread::spawn(move || {
                for i in 0..writes_per_thread {
                    let samples = vec![thread_id as f32 * 0.1; 480]; // Small buffer
                    match recorder.write_samples(&samples) {
                        Ok(_) => {},
                        Err(e) => {
                            println!("Thread {} write {} failed: {}", thread_id, i, e);
                        }
                    }
                    thread::sleep(Duration::from_micros(100));
                }
            })
        })
        .collect();
    
    // Wait for all threads
    for handle in handles {
        handle.join().unwrap();
    }
    
    let info = recorder.stop_recording().unwrap();
    
    println!("\n=== Results ===");
    println!("Total samples written: {}", info.duration_samples);
    println!("File created successfully: {}", output_path.exists());
}

/// Benchmark comparison: Simplified vs Legacy (when available)
#[test]
fn bench_pipeline_comparison() {
    let temp_dir = TempDir::new().unwrap();
    let test_duration = Duration::from_secs(5);
    
    println!("\n=== Pipeline Comparison Benchmark ===");
    
    // Benchmark simplified pipeline
    let simplified_start = std::time::Instant::now();
    {
        let spec = WavSpec {
            channels: 1,
            sample_rate: 48000,
            bits_per_sample: 32,
            sample_format: hound::SampleFormat::Float,
        };
        
        let recorder = SimpleAudioRecorder::new(spec);
        let path = temp_dir.path().join("simplified.wav");
        
        recorder.start_recording(&path).unwrap();
        
        // Simulate 5 seconds of recording
        for _ in 0..50 {
            let samples = vec![0.0f32; 4800]; // 100ms chunks
            recorder.write_samples(&samples).unwrap();
            std::thread::sleep(Duration::from_millis(100));
        }
        
        let info = recorder.stop_recording().unwrap();
        println!("Simplified: {} samples in {:?}", info.duration_samples, simplified_start.elapsed());
    }
    
    // TODO: Add legacy pipeline benchmark when available
    // let legacy_start = std::time::Instant::now();
    // ...
    
    println!("\nResults:");
    println!("Simplified pipeline: {:?}", simplified_start.elapsed());
    // println!("Legacy pipeline: {:?}", legacy_start.elapsed());
}

// Criterion benchmark groups
criterion_group!(
    benches,
    bench_recording_startup,
    bench_sample_writing,
    bench_recording_session,
    bench_memory_allocation,
    bench_file_io
);

criterion_main!(benches);

// Helper function
fn get_memory_usage_mb() -> usize {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let output = Command::new("ps")
            .args(&["-o", "rss=", "-p", &std::process::id().to_string()])
            .output()
            .unwrap();
        String::from_utf8_lossy(&output.stdout)
            .trim()
            .parse::<usize>()
            .unwrap_or(0) / 1024
    }
    #[cfg(not(target_os = "macos"))]
    {
        0
    }
}
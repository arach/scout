// Quick test script for SimpleCpalRecorder
use scout_lib::audio::simple_cpal_recorder::SimpleCpalRecorder;
use std::path::Path;
use std::thread;
use std::time::Duration;

fn main() {
    // Initialize logger with debug level
    std::env::set_var("RUST_LOG", "debug");
    env_logger::init();
    
    println!("Creating SimpleCpalRecorder...");
    let recorder = SimpleCpalRecorder::new();
    
    let output_path = Path::new("/tmp/test_recording.wav");
    println!("Starting recording to {:?}...", output_path);
    
    match recorder.start_recording(output_path, None) {
        Ok(_) => println!("Recording started successfully!"),
        Err(e) => {
            eprintln!("Failed to start recording: {}", e);
            return;
        }
    }
    
    // Record for 3 seconds
    println!("Recording for 3 seconds...");
    thread::sleep(Duration::from_secs(3));
    
    println!("Stopping recording...");
    match recorder.stop_recording() {
        Ok(info) => {
            println!("Recording stopped successfully!");
            println!("Recording info:");
            println!("  Path: {:?}", info.path);
            println!("  Duration: {:.2} seconds", info.duration_seconds);
            println!("  Samples: {}", info.duration_samples);
            println!("  Sample rate: {} Hz", info.sample_rate);
            println!("  Channels: {}", info.channels);
            
            // Check file size
            if let Ok(metadata) = std::fs::metadata(&info.path) {
                println!("  File size: {} bytes", metadata.len());
            }
        }
        Err(e) => eprintln!("Failed to stop recording: {}", e),
    }
}
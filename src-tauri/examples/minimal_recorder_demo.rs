/// Demonstration of the minimal CPAL recorder - DISABLED due to refactoring
/// This example needs to be updated after audio module restructuring
/// Run with: cargo run --example minimal_recorder_demo

// Temporarily disabled due to module reorganization
#[cfg(disabled)]
use scout::audio::minimal_recorder::{MinimalAudioRecorder, RecordingInfo};
use std::path::Path;
use std::time::Duration;

fn main() {
    println!("🎙️ Minimal CPAL Recorder Demo - DISABLED");
    println!("==========================================");
    println!("This example is temporarily disabled due to module refactoring.");
    println!("It needs to be updated to work with the new audio architecture.");
    return;
    
    // List available devices
    println!("\n📋 Available input devices:");
    match MinimalAudioRecorder::list_devices() {
        Ok(devices) => {
            if devices.is_empty() {
                println!("  ❌ No input devices found!");
                return;
            }
            for (i, device) in devices.iter().enumerate() {
                println!("  {}. {}", i + 1, device);
            }
        }
        Err(e) => {
            println!("  ❌ Failed to list devices: {}", e);
            return;
        }
    }
    
    // Create recorder
    let mut recorder = MinimalAudioRecorder::new();
    let output_path = Path::new("minimal_recording.wav");
    
    println!("\n🎯 Recording to: {:?}", output_path);
    println!("⏱️ Recording for 3 seconds...\n");
    
    // Start recording
    match recorder.start_recording(output_path, None) {
        Ok(_) => println!("✅ Recording started with default device"),
        Err(e) => {
            println!("❌ Failed to start recording: {}", e);
            return;
        }
    }
    
    // Show recording progress
    for i in 1..=3 {
        std::thread::sleep(Duration::from_secs(1));
        println!("  {}...", i);
    }
    
    // Stop recording
    println!("\n⏹️ Stopping recording...");
    match recorder.stop_recording() {
        Ok(info) => {
            println!("\n✅ Recording completed successfully!");
            print_recording_info(&info);
            
            // Verify file
            if let Ok(metadata) = std::fs::metadata(&info.path) {
                println!("\n📁 File verification:");
                println!("  - File exists: ✅");
                println!("  - File size: {} KB", metadata.len() / 1024);
                
                if metadata.len() > 44 {
                    println!("  - Contains audio data: ✅");
                } else {
                    println!("  - Contains audio data: ❌ (only header)");
                }
            }
        }
        Err(e) => println!("❌ Failed to stop recording: {}", e),
    }
    
    println!("\n🎉 Demo completed!");
}

fn print_recording_info(info: &RecordingInfo) {
    println!("\n📊 Recording Information:");
    println!("  ├─ File: {:?}", info.path);
    println!("  ├─ Duration: {:.2} seconds", info.duration_seconds);
    println!("  ├─ Sample Rate: {} Hz", info.sample_rate);
    println!("  ├─ Channels: {}", info.channels);
    println!("  └─ Total Samples: {}", info.samples_written);
    
    // Calculate expected vs actual samples
    let expected_samples = (info.duration_seconds * info.sample_rate as f64 * info.channels as f64) as u64;
    let accuracy = (info.samples_written as f64 / expected_samples as f64) * 100.0;
    
    println!("\n📈 Performance Metrics:");
    println!("  ├─ Expected samples: {}", expected_samples);
    println!("  ├─ Actual samples: {}", info.samples_written);
    println!("  └─ Accuracy: {:.1}%", accuracy);
}
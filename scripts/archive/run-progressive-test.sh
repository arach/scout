#!/bin/bash

echo "Progressive Transcription Test"
echo "=============================="
echo ""

RECORDINGS_DIR="/Users/arach/Library/Application Support/com.scout.app/recordings"
OUTPUT_DIR="progressive_test_results_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$OUTPUT_DIR"

# Selected recordings
LONG_RECORDINGS=(
    "recording_20250717_213547.wav"  # ~370s (longest)
    "recording_20250717_202651.wav"  # ~270s
)

SHORT_RECORDINGS=(
    "recording_20250717_200446.wav"  # ~20s
    "recording_20250718_085337.wav"  # ~30s
)

# Test chunk sizes
CHUNK_SIZES=(5 10 15 20)

echo "Test Recordings:"
echo "Long recordings (>30s):"
for r in "${LONG_RECORDINGS[@]}"; do
    echo "  - $r"
done
echo ""
echo "Short recordings (<30s):"
for r in "${SHORT_RECORDINGS[@]}"; do
    echo "  - $r"
done
echo ""

# Function to process a recording with progressive strategy
process_recording() {
    local recording=$1
    local chunk_size=$2
    local recording_path="$RECORDINGS_DIR/$recording"
    local output_file="$OUTPUT_DIR/${recording%.wav}_chunk${chunk_size}s.log"
    
    echo "Processing $recording with ${chunk_size}s chunks..."
    
    # Create a temporary Rust script to test the recording
    cat > "$OUTPUT_DIR/test_progressive.rs" << EOF
use std::path::Path;
use std::time::Instant;
use std::sync::Arc;
use tokio::sync::Mutex;

#[path = "../src-tauri/src/lib.rs"]
mod scout_lib;

use scout_lib::transcription::{TranscriptionConfig, TranscriptionStrategySelector, Transcriber};
use scout_lib::logger::{init_logger, info, Component};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    init_logger();
    
    let models_dir = Path::new("/Users/arach/Library/Application Support/com.scout.app/models");
    let temp_dir = Path::new("/tmp/scout_progressive_test");
    std::fs::create_dir_all(&temp_dir)?;
    
    let recording_path = Path::new("$recording_path");
    println!("Testing: {}", recording_path.display());
    println!("Chunk size: ${chunk_size}s");
    
    // Create config
    let mut config = TranscriptionConfig::default();
    config.force_strategy = Some("progressive".to_string());
    config.refinement_chunk_secs = Some(${chunk_size});
    
    // Load audio file to get duration
    let reader = hound::WavReader::open(recording_path)?;
    let spec = reader.spec();
    let sample_count = reader.len();
    let duration_secs = sample_count as f32 / spec.sample_rate as f32;
    println!("Duration: {:.1}s", duration_secs);
    
    // Create transcriber
    let medium_path = models_dir.join("ggml-medium.en.bin");
    let transcriber = Transcriber::get_or_create_cached(&medium_path).await?;
    
    let start = Instant::now();
    
    // Create strategy
    let mut strategy = TranscriptionStrategySelector::select_strategy(
        Some(std::time::Duration::from_secs(duration_secs as u64)),
        &config,
        transcriber,
        temp_dir.to_path_buf(),
        None,
    ).await;
    
    println!("Strategy: {}", strategy.name());
    
    // Start recording
    strategy.start_recording(recording_path, &config).await?;
    
    // Simulate real-time processing
    let mut reader = hound::WavReader::open(recording_path)?;
    let samples: Vec<f32> = reader.samples::<i16>()
        .map(|s| s.unwrap() as f32 / i16::MAX as f32)
        .collect();
    
    // Process in 1-second chunks to simulate real-time
    let chunk_size = spec.sample_rate as usize;
    let mut processed = 0;
    
    for chunk in samples.chunks(chunk_size) {
        strategy.process_samples(chunk).await?;
        processed += chunk.len();
        
        // Simulate real-time delay (optional - comment out for faster processing)
        // tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    }
    
    // Finish and get results
    let finish_start = Instant::now();
    let result = strategy.finish_recording().await?;
    let finish_time = finish_start.elapsed();
    
    let total_time = start.elapsed();
    
    println!("\nResults:");
    println!("  Total time: {:.2}s", total_time.as_secs_f32());
    println!("  Finish time: {:.2}s", finish_time.as_secs_f32());
    println!("  Processing time: {}ms", result.processing_time_ms);
    println!("  Chunks processed: {}", result.chunks_processed);
    println!("  Text length: {} chars", result.text.len());
    println!("  First 100 chars: {}", &result.text.chars().take(100).collect::<String>());
    
    Ok(())
}
EOF

    # Run the test
    cd /Users/arach/dev/scout/src-tauri
    RUST_LOG=scout=info cargo run --bin test_progressive 2>&1 | tee "$output_file"
    
    # Extract key metrics
    echo "" >> "$output_file"
    echo "=== SUMMARY ===" >> "$output_file"
    grep -E "Duration:|Total time:|Finish time:|Processing time:|Chunks processed:" "$output_file" >> "$output_file.summary"
}

# Run tests
echo "Starting tests..."
echo ""

# Test long recordings with different chunk sizes
for recording in "${LONG_RECORDINGS[@]}"; do
    for chunk_size in "${CHUNK_SIZES[@]}"; do
        process_recording "$recording" "$chunk_size"
        echo ""
    done
done

# Test short recordings with smaller chunk sizes only
for recording in "${SHORT_RECORDINGS[@]}"; do
    for chunk_size in 5 10 15; do
        process_recording "$recording" "$chunk_size"
        echo ""
    done
done

echo "Test complete! Results saved in: $OUTPUT_DIR"
echo ""
echo "Summary:"
echo "--------"
cat "$OUTPUT_DIR"/*.summary 2>/dev/null | sort
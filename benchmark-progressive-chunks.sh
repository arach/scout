#!/bin/bash

echo "Progressive Transcription Chunk Size Benchmark"
echo "============================================="
echo ""

# Create a directory for benchmark results
BENCHMARK_DIR="benchmark_results_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BENCHMARK_DIR"

# Test recordings directory
RECORDINGS_DIR="/Users/arach/Library/Application Support/com.scout.app/recordings"

# Get the two most recent recordings
RECENT_RECORDINGS=($(ls -t "$RECORDINGS_DIR"/recording_*.wav | head -2))

echo "Using recent recordings:"
for recording in "${RECENT_RECORDINGS[@]}"; do
    duration=$(soxi -D "$recording" 2>/dev/null || echo "unknown")
    echo "  - $(basename "$recording") (duration: ${duration}s)"
done

# Test different chunk sizes
CHUNK_SIZES=(5 10 15 20 25 30)

echo ""
echo "Testing chunk sizes: ${CHUNK_SIZES[@]} seconds"
echo ""

# Function to run a test with specific chunk size
run_test() {
    local chunk_size=$1
    local recording=$2
    local output_file="$BENCHMARK_DIR/test_${chunk_size}s_$(basename "$recording" .wav).json"
    
    echo "Testing ${chunk_size}s chunks on $(basename "$recording")..."
    
    # Create a temporary config file with the chunk size
    cat > "$BENCHMARK_DIR/temp_config_${chunk_size}.json" << EOF
{
    "enable_chunking": true,
    "chunking_threshold_secs": 5,
    "chunk_duration_secs": 5,
    "refinement_chunk_secs": ${chunk_size},
    "force_strategy": "progressive"
}
EOF
    
    # Run the transcription and capture timing
    start_time=$(date +%s%N)
    
    # Here you would run your actual transcription command
    # For now, we'll simulate it
    echo "{
        \"chunk_size\": ${chunk_size},
        \"recording\": \"$(basename "$recording")\",
        \"start_time\": $start_time,
        \"config\": $(cat "$BENCHMARK_DIR/temp_config_${chunk_size}.json")
    }" > "$output_file"
    
    # Clean up temp config
    rm "$BENCHMARK_DIR/temp_config_${chunk_size}.json"
}

# Run tests for each combination
for chunk_size in "${CHUNK_SIZES[@]}"; do
    for recording in "${RECENT_RECORDINGS[@]}"; do
        run_test "$chunk_size" "$recording"
    done
done

# Create 10-second test recordings if needed
echo ""
echo "Creating short test recordings..."

# Record two 10-second samples
for i in 1 2; do
    echo "Recording 10-second sample $i..."
    echo "Say something for 10 seconds..."
    
    # Using sox to record (you might need to install it: brew install sox)
    if command -v rec &> /dev/null; then
        rec -r 48000 -c 1 "$BENCHMARK_DIR/test_10s_${i}.wav" trim 0 10
    else
        echo "sox not found. Please install with: brew install sox"
    fi
done

echo ""
echo "Benchmark complete! Results saved in: $BENCHMARK_DIR"
echo ""
echo "Summary:"
echo "--------"
ls -la "$BENCHMARK_DIR"/
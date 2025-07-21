#!/bin/bash

# Scout Progressive Transcription Benchmark Runner

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
RECORDINGS_DIR="$SCRIPT_DIR/recordings"
RESULTS_DIR="$SCRIPT_DIR/results/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$RESULTS_DIR"

# Default chunk sizes to test
if [ $# -eq 0 ]; then
    CHUNK_SIZES=(5 10 15 20)
else
    CHUNK_SIZES=("$@")
fi

echo "Scout Progressive Transcription Benchmark"
echo "========================================"
echo ""
echo "Test recordings:"
ls -la "$RECORDINGS_DIR"/*.wav | awk '{print "  - " $9 " (" $5 " bytes)"}'
echo ""
echo "Testing chunk sizes: ${CHUNK_SIZES[@]}s"
echo "Results will be saved to: $RESULTS_DIR"
echo ""

# Function to run a single benchmark
run_benchmark() {
    local recording=$1
    local chunk_size=$2
    local recording_name=$(basename "$recording" .wav)
    local output_file="$RESULTS_DIR/${recording_name}_chunk${chunk_size}s.json"
    local log_file="$RESULTS_DIR/${recording_name}_chunk${chunk_size}s.log"
    
    echo "Testing $recording_name with ${chunk_size}s chunks..."
    
    # Create test config
    cat > "$RESULTS_DIR/config_${chunk_size}s.json" << EOF
{
    "enable_chunking": true,
    "chunking_threshold_secs": 5,
    "chunk_duration_secs": 5,
    "refinement_chunk_secs": ${chunk_size},
    "force_strategy": "progressive"
}
EOF
    
    # Run the benchmark using our Rust binary
    cd "$SCRIPT_DIR/../src-tauri"
    
    # Start timing
    start_time=$(date +%s.%N)
    
    # Run the transcription test
    RUST_LOG=scout=info cargo run --release --bin benchmark_progressive -- \
        --recording "$recording" \
        --chunk-size "$chunk_size" \
        --output "$output_file" \
        2>&1 | tee "$log_file"
    
    # End timing
    end_time=$(date +%s.%N)
    total_time=$(echo "$end_time - $start_time" | bc)
    
    # Extract key metrics from log
    tiny_chunks=$(grep -c "Processing chunk .* (5s)" "$log_file" || echo "0")
    refinements=$(grep -c "Processing refinement chunk" "$log_file" || echo "0")
    strategy=$(grep -o "Strategy selected: [a-z]*" "$log_file" | head -1 | cut -d' ' -f3)
    
    # Save summary
    cat > "$output_file" << EOF
{
    "recording": "$recording_name",
    "chunk_size": $chunk_size,
    "total_time": $total_time,
    "tiny_chunks": $tiny_chunks,
    "refinements": $refinements,
    "strategy": "$strategy",
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
    
    echo "  Completed in ${total_time}s"
    echo ""
}

# Run benchmarks
for recording in "$RECORDINGS_DIR"/*.wav; do
    for chunk_size in "${CHUNK_SIZES[@]}"; do
        run_benchmark "$recording" "$chunk_size"
    done
done

# Generate summary report
echo "Generating summary report..."
cat > "$RESULTS_DIR/summary.md" << EOF
# Benchmark Results Summary
Generated: $(date)

## Configuration
- Chunk sizes tested: ${CHUNK_SIZES[@]}s
- Strategy: Progressive (Tiny + Medium)

## Results

| Recording | Chunk Size | Total Time | Tiny Chunks | Refinements |
|-----------|------------|------------|-------------|-------------|
EOF

# Add results to summary
for json_file in "$RESULTS_DIR"/*.json; do
    if [[ "$json_file" != *"config_"* ]]; then
        recording=$(jq -r .recording "$json_file")
        chunk_size=$(jq -r .chunk_size "$json_file")
        total_time=$(jq -r .total_time "$json_file")
        tiny_chunks=$(jq -r .tiny_chunks "$json_file")
        refinements=$(jq -r .refinements "$json_file")
        
        printf "| %-12s | %10ss | %10.2fs | %11s | %11s |\n" \
            "$recording" "$chunk_size" "$total_time" "$tiny_chunks" "$refinements" \
            >> "$RESULTS_DIR/summary.md"
    fi
done

echo "" >> "$RESULTS_DIR/summary.md"
echo "## Analysis" >> "$RESULTS_DIR/summary.md"
echo "" >> "$RESULTS_DIR/summary.md"

# Analysis for each recording
for recording in "$RECORDINGS_DIR"/*.wav; do
    recording_name=$(basename "$recording" .wav)
    echo "### $recording_name" >> "$RESULTS_DIR/summary.md"
    
    # Get duration
    duration=$(soxi -D "$recording" 2>/dev/null || echo "unknown")
    echo "Duration: ${duration}s" >> "$RESULTS_DIR/summary.md"
    echo "" >> "$RESULTS_DIR/summary.md"
    
    # Find optimal chunk size
    best_time=999999
    best_chunk=0
    
    for chunk_size in "${CHUNK_SIZES[@]}"; do
        json_file="$RESULTS_DIR/${recording_name}_chunk${chunk_size}s.json"
        if [ -f "$json_file" ]; then
            total_time=$(jq -r .total_time "$json_file")
            if (( $(echo "$total_time < $best_time" | bc -l) )); then
                best_time=$total_time
                best_chunk=$chunk_size
            fi
        fi
    done
    
    echo "Best chunk size: ${best_chunk}s (${best_time}s total time)" >> "$RESULTS_DIR/summary.md"
    echo "" >> "$RESULTS_DIR/summary.md"
done

echo ""
echo "Benchmark complete!"
echo "Results saved to: $RESULTS_DIR"
echo "Summary: $RESULTS_DIR/summary.md"
echo ""
cat "$RESULTS_DIR/summary.md"
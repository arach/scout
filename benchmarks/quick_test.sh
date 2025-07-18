#!/bin/bash

echo "Quick Progressive Transcription Test"
echo "==================================="
echo ""
echo "This will test one recording with different chunk sizes"
echo ""

cd "$(dirname "$0")"

# Test just the short 10s recording with different chunk sizes
echo "Testing short_10s.wav with different refinement chunks..."
echo ""

for chunk_size in 5 10 15; do
    echo "Testing with ${chunk_size}s chunks:"
    
    cd ../src-tauri
    cargo run --release --bin benchmark_progressive -- \
        --recording ../benchmarks/recordings/short_10s.wav \
        --chunk-size $chunk_size 2>&1 | grep -E "Strategy selected:|Expected Tiny chunks:|Expected refinements:|Finalization time:"
    
    echo ""
done

echo "Key insights for 10s recording:"
echo "- With 5s chunks: Should see 2 refinements"
echo "- With 10s chunks: Should see 1 refinement" 
echo "- With 15s chunks: Should see 0 refinements (too short!)"
echo ""
echo "The finalization time shows latency after recording stops."
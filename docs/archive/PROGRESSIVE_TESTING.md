# Testing Progressive Transcription

## Quick Start

Test different refinement chunk sizes:

```bash
# Test with 10-second chunks (faster refinement, more overhead)
./test-chunk-sizes.sh 10

# Test with 15-second chunks (default, balanced)
./test-chunk-sizes.sh 15

# Test with 20-second chunks (less overhead, slower refinement)
./test-chunk-sizes.sh 20
```

## What to Look For

1. **Strategy Selection**: Look for "Auto-selected progressive strategy (Tiny + Medium)"
2. **Refinement Activity**: Watch for "Processing refinement chunk" messages
3. **Latency Optimization**: When you stop recording, should see "Recording finalized, stopping refinement task to minimize latency"

## Key Improvements

- **Latency First**: Refinement stops immediately when recording ends
- **Configurable Chunks**: Default 15s (was 30s) for faster quality improvements
- **Multiple Models**: Fixed cache to support both Tiny and Medium models simultaneously

## Finding Your Sweet Spot

The optimal chunk size depends on your use case:
- **Quick notes (5-10s)**: Smaller chunks mean first refinement before you stop
- **Longer recordings (10-15s)**: Default 15s balances quality and performance  
- **Dictation sessions (20-30s)**: Larger chunks reduce overhead

## Running the Benchmark

For detailed performance analysis:

```bash
cd src-tauri
cargo run --bin benchmark_progressive
```

This will test your recent recordings with various chunk sizes and show timing data.
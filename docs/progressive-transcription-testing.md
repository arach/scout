# Progressive Transcription Testing Guide

## Quick Pipeline Test

The easiest way to test progressive transcription with real recordings:

```bash
# Test with different refinement chunk sizes
./test-progressive-pipeline.sh 5   # Aggressive refinement (every 5s)
./test-progressive-pipeline.sh 10  # Balanced (every 10s) 
./test-progressive-pipeline.sh 15  # Default (every 15s)
./test-progressive-pipeline.sh 20  # Conservative (every 20s)
```

## What to Test

### 1. Short Recording (5-10s)
- Start recording
- Say a short sentence
- Stop recording
- **Expected**: 
  - 1-2 Tiny chunks process immediately
  - With 5s chunks: 1 refinement before you stop
  - With 15s chunks: No refinement (too short)
  - Instant results when you stop

### 2. Medium Recording (20-30s)
- Start recording
- Talk for 20-30 seconds
- Stop recording
- **Expected**:
  - 4-6 Tiny chunks process in real-time
  - With 10s chunks: 2-3 refinements during recording
  - With 15s chunks: 1-2 refinements during recording
  - Refinement stops immediately when recording ends

### 3. Long Recording (60s+)
- Start recording
- Talk for over a minute
- Stop recording
- **Expected**:
  - Many Tiny chunks (one every 5s)
  - Regular refinements based on chunk size
  - All processing stops when recording ends

## Key Metrics to Watch

### During Recording
```
[INFO] Processing chunk 0 (5s)          <- Tiny model (immediate)
[INFO] Processing chunk 1 (5s)          <- Tiny model (immediate)
[INFO] Processing chunk 2 (5s)          <- Tiny model (immediate)
[INFO] Processing refinement chunk: 15s  <- Medium model (background)
```

### When Recording Stops
```
[INFO] Recording finalized, stopping refinement task to minimize latency
[INFO] Canceling background refinement to minimize latency
```

## Performance Comparison

### Old Strategy (Ring Buffer)
- Recording: Tiny model processes chunks
- Stop: Wait for entire Medium model processing
- Latency: 2-5 seconds after stop

### New Strategy (Progressive)
- Recording: Tiny (immediate) + Medium (background refinement)
- Stop: Cancel refinement, return immediately
- Latency: <300ms after stop

## Testing Commands

### Force Progressive Strategy
```bash
# In your settings.json or via environment
{
  "processing": {
    "force_strategy": "progressive",
    "refinement_chunk_secs": 10
  }
}
```

### Monitor Performance
Watch these log patterns:
- `Created new transcriber for model: ggml-tiny.en.bin`
- `Created new transcriber for model: ggml-medium.en.bin`
- `Cached transcriber for ggml-tiny.en.bin. Total cached models: 2`
- `Starting background refinement task (15-second chunks)`

## Debugging

If progressive strategy isn't activating:
1. Check chunking is enabled: `enable_chunking: true`
2. Verify both models exist in `/models/`
3. Look for: "Auto-selected progressive strategy"
4. Check cache has both models: "Total cached models: 2"

## Results Analysis

The progressive strategy optimizes for:
1. **Immediate feedback** - See text as you speak
2. **Progressive quality** - Text improves during recording
3. **Zero post-processing** - Stop = Done
4. **Adaptive refinement** - Chunk size affects quality/performance trade-off
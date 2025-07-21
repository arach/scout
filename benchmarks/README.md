# Scout Progressive Transcription Benchmarks

## Test Recordings

This folder contains standardized test recordings for benchmarking the progressive transcription strategy.

### Recordings

| File | Duration | Description | Use Case |
|------|----------|-------------|----------|
| `long_100s.wav` | 100.3s | Long recording | Tests sustained refinement |
| `long_70s.wav` | 71.6s | Medium-long recording | Tests multiple refinement cycles |
| `short_10s.wav` | 10.3s | Short recording | Tests if refinement kicks in |
| `short_8s.wav` | 8.3s | Very short recording | Tests minimal refinement scenario |

### Recording Properties
- Sample rate: 48kHz
- Channels: Mono
- Format: WAV (16-bit PCM)

## Running Benchmarks

### Quick Test
```bash
# Test with default 15s refinement chunks
./run_benchmark.sh

# Test with specific chunk size
./run_benchmark.sh 10

# Test range of chunk sizes
./run_benchmark.sh 5 10 15 20
```

### Full Benchmark Suite
```bash
cargo run --release --bin scout_benchmark
```

## Parameters to Test

### Refinement Chunk Sizes
- **5s**: Maximum refinement frequency
- **10s**: Balanced for most use cases
- **15s**: Default setting
- **20s**: Conservative, less overhead

### Expected Results

#### Long Recordings (70-100s)
- Should see multiple refinement cycles
- Test refinement cancellation on stop
- Measure total latency

#### Short Recordings (8-10s)
- Test if refinement activates at all
- Verify immediate results with Tiny model
- Check latency is still <300ms

## Metrics to Collect

1. **Latency**: Time from stop_recording to final result
2. **Tiny Chunks**: Number of real-time chunks processed
3. **Refinements**: Number of Medium model refinements completed
4. **Quality**: Compare Tiny-only vs Progressive final text
5. **CPU/Memory**: Resource usage during processing
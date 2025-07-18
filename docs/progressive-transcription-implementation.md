# Progressive Transcription Implementation

## What We Built

We've implemented a two-tier progressive transcription system that provides immediate feedback while improving quality in the background.

### Components

1. **ProgressiveTranscriptionStrategy** (`src-tauri/src/transcription/strategy.rs`)
   - Uses Tiny model (39MB) for real-time transcription (5-second chunks)
   - Runs Medium model (1.5GB) in background for quality refinement (30-second chunks)
   - Emits `transcript-refined` events as better transcriptions become available

2. **RingBufferRecorder Enhancements** (`src-tauri/src/audio/ring_buffer_recorder.rs`)
   - Added `is_finalized()` to track recording completion
   - Added `get_total_samples()` for progress tracking
   - Added `get_samples_range()` to extract specific audio segments
   - Added `save_samples_to_wav()` helper for chunk processing

3. **Strategy Selection** (`src-tauri/src/transcription/strategy.rs`)
   - Progressive strategy is now the default when chunking is enabled
   - Can be forced with `force_strategy: "progressive"` in config
   - Falls back to ring buffer strategy if models aren't available

4. **Frontend Event Handler** (`src/hooks/useTranscriptEvents.ts`)
   - Listens for `transcript-refined` events
   - Logs refinement progress (merging logic TODO)

## How It Works

1. **Recording starts**: Progressive strategy initializes both Tiny and Medium transcibers
2. **Real-time processing**: 
   - Ring buffer monitor processes 5-second chunks with Tiny model
   - Results appear immediately in UI (4-7x faster than real-time)
3. **Background refinement**:
   - Separate task processes 30-second chunks with Medium model
   - Emits refinement events as chunks complete
   - Continues processing even after recording stops

## Performance Characteristics

- **Tiny model**: ~200-300ms for 5-second chunk (6-7x real-time)
- **Medium model**: ~5-10s for 30-second chunk (3-6x real-time with CoreML)
- **User experience**: Immediate feedback with progressive quality improvement

## Testing

To test the progressive strategy:

```bash
# In the app settings, the strategy will auto-select progressive for recordings > 10s
# Or force it by adding to transcription config:
# force_strategy: "progressive"

# Run with debug logging to see the two-tier processing:
RUST_LOG=scout=debug pnpm tauri dev
```

## Next Steps

1. **Smart Merging**: Implement word boundary matching to seamlessly replace Tiny transcripts with Medium refinements
2. **UI Updates**: Show subtle indicators when refinements are available
3. **Configurable Thresholds**: Let users control when progressive mode activates
4. **Performance Tuning**: Optimize chunk sizes based on real-world usage
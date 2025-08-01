# Progressive Transcription Fix for Short Recordings

## Problem
Short recordings (< 5 seconds) were not producing any transcription output when using the progressive transcription strategy. The issue was that:

1. The monitor only creates a `chunked_transcriber` when recordings exceed 5 seconds
2. For short recordings, no chunks are processed during recording
3. The `recording_complete()` method didn't handle this case properly

## Solution
Modified `/src-tauri/src/ring_buffer_monitor.rs` to:

1. Store the initial transcriber in the `initial_transcriber` field during monitoring setup
2. When `recording_complete()` is called for short recordings:
   - Check if no chunks were processed (`completed_chunks.is_empty()`) and no chunked transcriber exists
   - Use the stored `initial_transcriber` for processing the entire recording as a single chunk
   - This ensures short recordings are processed within the progressive strategy instead of falling back

## Implementation Details
The fix ensures that:
- Short recordings (< 5 seconds) are processed as a single chunk
- The same transcriber (Tiny model) is used consistently
- No fallback to alternative strategies is needed
- The progressive strategy handles all recording lengths correctly

## Testing
To test the fix:
1. Start Scout with `pnpm tauri dev`
2. Make a short recording (< 5 seconds)
3. Verify that transcription output is produced
4. Check logs for "Using stored transcriber for short recording" message
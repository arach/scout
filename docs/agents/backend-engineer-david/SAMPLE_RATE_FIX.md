# Critical Sample Rate Fix for Scout Audio Recording

## Problem Identified
The audio recording was completely garbled because the code was trying to force 16kHz mono recording on devices that don't support it. This caused a mismatch between:
- What the device was actually delivering (e.g., 48kHz stereo)
- What the code thought it was recording (16kHz mono)
- What was written to the WAV file header

This mismatch resulted in:
1. **Garbled audio** that sounds like chipmunks or slowed down
2. **Extremely slow transcription** because Whisper was trying to transcribe corrupted audio
3. **Poor transcription quality** due to the corrupted input

## Root Cause
In `/src-tauri/src/audio/recorder.rs` (lines 599-652), the code attempted to:
1. Force 16kHz mono recording to "optimize file size"
2. Check if the device supports this configuration
3. Fall back to native format if not supported

However, this logic was flawed because:
- Many devices report support for configurations they can't actually deliver
- The actual audio stream might still come in the device's native format
- The mismatch between expected and actual format corrupts the recording

## Fix Applied
**Always use the device's native format for recording:**

```rust
// CRITICAL FIX: Always use device's native configuration
// Forcing 16kHz was causing sample rate mismatches and garbled audio
// Whisper conversion will handle resampling properly during transcription

let mut config = cpal::StreamConfig {
    channels: device_channels,         // Use device's native channels
    sample_rate: default_config.sample_rate(), // Use device's native sample rate
    buffer_size: cpal::BufferSize::Default,
};
```

## Why This Works
1. **No format mismatch**: Audio is recorded exactly as the device delivers it
2. **Proper conversion**: The WhisperAudioConverter in `format.rs` already handles conversion to 16kHz mono during transcription
3. **Preserved quality**: Recording at native quality preserves the original audio for archival purposes

## Expected Improvements
1. **Audio quality**: No more garbled/chipmunk audio
2. **Transcription speed**: With proper audio, transcription should be much faster
3. **Accuracy**: Whisper will work correctly with properly formatted audio

## Testing the Fix
1. Record a test phrase: "Testing one two three"
2. Check the logs for: "Using device native format: X Hz, Y channels"
3. Verify the audio sounds normal when played back
4. Confirm transcription completes in reasonable time (<2s for 10s audio with tiny/base models)

## Additional Recommendations
1. **Model selection**: Use tiny.en or base.en for real-time transcription (not large models)
2. **Monitor logs**: Watch for sample rate warnings in the logs
3. **Test different devices**: Verify with built-in mic, USB mic, and Bluetooth devices

## Related Issues Fixed
- Short transcription padding reduced (only pads <0.3s clips now)
- Added warnings for slow model usage
- Improved Whisper parameters for short clips
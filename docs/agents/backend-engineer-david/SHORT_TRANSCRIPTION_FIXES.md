# Scout Short Transcription Fixes

## Problem Summary
Scout was having issues with very short transcriptions (< 1 second), particularly single words or brief utterances. The issues included:
- Excessive silence padding making short clips artificially long
- Whisper model struggling with very brief audio
- No optimization for short utterance handling

## Changes Made

### 1. Reduced Silence Padding Threshold
**File:** `/src-tauri/src/audio/recorder.rs`
- Changed silence padding to only apply to recordings < 0.3 seconds (was < 1.0 seconds)
- Reduced padding target from 1.1 seconds to 0.5 seconds
- This prevents unnecessary silence for clips between 0.3-1.0 seconds

### 2. Enhanced Whisper Parameters for Short Audio
**File:** `/src-tauri/src/transcription/mod.rs`
- Added `params.set_condition_on_previous_text(false)` to prevent context issues
- Added initial prompt: "Speech transcription of a brief utterance or command:"
- Added duration warning for clips < 0.5 seconds

### 3. Lowered Chunking Thresholds
**Files:** `/src-tauri/src/transcription/strategy.rs`, `/src-tauri/src/ring_buffer_monitor.rs`
- Reduced chunking threshold from 5 to 3 seconds
- This allows better handling of 3-5 second recordings

### 4. Added Short Audio Validation
**File:** `/src-tauri/src/audio/format.rs`
- Added warning for extremely short audio (< 100ms after conversion)
- Helps identify problematic clips early in the pipeline

### 5. Created Test Suite
**File:** `/src-tauri/tests/test_short_transcriptions.rs`
- Comprehensive tests for short audio handling
- Tests for common single-word utterances
- Validation of padding thresholds

## Expected Improvements

1. **Single words** (yes, no, ok, stop) should now transcribe correctly without excessive padding
2. **Brief phrases** (0.3-1.0 seconds) won't have unnecessary silence added
3. **Whisper performance** improved with better parameters for short clips
4. **Better debugging** with warnings for extremely short audio

## Testing Recommendations

1. Test single-word commands: "yes", "no", "ok", "stop", "go"
2. Test brief phrases: "hello there", "thank you", "start recording"
3. Test edge cases: 0.2s, 0.3s, 0.5s, 1.0s clips
4. Monitor logs for new warnings about short audio

## Configuration Options

Users can further tune the behavior by adjusting:
- `chunking_threshold_secs` in TranscriptionConfig
- `force_strategy` to "classic" for all short recordings
- Model selection (tiny.en recommended for fastest short clip processing)
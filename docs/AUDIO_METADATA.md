# Audio Metadata Tracking

## Overview

Scout captures comprehensive audio metadata for every recording to help diagnose audio quality issues and ensure proper transcription.

## What We Capture

For each recording, we store:

### Device Information
- **Device Name**: The microphone/input device name (e.g., "MacBook Pro Microphone", "AirPods Pro")
- **Device Type**: Detected type (Built-in, USB, Bluetooth, AirPods, etc.)
- **Is Default Device**: Whether this was the system's default input

### Audio Format Details
- **Sample Rate**: Actual sample rate used (e.g., 48000 Hz, 16000 Hz)
- **Channels**: Number of audio channels (1 for mono, 2 for stereo)
- **Sample Format**: Audio format (F32, I16, etc.)
- **Bit Depth**: Bits per sample (16, 24, 32)
- **Buffer Configuration**: Buffer size and estimated latency

### Recording Configuration
- **Input Gain**: Audio input level (if available)
- **Processing Applied**: Any audio processing (e.g., silence padding)
- **VAD Enabled**: Whether Voice Activity Detection was used
- **Trigger Type**: How recording was triggered (manual, push-to-talk, VAD)

### System Information
- **Operating System**: macOS, Windows, Linux
- **Audio Backend**: CoreAudio, WASAPI, ALSA, etc.

## How It's Stored

The metadata is stored in two places:

1. **transcripts.audio_metadata**: Full JSON blob with all audio configuration
2. **performance_metrics table**: Key audio parameters in individual columns for querying

## Example Audio Metadata

```json
{
  "device": {
    "name": "AirPods Pro",
    "device_type": "AirPods",
    "is_default": true,
    "notes": ["AirPods detected - may experience audio quality issues"]
  },
  "format": {
    "sample_rate": 48000,
    "channels": 1,
    "sample_format": "F32",
    "bit_depth": 32,
    "buffer_config": {
      "buffer_type": "Fixed",
      "size_samples": 256,
      "estimated_latency_ms": 5.33
    },
    "data_rate_bytes_per_sec": 192000
  },
  "recording": {
    "input_gain": null,
    "processing_applied": ["silence_padding"],
    "vad_enabled": false,
    "silence_padding_ms": 100,
    "trigger_type": "manual"
  },
  "system": {
    "os": "macOS",
    "os_version": "darwin",
    "audio_backend": "CoreAudio",
    "system_notes": []
  },
  "captured_at": "2025-01-30T10:30:00-08:00"
}
```

## Why This Matters

This metadata helps diagnose common audio issues:

1. **Pitch-shifted audio (chipmunk effect)**: Often caused by sample rate mismatches
2. **Poor transcription quality**: May be due to incorrect channel configuration
3. **Latency issues**: Buffer size and configuration affects responsiveness
4. **Device-specific problems**: Certain devices (like AirPods in call mode) have known issues

## API Access

### Get transcript with audio metadata:
```javascript
const transcript = await invoke('get_transcript', { transcriptId: 123 });
// transcript.audio_metadata contains the JSON string
```

### Get full audio details:
```javascript
const details = await invoke('get_transcript_with_audio_details', { transcriptId: 123 });
// details.audio_metadata - parsed JSON object
// details.performance_metrics - performance data with audio config
```
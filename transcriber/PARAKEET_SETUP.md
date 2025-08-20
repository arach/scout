# Parakeet MLX Setup Guide

## Overview

NVIDIA Parakeet TDT 0.6B v2 is now available via Parakeet MLX, optimized for Apple Silicon using MLX framework.

## Installation

### System Python (Works with Python 3.13)

```bash
# Install dependencies
pip3 install --break-system-packages pyzmq msgpack-python scipy parakeet-mlx mlx

# Run the worker
python3 python/parakeet_worker.py \
  --input tcp://127.0.0.1:5555 \
  --output tcp://127.0.0.1:5556 \
  --control tcp://127.0.0.1:5557 \
  --model parakeet \
  --log-level INFO
```

### With uv (Requires Python ≤3.10)

Due to dependency conflicts with librosa/numba/llvmlite, uv environments with Python 3.13+ will fall back to Wav2Vec2.

For full Parakeet MLX support with uv:
1. Use Python 3.10 or earlier
2. Install: `uv pip install parakeet-mlx`

## Performance

- **Model**: mlx-community/parakeet-tdt-0.6b-v2
- **Processing time**: ~2 seconds for 3 seconds of audio
- **Accuracy**: Excellent (perfect transcription in tests)
- **Memory**: ~2GB unified memory required

## Implementation Details

The implementation:
1. Converts audio to temporary WAV files (Parakeet MLX requires file paths)
2. Uses MLX framework for Apple Silicon optimization
3. Falls back to Wav2Vec2 if Parakeet MLX unavailable

## Testing

```bash
# Test with real audio
python3 test_real_audio.py

# Expected output:
# Model: parakeet
# ✅ TEST PASSED - Transcription successful
```
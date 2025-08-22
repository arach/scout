# Scout Python Transcriber Service

## Installation

### Core Dependencies
Install the core dependencies using uv:
```bash
cd transcriber/python
uv pip install -e .
```

### Transcription Models

The transcriber supports multiple models, each with their own requirements:

#### 1. OpenAI Whisper
```bash
uv pip install -e ".[whisper]"
```

#### 2. MLX Whisper (Apple Silicon optimized)
```bash
uv pip install -e ".[mlx]"
```

#### 3. Parakeet MLX
Parakeet requires FFmpeg as a system dependency:

**macOS:**
```bash
brew install ffmpeg
```

Then install Parakeet:
```bash
pip install git+https://github.com/JDSherbert/parakeet.git
```

## Running the Service

Start the transcriber service:
```bash
python zmq_server_worker.py
```

Or use the Parakeet worker wrapper (bypasses Python 3.13 dependency issues):
```bash
./parakeet_worker.py
```

## Configuration

The service listens on:
- Port 5556: Audio data (REQ/REP)
- Port 5557: Text results (PUB/SUB)
- Port 5558: Control commands (REQ/REP)

## Message Format

The service accepts MessagePack-encoded messages with:
- `audio_data_type`: Either "FILE" or "AUDIO_BUFFER"
- `file_path`: Path to audio file (when type is FILE)
- `audio`: Raw audio buffer (when type is AUDIO_BUFFER)
- `sample_rate`: Audio sample rate (typically 16000)
- `id`: Unique identifier for the chunk
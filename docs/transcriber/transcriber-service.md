# Scout Transcriber Service

The Scout Transcriber Service is an advanced transcription engine that extends Scout's built-in capabilities with support for multiple AI models and distributed processing.

## Overview

While Scout includes built-in Whisper models that work out of the box, the external transcriber service adds:

- **Additional Models**: Parakeet (NVIDIA), Wav2Vec2 (Facebook), and more
- **Distributed Processing**: ZeroMQ-based architecture for parallel transcription
- **Lower Latency**: Optimized for Apple Silicon with MLX acceleration
- **Advanced Configuration**: Fine-tune model parameters and worker processes

## Installation

The transcriber service can be installed with a single command:

```bash
curl -sSf https://scout.arach.dev/transcriber-install.sh | bash
```

To review the installer script before running:

```bash
# View the script
curl -sSf https://scout.arach.dev/transcriber-install.txt

# Or download and review
curl -O https://scout.arach.dev/transcriber-install.sh
cat transcriber-install.sh
```

## Architecture

```
┌────────────┐        ┌─────────────────┐        ┌──────────────┐
│   Scout    │        │   Transcriber   │        │   Python     │
│    App     │◀──────▶│     Service     │◀──────▶│   Workers    │
└────────────┘        └─────────────────┘        └──────────────┘
      │                        │                         │
      │                        │                         │
      ▼                        ▼                         ▼
┌────────────┐        ┌─────────────────┐        ┌──────────────┐
│  Built-in  │        │    ZeroMQ       │        │   AI Models  │
│  Whisper   │        │   Message Bus   │        │   (Parakeet) │
└────────────┘        └─────────────────┘        └──────────────┘
```

### Components

#### 1. Scout Integration

Scout can operate in two modes:
- **Built-in Mode**: Uses Scout's embedded whisper.cpp for transcription
- **External Service Mode**: Delegates to the transcriber service for advanced models

#### 2. Transcriber Service (Rust)

The core service written in Rust that:
- Manages worker processes
- Handles message routing via ZeroMQ
- Monitors health and performance
- Provides fallback mechanisms

#### 3. Python Workers

Python processes that:
- Load and run AI models
- Process audio chunks in parallel
- Support multiple model backends (Transformers, MLX, etc.)

## Configuration

### Default Ports

```bash
ZMQ_PUSH_PORT=5555    # Audio input from Scout
ZMQ_PULL_PORT=5556    # Transcripts output to Scout
ZMQ_CONTROL_PORT=5557 # Service health monitoring
```

### Environment Variables

Customize the service behavior:

```bash
# Change default ports
export ZMQ_PUSH_PORT=6000
export ZMQ_PULL_PORT=6001
export ZMQ_CONTROL_PORT=6002

# Set worker count
scout-transcriber --workers 4

# Select model
scout-transcriber --model parakeet
```

## Supported Models

### Whisper (OpenAI)
- **Models**: tiny, base, small, medium, large
- **Languages**: 100+ languages
- **Best for**: General transcription, multilingual support

### Parakeet (NVIDIA)
- **Models**: TDT-0.6B, TDT-1.1B
- **Optimization**: MLX acceleration on Apple Silicon
- **Best for**: Low-latency English transcription

### Wav2Vec2 (Facebook)
- **Models**: base-960h, large-960h-lv60
- **Architecture**: Self-supervised learning
- **Best for**: Noisy environments, accented speech

## Using with Scout

### Enable External Service

1. Open Scout Settings (⌘,)
2. Navigate to Transcription tab
3. Select "External Service" mode
4. Configure model and worker settings
5. Click "Test Connection" to verify

### Configuration in Scout

The Scout UI provides controls for:
- Model selection
- Worker process count
- Network port configuration
- Service health monitoring

## Performance

### Benchmarks (M1 Pro)

| Model | Audio Duration | Processing Time | RTF* | Memory |
|-------|----------------|-----------------|------|--------|
| Whisper Tiny | 30s | 1.2s | 0.04x | ~500MB |
| Parakeet 0.6B | 30s | 0.8s | 0.03x | ~1.2GB |
| Wav2Vec2 Base | 30s | 2.1s | 0.07x | ~800MB |

*RTF (Real-Time Factor): Lower is better. 0.04x means 30s audio processes in 1.2s

## Troubleshooting

### Service Not Starting

```bash
# Check if ports are in use
lsof -i :5555
lsof -i :5556
lsof -i :5557

# View logs
tail -f ~/.scout-transcriber/logs/transcriber.log
```

### Model Download Issues

```bash
# Clear model cache
rm -rf ~/.scout-transcriber/models

# Re-run installer
curl -sSf https://scout.arach.dev/transcriber-install.sh | bash
```

### Connection Failed

If Scout can't connect to the service:

1. Ensure the service is running: `ps aux | grep scout-transcriber`
2. Check firewall settings for localhost connections
3. Verify ports match between Scout and service configuration

## Uninstallation

To remove the transcriber service completely:

```bash
curl -sSf https://scout.arach.dev/transcriber-uninstall.sh | bash
```

This removes:
- The scout-transcriber binary
- Python virtual environment
- Downloaded models
- Configuration files
- LaunchAgent (if configured)

## Development

### Building from Source

```bash
# Clone the repository
git clone https://github.com/arach/scout.git
cd scout/transcriber

# Build the Rust service
cargo build --release

# Set up Python environment
uv venv
uv pip install -r requirements.txt
```

### Adding New Models

The service is extensible. To add a new model:

1. Implement the model loader in `python/zmq_server_worker.py`
2. Add model configuration to `src/models.rs`
3. Update the UI options in Scout's settings

## Security

- **Local Processing**: All transcription happens on your device
- **No Network Access**: Models run offline after initial download
- **Localhost Only**: Service binds to 127.0.0.1, not exposed externally
- **Open Source**: Full source code available for audit

## Resources

- [Source Code](https://github.com/arach/scout/tree/master/transcriber)
- [README](https://scout.arach.dev/transcriber-readme.txt)
- [Installer Script](https://scout.arach.dev/transcriber-install.txt)
- [Report Issues](https://github.com/arach/scout/issues)
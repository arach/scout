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

## System Architecture

### High-Level Overview
```
┌─────────────────┐                    ┌─────────────────────┐
│   Scout App     │                    │ Transcriber Service │
│                 │                    │                     │
│ ┌─────────────┐ │  AudioChunk        │  ┌───────────────┐ │
│ │ Integrated  │ │ ──────────────────▶│  │  Rust Core    │ │
│ │  Whisper    │ │                    │  │               │ │
│ └─────────────┘ │  Transcript        │  │ Process Mgmt  │ │
│                 │ ◀──────────────────│  │ Queue Control │ │
│ Mode: Integrated│                    │  │ Health Checks │ │
│ or Advanced     │                    │  └───────┬───────┘ │
└─────────────────┘                    └──────────┼─────────┘
                                                  │
                                    ┌─────────────┴───────────┐
                                    │   Message Queue        │
                                    │  (ZeroMQ or Sled)      │
                                    └─────────────┬───────────┘
                                                  │
                                    ┌─────────────┴───────────┐
                                    │  Python Workers        │
                                    │                        │
                                    │  • Whisper            │
                                    │  • Parakeet MLX       │
                                    │  • HuggingFace        │
                                    └───────────────────────┘
```

### Data Flow
1. **Audio Capture**: Scout records audio from microphone or processes uploaded files
2. **Mode Decision**: Based on settings, Scout either:
   - Uses built-in Whisper (Integrated Mode)
   - Sends to external service (Advanced Mode)
3. **Queue Processing**: Audio chunks are queued for processing
4. **Worker Distribution**: Python workers pull from queue and process
5. **Model Inference**: Selected AI model transcribes the audio
6. **Result Return**: Transcripts flow back through queue to Scout
7. **Post-Processing**: Scout applies filters and saves to database

### Components

#### 1. Scout Integration

Scout can operate in two modes:
- **Built-in Mode**: Uses Scout's embedded whisper.cpp for transcription
- **External Service Mode**: Delegates to the transcriber service for advanced models

#### 2. Transcriber Service (Rust)

The core service written in Rust that:
- Manages worker processes with automatic restarts
- Handles message routing via ZeroMQ or Sled queues
- Monitors health and performance with heartbeats
- Provides fallback mechanisms and error recovery
- Manages Python dependencies via UV

#### 3. Python Workers

Stateless Python processes that:
- Load and run AI models (Whisper, Parakeet, HuggingFace)
- Process audio chunks in parallel
- Support multiple model backends (Transformers, MLX, ONNX)
- Communicate via MessagePack serialization
- Auto-restart on failures with exponential backoff

#### 4. Message Queue Layer

Two queue implementations:
- **Sled**: Persistent, local, ACID-compliant database queues
- **ZeroMQ**: Distributed, high-performance messaging for scaling

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

## Why Use the External Service?

### When to Stay with Integrated Mode
- You're happy with current transcription speed
- You transcribe occasionally
- You prefer zero configuration
- You have limited system resources

### When to Use Advanced Mode
- **Performance Critical**: Need <200ms latency
- **Batch Processing**: Transcribing multiple files
- **Apple Silicon User**: Want to leverage MLX acceleration
- **Custom Models**: Using fine-tuned or specialized models
- **Production Deployment**: Need reliability and scalability
- **Developer/Power User**: Want maximum control and flexibility

## Security & Privacy

### Security Features
- **Local Processing**: All transcription happens on your device
- **No Network Access**: Models run offline after initial download
- **Localhost Only**: Service binds to 127.0.0.1, not exposed externally
- **Process Isolation**: Each worker runs in isolated process
- **Open Source**: Full source code available for audit

### Privacy Guarantees
- **No Telemetry**: Zero usage tracking or analytics
- **No Cloud Dependencies**: Works completely offline
- **Data Sovereignty**: Your audio never leaves your machine
- **Ephemeral Processing**: Audio is processed and discarded
- **User Control**: Stop/start service at any time

## Comparison: Integrated vs Advanced Mode

| Feature | Integrated Mode | Advanced Mode |
|---------|----------------|---------------|
| **Setup Required** | None | One-time install |
| **Models Available** | Whisper only | Whisper, Parakeet, HuggingFace, Custom |
| **Processing** | Sequential | Parallel (2-8 workers) |
| **Latency** | 200-500ms | <200ms |
| **Memory Usage** | 50-1500MB | 500MB + 200MB/worker |
| **Batch Processing** | Sequential | Concurrent |
| **Apple Silicon Optimization** | Basic | MLX acceleration |
| **Failover** | N/A | Falls back to integrated |
| **Configuration** | Basic | Advanced |
| **Best For** | Casual users | Power users, developers |

## Frequently Asked Questions

### General Questions

**Q: Do I need the external service?**
A: No, Scout works perfectly fine without it. The external service is for users who need advanced features or better performance.

**Q: Will it slow down my computer?**
A: The service only uses resources when actively transcribing. It's designed to be efficient and can be configured to use fewer workers on lower-end machines.

**Q: Can I switch between modes?**
A: Yes! You can switch between Integrated and Advanced modes at any time in Scout's settings.

### Technical Questions

**Q: What's the difference between Sled and ZeroMQ queues?**
A: Sled provides persistent local queues that survive restarts. ZeroMQ enables distributed processing across multiple machines. For most users, the default (Sled) is recommended.

**Q: How do I add my own custom model?**
A: Place your model in `~/.scout-transcriber/models/` and modify the Python worker to load it. See the documentation for detailed instructions.

**Q: Why Python workers instead of pure Rust?**
A: Python has the richest ML ecosystem. This hybrid approach gives us Rust's reliability with Python's flexibility.

### Troubleshooting

**Q: The service won't start**
A: Check if the ports are in use: `lsof -i :5555`. Stop any conflicting services or configure different ports.

**Q: Scout can't connect to the service**
A: Ensure the service is running (`ps aux | grep scout-transcriber`) and ports match in both Scout and service settings.

**Q: Transcription is slower than expected**
A: Try using fewer workers or switching to a smaller model. On Apple Silicon, ensure you're using Parakeet MLX.

## Resources

### Documentation
- [Source Code](https://github.com/arach/scout/tree/master/transcriber)
- [API Reference](https://github.com/arach/scout/tree/master/transcriber#api-reference)
- [Model Guide](https://github.com/arach/scout/tree/master/transcriber#supported-models)

### Downloads
- [Installer Script](https://scout.arach.dev/transcriber-install.sh)
- [Uninstaller Script](https://scout.arach.dev/transcriber-uninstall.sh)
- [Service README](https://scout.arach.dev/transcriber-readme.txt)

### Community
- [Report Issues](https://github.com/arach/scout/issues)
- [Discussions](https://github.com/arach/scout/discussions)
- [Discord Server](https://discord.gg/scout) *(Coming Soon)*

## Next Steps

1. **Install the Service**: Run the quick install command
2. **Configure Scout**: Switch to Advanced Mode in settings
3. **Choose Your Model**: Select the best model for your hardware
4. **Start Transcribing**: Experience the performance boost!

For detailed setup instructions, see the [Installation](#installation) section above.
# Scout Transcriber Setup Guide

## Overview

Scout Transcriber is a standalone transcription service that processes audio through a queue-based architecture, supporting multiple transcription backends including Whisper and Parakeet TDT models.

## Prerequisites

### Required Software

1. **Rust** (1.70 or later)
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. **UV** (Python package manager)
   ```bash
   # macOS/Linux
   curl -LsSf https://astral.sh/uv/install.sh | sh
   
   # Or with Homebrew
   brew install uv
   ```

3. **Python** (3.10 or later)
   - UV will handle Python installation if needed

## Installation

### 1. Build the Rust Service

```bash
cd scout-transcriber
cargo build --release
```

The binary will be available at `target/release/scout-transcriber`

### 2. Verify Python Worker

Test that the Python worker can run with UV:

```bash
# This will automatically download dependencies on first run
uv run python/transcriber.py --help
```

## Running the Service

### Basic Usage

Start the transcription service with default settings:

```bash
./target/release/scout-transcriber
```

Default configuration:
- Input queue: `/tmp/scout-transcriber/input`
- Output queue: `/tmp/scout-transcriber/output`
- Workers: 2
- Log level: info

### Advanced Configuration

```bash
./target/release/scout-transcriber \
    --workers 4 \
    --input-queue /var/lib/scout/input \
    --output-queue /var/lib/scout/output \
    --log-level debug \
    --python-cmd uv \
    --python-args "run python/transcriber.py --model parakeet"
```

### Available Options

```
Options:
  --input-queue <PATH>      Input queue directory [default: /tmp/scout-transcriber/input]
  --output-queue <PATH>     Output queue directory [default: /tmp/scout-transcriber/output]
  --workers <N>             Number of Python workers [default: 2]
  --python-cmd <CMD>        Python command [default: uv]
  --python-args <ARGS>      Python script arguments [default: run python/transcriber.py]
  --log-level <LEVEL>       Log level (trace/debug/info/warn/error) [default: info]
  --max-restarts <N>        Max restart attempts per worker [default: 10]
  --heartbeat-interval <S>  Heartbeat interval in seconds [default: 30]
  --response-timeout <S>    Response timeout in seconds [default: 30]
  --poll-interval <MS>      Queue poll interval in milliseconds [default: 100]
  --persistent-queues       Enable queue persistence [default: true]
  -h, --help               Print help
  -V, --version            Print version
```

## Python Worker Configuration

### Using Whisper (Default)

The default configuration uses OpenAI's Whisper model:

```bash
uv run python/transcriber.py --model whisper
```

### Using Parakeet TDT

To use NVIDIA's Parakeet TDT model (requires additional setup):

```bash
uv run python/transcriber.py --model parakeet
```

**Note**: The current implementation uses Whisper as a placeholder. To use actual Parakeet:

1. Install NVIDIA NeMo toolkit
2. Download Parakeet model weights
3. Update `python/transcriber.py` to load the actual model

### Custom Model Integration

To add a new model:

1. Create a new model class in `python/transcriber.py`:
   ```python
   class YourModel(TranscriptionModel):
       def __init__(self):
           # Load your model
           pass
       
       def transcribe(self, audio, sample_rate):
           # Implement transcription
           return text, confidence
   ```

2. Register it in the worker:
   ```python
   def _create_model(self):
       if self.model_type == "your_model":
           return YourModel()
   ```

## Integration with Scout

### Using as a Library

Add to your `Cargo.toml`:

```toml
[dependencies]
scout-transcriber = { path = "../scout-transcriber" }
```

Example usage:

```rust
use scout_transcriber::{TranscriberClient, utils::create_test_audio_chunk};

#[tokio::main]
async fn main() -> Result<()> {
    // Connect to running service
    let client = TranscriberClient::new()?;
    
    // Submit audio for transcription
    let audio = vec![0.1, 0.2, 0.3, ...]; // Your audio samples
    let chunk = create_audio_chunk(audio, 16000);
    client.transcribe(chunk).await?;
    
    // Poll for results
    while let Some(result) = client.poll_results().await? {
        match result {
            Ok(transcript) => println!("Text: {}", transcript.text),
            Err(error) => eprintln!("Error: {}", error.message),
        }
    }
    
    Ok(())
}
```

### Using from Tauri

The Scout Tauri app includes an `external_service` module:

```rust
use crate::transcription::external_service::{
    ExternalTranscriber, ExternalServiceConfig
};

let config = ExternalServiceConfig {
    binary_path: PathBuf::from("scout-transcriber"),
    workers: 4,
    managed: true, // Auto-start the service
    ..Default::default()
};

let transcriber = ExternalTranscriber::new(config).await?;
let text = transcriber.transcribe_sync(audio, 16000, Duration::from_secs(30)).await?;
```

## Running as a System Service

### macOS (launchd)

Create `/Library/LaunchDaemons/com.scout.transcriber.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" 
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.scout.transcriber</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/scout-transcriber</string>
        <string>--workers</string>
        <string>4</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/var/log/scout-transcriber.log</string>
    <key>StandardErrorPath</key>
    <string>/var/log/scout-transcriber.error.log</string>
</dict>
</plist>
```

Load the service:
```bash
sudo launchctl load /Library/LaunchDaemons/com.scout.transcriber.plist
```

### Linux (systemd)

Create `/etc/systemd/system/scout-transcriber.service`:

```ini
[Unit]
Description=Scout Transcription Service
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/scout-transcriber --workers 4
Restart=always
RestartSec=10
User=scout
Group=scout

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable scout-transcriber
sudo systemctl start scout-transcriber
```

## Performance Tuning

### Queue Settings

For high-throughput scenarios:
```bash
./target/release/scout-transcriber \
    --poll-interval 50 \      # Faster polling
    --workers 8 \              # More workers
    --persistent-queues false  # In-memory queues
```

### Python Worker Optimization

Set environment variables for better performance:
```bash
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
export OMP_NUM_THREADS=4
```

### GPU Acceleration

If you have NVIDIA GPU:
1. Install CUDA toolkit
2. Install PyTorch with CUDA support
3. The worker will automatically use GPU if available

## Monitoring

### Check Service Health

View logs:
```bash
# If running in foreground
./target/release/scout-transcriber --log-level debug

# If running as service
tail -f /var/log/scout-transcriber.log
```

### Queue Statistics

The service logs queue statistics every minute:
```
[INFO] Service stats: input_queue=5, output_queue=2, total_requests=100, successful=98, failed=2
```

### Worker Health

Monitor worker status in logs:
```
[INFO] Worker 1a2b3c4d is healthy
[DEBUG] Heartbeat sent for worker 1a2b3c4d
```

## Troubleshooting

### Common Issues

1. **"Failed to open queue" error**
   - Ensure queue directories exist and have write permissions
   - Try: `mkdir -p /tmp/scout-transcriber/{input,output}`

2. **"Python process failed to spawn"**
   - Verify UV is installed: `uv --version`
   - Check Python script path is correct
   - Test manually: `uv run python/transcriber.py`

3. **"No transcription results"**
   - Check worker logs for errors
   - Verify audio format (16kHz mono recommended)
   - Increase response timeout: `--response-timeout 60`

4. **High memory usage**
   - Reduce number of workers
   - Use smaller models (whisper-tiny instead of whisper-base)
   - Enable queue size limits in code

### Debug Mode

Run with maximum logging:
```bash
RUST_LOG=trace ./target/release/scout-transcriber --log-level trace
```

### Testing the Pipeline

Use the included demo:
```bash
cargo run --example demo
```

Or test with curl (requires additional HTTP API implementation):
```bash
# Submit audio
curl -X POST http://localhost:8080/transcribe \
  -H "Content-Type: application/json" \
  -d '{"audio": [0.1, 0.2, ...], "sample_rate": 16000}'
```

## Development

### Running Tests

```bash
# Rust tests
cargo test

# Python tests
uv run python -m pytest python/tests/
```

### Building Documentation

```bash
cargo doc --open
```

### Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## Support

For issues or questions:
- Check the [README](README.md) for architecture details
- Open an issue on GitHub
- Check logs with `--log-level debug`

## License

See LICENSE file in the project root.
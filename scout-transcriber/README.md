# Scout Transcriber

A high-performance, standalone transcription service built in Rust that uses Python workers for audio transcription. Designed for production use with robust error handling, automatic restarts, and efficient queue-based architecture.

## Features

- **Sled-based Message Queues**: Persistent, reliable queues for audio chunks and transcripts with UUID-based correlation
- **MessagePack Serialization**: Efficient binary serialization for minimal overhead
- **Python Worker Management**: Automatic subprocess management with health monitoring and exponential backoff restarts
- **Cross-Platform**: Works on macOS, Linux, and Windows
- **Production Ready**: Comprehensive error handling, logging, and monitoring
- **Library + Binary**: Use as a standalone service or integrate as a Rust library

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Client Apps   │    │  Scout Service   │    │ Python Workers  │
│                 │    │                  │    │                 │
│ ┌─────────────┐ │    │ ┌──────────────┐ │    │ ┌─────────────┐ │
│ │AudioChunk   │─┼────┼→│ Input Queue  │ │    │ │   Worker 1  │ │
│ │Transcript   │←┼────┼─│ Output Queue │←┼────┼─│   Worker 2  │ │
│ └─────────────┘ │    │ └──────────────┘ │    │ │   Worker N  │ │
└─────────────────┘    └──────────────────┘    │ └─────────────┘ │
                                               └─────────────────┘
```

## 🚀 Quick Start

### Automated Setup

```bash
# Run the quick start script for automated setup
./quickstart.sh
```

### Manual Setup

1. **Install prerequisites** (Rust and UV)
2. **Build**: `cargo build --release`
3. **Run**: `./target/release/scout-transcriber`

📚 **For detailed setup instructions, see [SETUP.md](SETUP.md)**

### Basic Usage

```bash
# Default configuration (2 workers, /tmp queues)
./target/release/scout-transcriber

# Production configuration
./target/release/scout-transcriber \
    --workers 4 \
    --input-queue /var/lib/scout/input \
    --output-queue /var/lib/scout/output \
    --log-level debug
```

### 3. Use the Library

```rust
use scout_transcriber::{
    protocol::AudioChunk,
    TranscriberClient,
    utils::create_test_audio_chunk,
};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Connect to the service queues
    let client = TranscriberClient::new()?;
    
    // Create audio data (or load from file)
    let audio_chunk = create_test_audio_chunk(2.0, 16000);
    
    // Submit for transcription
    client.transcribe(audio_chunk).await?;
    
    // Poll for results
    while let Some(result) = client.poll_results().await? {
        match result {
            Ok(transcript) => println!("Transcript: {}", transcript.text),
            Err(error) => eprintln!("Error: {}", error.message),
        }
    }
    
    Ok(())
}
```

### 4. Run the Demo

```bash
cargo run --example demo
```

## Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `--input-queue` | `/tmp/scout-transcriber/input` | Input queue directory path |
| `--output-queue` | `/tmp/scout-transcriber/output` | Output queue directory path |
| `--workers` | `2` | Number of Python worker processes |
| `--python-cmd` | `uv` | Python command to use |
| `--python-args` | `run main.py` | Arguments passed to Python command |
| `--python-workdir` | None | Working directory for Python processes |
| `--max-restarts` | `10` | Maximum restart attempts per worker |
| `--heartbeat-interval` | `30` | Heartbeat interval in seconds |
| `--response-timeout` | `30` | Response timeout in seconds |
| `--poll-interval` | `100` | Queue processing interval in milliseconds |
| `--persistent-queues` | `true` | Enable persistent queues (vs in-memory) |
| `--log-level` | `info` | Log level (trace, debug, info, warn, error) |

## Python Worker Interface

Your Python worker should read MessagePack-serialized `AudioChunk` objects from stdin and write `Transcript` objects to stdout. Here's a basic template:

```python
#!/usr/bin/env python3
import sys
import msgpack
from datetime import datetime, timezone

def process_audio_chunk(audio_chunk):
    """
    Process audio and return transcript
    
    audio_chunk format:
    {
        "id": "uuid-string",
        "audio": [f32 samples],
        "sample_rate": 16000,
        "channels": 1,
        "timestamp": "ISO8601",
        "metadata": {"key": "value"} or None
    }
    """
    
    # Your transcription logic here
    # This could use whisper, wav2vec2, etc.
    transcript_text = "Your transcription result"
    confidence = 0.95
    
    # Return transcript
    return {
        "id": audio_chunk["id"],
        "text": transcript_text,
        "confidence": confidence,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "metadata": {
            "language": "en",
            "processing_time_ms": 250,
            "model": "whisper-base",
            "extra": None
        }
    }

def main():
    unpacker = msgpack.Unpacker(sys.stdin.buffer, raw=False)
    
    for audio_chunk in unpacker:
        try:
            transcript = process_audio_chunk(audio_chunk)
            
            # Send result as hex-encoded MessagePack
            result_bytes = msgpack.packb(transcript)
            print(result_bytes.hex())
            sys.stdout.flush()
            
        except Exception as e:
            # Send error
            error = {
                "id": audio_chunk.get("id", "unknown"),
                "message": str(e),
                "code": "PROCESSING_ERROR",
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
            error_bytes = msgpack.packb(error)
            print(f"ERROR:{error_bytes.hex()}")
            sys.stdout.flush()

if __name__ == "__main__":
    main()
```

## API Reference

### Core Types

- **`AudioChunk`**: Audio data with metadata
- **`Transcript`**: Transcription result with confidence score
- **`TranscriptionError`**: Error information for failed transcriptions
- **`HealthStatus`**: Worker health monitoring data

### Queue Operations

- **`SledQueue<T>`**: High-performance persistent queue
- **`IndexedSledQueue<T>`**: Queue with efficient UUID-based lookups
- **`Queue` trait**: Generic queue interface

### Worker Management

- **`PythonWorker`**: Single worker process manager
- **`WorkerPool`**: Pool of multiple workers with load balancing
- **`WorkerConfig`**: Configuration for worker processes

## Performance Characteristics

- **Throughput**: Designed for high-throughput audio processing
- **Memory**: Efficient memory usage with streaming and cleanup
- **Latency**: Sub-second queue operations with configurable polling
- **Reliability**: Automatic worker restarts with exponential backoff
- **Scalability**: Horizontal scaling via worker pool configuration

## Error Handling

The service provides comprehensive error handling:

1. **Worker Failures**: Automatic restart with exponential backoff
2. **Queue Errors**: Detailed error reporting and recovery
3. **Serialization**: Graceful handling of malformed data
4. **Process Management**: Clean shutdown and resource cleanup

## Monitoring

The service provides built-in monitoring:

- **Health Checks**: Worker health status and heartbeats
- **Statistics**: Queue lengths, processing rates, error counts
- **Logging**: Structured logging with configurable levels
- **Metrics**: Performance metrics and timing information

## Integration Examples

### With Scout Main Application

```rust
// In your Scout application
use scout_transcriber::{TranscriberClient, utils::create_test_audio_chunk};

async fn transcribe_audio(audio_samples: Vec<f32>, sample_rate: u32) -> anyhow::Result<String> {
    let client = TranscriberClient::new()?;
    let chunk = AudioChunk::new(audio_samples, sample_rate, 1);
    
    client.transcribe(chunk.clone()).await?;
    
    // Wait for result with timeout
    loop {
        if let Some(result) = client.poll_results().await? {
            return match result {
                Ok(transcript) => Ok(transcript.text),
                Err(error) => Err(anyhow::anyhow!(error.message)),
            };
        }
        
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}
```

### As a Microservice

Deploy as a standalone service and communicate via HTTP API or direct queue access.

## Development

### Running Tests

```bash
cargo test
```

### Building Documentation

```bash
cargo doc --open
```

### Linting

```bash
cargo clippy -- -D warnings
```

## License

[Add your license information here]

## Contributing

[Add contributing guidelines here]
# Scout Project Structure

## Directory Layout

```
scout/
├── src/                    # Frontend React/TypeScript application
│   ├── components/        # React components
│   ├── hooks/            # Custom React hooks
│   ├── contexts/         # React context providers
│   ├── lib/              # Utilities and helpers
│   └── types/            # TypeScript definitions
├── src-tauri/             # Backend Rust/Tauri application
│   ├── src/               # Rust source code
│   │   ├── audio/         # Audio recording and processing
│   │   ├── transcription/ # Transcription engine & external service client
│   │   ├── benchmarking/  # Performance benchmarking tools
│   │   ├── bin/           # Binary executables (benchmark tools)
│   │   ├── db/            # Database operations
│   │   ├── commands/      # Tauri command handlers
│   │   ├── llm/           # LLM processing pipeline
│   │   ├── macos/         # macOS-specific implementations
│   │   └── service_manager.rs  # External service lifecycle management
│   └── benchmark_corpus/  # Audio test files for benchmarking
├── transcriber/           # Standalone transcription service (NEW)
│   ├── src/               # Rust service core
│   │   ├── worker.rs      # Python worker management
│   │   ├── worker_pool.rs # Pool orchestration
│   │   ├── protocol.rs    # Message protocol
│   │   └── queue/         # Queue implementations
│   │       ├── sled_queue.rs    # Persistent local queue
│   │       └── zmq_queue.rs     # ZeroMQ distributed queue
│   ├── python/            # Python ML workers
│   │   ├── transcriber.py # Main worker entry point
│   │   └── models/        # AI model implementations
│   │       ├── whisper.py
│   │       ├── parakeet.py
│   │       └── huggingface.py
│   ├── README.md          # Service documentation
│   └── quickstart.sh      # Setup script
├── docs/                  # Project documentation
│   ├── architecture/      # System architecture documentation
│   │   ├── transcription-architecture.md  # Core transcription system
│   │   ├── settings-management.md         # Settings system architecture
│   │   ├── audio-pipeline.md
│   │   └── progressive-transcription-architecture.md
│   ├── development/       # Developer guides
│   │   ├── working-with-settings.md       # Settings implementation guide
│   │   ├── RELEASE_CHECKLIST.md
│   │   └── TESTING_SPEC.md
│   ├── features/          # Feature documentation
│   │   ├── transcription-overlay.md
│   │   ├── voice-shortcuts.md
│   │   └── webhooks-spec.md
│   └── guides/            # User and performance guides
├── landing/               # Scout website & blog
│   ├── app/
│   │   ├── blog/         # Blog posts
│   │   │   └── external-transcription-services.md
│   │   └── docs/         # Online documentation
│   └── public/           # Static assets
├── marketing/             # Marketing and partnership materials
│   ├── PARTNERSHIP-GUIDE.md
│   ├── PRESS-KIT.md
│   └── SDK-README.md
├── test-files/            # Test utilities and examples
│   ├── test-drag-drop.html
│   └── test-overlay.md
├── models/                # Downloaded Whisper models
├── scripts/               # Setup and utility scripts
└── README.md              # Main project documentation
```

## Key Configuration Files

### Root Level
- `CLAUDE.md` - AI assistant instructions for this codebase
- `CLAUDE.local.md` - Private local instructions (not in git)
- `package.json` - Node.js dependencies and scripts
- `pnpm-lock.yaml` - pnpm lock file
- `tsconfig.json` - TypeScript configuration
- `vite.config.ts` - Vite bundler configuration
- `tailwind.config.js` - Tailwind CSS configuration

### Tauri Backend (`src-tauri/`)
- `Cargo.toml` - Rust dependencies
- `tauri.conf.json` - Tauri application configuration
- `build.rs` - Build script for Rust compilation

### Transcriber Service (`transcriber/`)
- `Cargo.toml` - Service Rust dependencies
- `pyproject.toml` - Python project configuration (UV)
- `requirements.txt` - Python dependencies
- `transcriber.plist` - macOS LaunchAgent configuration

## Key Components

### Main Application

#### Frontend (`src/`)
- **components/** - React components for UI
  - `TranscriptionSettings.tsx` - Mode switching (Integrated/Advanced)
  - `ModelManager.tsx` - Built-in model management
  - `ExternalTranscriberDocs.tsx` - External service documentation
- **hooks/** - Custom React hooks
  - `useSettings.ts` - Settings management hook
  - `useTranscription.ts` - Transcription state management
- **types/** - TypeScript type definitions
  - `settings.ts` - Settings interface definitions

#### Backend (`src-tauri/src/`)
- **audio/** - Audio recording and processing
  - `ring_buffer_recorder.rs` - Circular buffer for real-time recording
  - `audio_converter.rs` - Format conversion utilities
- **transcription/** - Transcription engines
  - `transcription_service.rs` - Built-in Whisper integration
  - `external_service_client.rs` - External service communication
  - `strategy.rs` - Strategy pattern for different modes
- **service_manager.rs** - External service lifecycle management
- **settings.rs** - Settings persistence and management

### External Service (`transcriber/`)

#### Rust Core (`src/`)
- **main.rs** - Service entry point and CLI
- **worker.rs** - Individual Python worker management
- **worker_pool.rs** - Pool orchestration and load balancing
- **protocol.rs** - MessagePack protocol definitions
- **queue/** - Queue backend implementations
  - `sled_queue.rs` - Persistent local queue with ACID guarantees
  - `zmq_queue.rs` - ZeroMQ distributed queue for scaling

#### Python Workers (`python/`)
- **transcriber.py** - Main worker that reads from stdin/stdout
- **models/** - AI model implementations
  - `whisper.py` - OpenAI Whisper models
  - `parakeet.py` - NVIDIA Parakeet MLX for Apple Silicon
  - `huggingface.py` - Hugging Face model integration

## Data Flow

### Integrated Mode (Built-in)
```
Microphone → Audio Buffer → Whisper.cpp → Transcript → Database
```

### Advanced Mode (External Service)
```
Microphone → Audio Buffer → Service Client → Message Queue
    ↓
Python Worker Pool → AI Model → Message Queue
    ↓
Service Client → Transcript → Database
```

## Configuration Locations

### Application Settings
- **macOS**: `~/Library/Application Support/com.scout.transcriber/settings.json`
- **Linux**: `~/.config/scout/settings.json`
- **Windows**: `%APPDATA%\scout\settings.json`

### Transcriber Service
- **Config**: `~/.scout-transcriber/config.toml`
- **Models**: `~/.scout-transcriber/models/`
- **Logs**: `~/.scout-transcriber/logs/`
- **Python venv**: `~/.scout-transcriber/venv/`
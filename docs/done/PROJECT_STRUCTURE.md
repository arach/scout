# Scout Project Structure

## Directory Layout

```
scout/
├── src/                    # Frontend React/TypeScript application
├── src-tauri/             # Backend Rust/Tauri application
│   ├── src/               # Rust source code
│   │   ├── audio/         # Audio recording and processing
│   │   ├── benchmarking/  # Performance benchmarking tools
│   │   ├── bin/           # Binary executables (benchmark tools)
│   │   └── db/            # Database operations
│   └── benchmark_corpus/  # Audio test files for benchmarking
├── docs/                  # Project documentation
│   ├── TRANSCRIPTION_ARCHITECTURE.md    # Core architecture overview
│   ├── PERFORMANCE_OPTIMIZATION_EXECUTIVE_SUMMARY.md
│   ├── OVERLAY_HOVER.md   # Overlay UI implementation details
│   ├── ACTIVE_APP_DETECTION.md
│   ├── DEBUG_LOGGING.md
│   ├── OPEN_OVERLAY_DEVTOOLS.md
│   ├── PERFORMANCE.md
│   └── WHISPER_IMPROVEMENTS.md
├── marketing/             # Marketing and partnership materials
│   ├── PARTNERSHIP-GUIDE.md
│   ├── PRESS-KIT.md
│   └── SDK-README.md
├── test-files/            # Test utilities and examples
│   ├── test-drag-drop.html
│   └── test-overlay.md
├── public/                # Static assets
├── landing-page/          # Scout website
└── README.md              # Main project documentation
```

## Key Configuration Files

- `CLAUDE.md` - AI assistant instructions for this codebase
- `CLAUDE.local.md` - Private local instructions (not in git)
- `package.json` - Node.js dependencies and scripts
- `Cargo.toml` - Rust dependencies (in src-tauri/)
- `tauri.conf.json` - Tauri application configuration
# Scout Performance Optimizations

## Build Optimizations

### Rust Release Build
- **LTO (Link Time Optimization)**: Enabled for ~20% binary size reduction
- **Codegen Units = 1**: Better optimization at cost of compile time
- **Strip Debug Symbols**: Reduces binary size by ~50%
- **Panic = Abort**: Saves ~10% binary size
- **Opt Level 3**: Maximum performance optimizations

### Frontend Bundle
- **Terser Minification**: Removes dead code and console logs
- **Code Splitting**: Separate chunks for React and Tauri APIs
- **Tree Shaking**: Automatic via Vite/Rollup

## Runtime Optimizations

### Memory Management
1. **Lazy Model Loading**: Whisper models load on first use
2. **Ring Buffer**: Fixed memory allocation for audio
3. **Streaming Transcription**: Process audio in chunks

### Performance Targets
- Startup time: < 2 seconds
- Model load time: < 3 seconds (tiny), < 5 seconds (base)
- Memory usage: < 150MB idle, < 300MB during transcription
- Transcription latency: < 300ms for chunks

## Production Build Commands

```bash
# Development build (unoptimized)
pnpm tauri dev

# Production build (optimized)
pnpm tauri build

# Production build with custom config
pnpm tauri build -c tauri.prod.conf.json

# Build for specific architecture
pnpm tauri build --target universal-apple-darwin
```

## Profiling Tools

### Memory Profiling
```bash
# Use Instruments on macOS
instruments -t "Activity Monitor" target/release/scout
```

### Performance Profiling
```bash
# CPU profiling
cargo build --release
samply record target/release/scout
```

## Optimization Checklist

- [ ] Enable release optimizations in Cargo.toml
- [ ] Remove console.log statements in production
- [ ] Lazy load heavy components (audio player, waveform)
- [ ] Use production Whisper builds with CoreML
- [ ] Enable app nap on macOS for background efficiency
- [ ] Minimize tray icon updates
- [ ] Batch database operations
- [ ] Use efficient audio formats (16kHz mono)

## Binary Size Optimization

Current sizes (approximate):
- Debug build: ~150MB
- Release build: ~50MB
- With UPX compression: ~20MB

To further reduce:
1. Use `cargo-bloat` to analyze
2. Disable unused features in dependencies
3. Use `wasm-opt` for web components
4. Consider dynamic linking for Whisper

## Startup Performance

1. **Defer Non-Critical Operations**
   - Model loading
   - Database migrations
   - Settings validation

2. **Parallel Initialization**
   - UI rendering
   - Database connection
   - Audio device enumeration

3. **Progressive Enhancement**
   - Show UI immediately
   - Load features as needed
   - Background model downloads
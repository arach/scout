# How to Run Scout Tests

## Backend (Rust) Tests

```bash
# From the src-tauri directory
cd src-tauri

# Run all tests
cargo test

# Run only unit tests (faster)
cargo test --lib

# Run specific module tests
cargo test audio::                    # All audio tests
cargo test transcription::            # All transcription tests
cargo test audio::recorder::tests    # Just recorder tests

# Run integration tests
cargo test --test audio_integration_tests

# Run with output
cargo test -- --nocapture

# Run a specific test
cargo test test_ring_buffer_basic
```

## Frontend (React/TypeScript) Tests

```bash
# From the project root
cd /Users/arach/dev/scout

# Run tests in watch mode
pnpm test

# Run tests once and exit
pnpm test:run

# Run with coverage
pnpm test:coverage

# Run specific test file
pnpm test RecordView

# Run tests matching a pattern
pnpm test -- --grep "recording"
```

## Common Issues

### "0 tests" output
This happens when:
- Your filter doesn't match any test names
- You're in the wrong directory
- You accidentally added a typo in the test name

### Examples that would show "0 tests":
```bash
cargo test fake_test_name     # No test matches
cargo test --bin scout        # Binary has no tests
cargo test transcriptoin::    # Typo in module name
```

## Quick Test Commands

```bash
# Backend - verify all tests work
cd src-tauri && cargo test --lib

# Frontend - verify all tests work  
pnpm test:run

# Both - run from project root
(cd src-tauri && cargo test --lib) && pnpm test:run
```
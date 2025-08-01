# Scout Testing Specification

## Overview
This document outlines the comprehensive testing strategy for Scout, covering unit tests, integration tests, E2E tests, and performance benchmarks.

## 1. Testing Infrastructure Setup

### 1.1 Rust Testing Stack
```toml
# Add to src-tauri/Cargo.toml [dev-dependencies]
mockall = "0.12"          # Mocking framework
rstest = "0.18"           # Parameterized tests
tempfile = "3.8"         # Temporary files for tests
serial_test = "3.0"      # Sequential test execution
criterion = "0.5"         # Benchmarking
fake = "2.9"             # Fake data generation
```

### 1.2 Frontend Testing Stack
```json
// Add to package.json devDependencies
"@testing-library/react": "^14.0.0",
"@testing-library/jest-dom": "^6.1.0",
"@testing-library/user-event": "^14.5.0",
"jest": "^29.7.0",
"jest-environment-jsdom": "^29.7.0",
"@types/jest": "^29.5.0",
"vitest": "^1.0.0",
"@vitest/ui": "^1.0.0",
"msw": "^2.0.0"  // Mock Service Worker for API mocking
```

### 1.3 E2E Testing Stack
```json
// Add for E2E testing
"@playwright/test": "^1.40.0",
"@tauri-apps/webdriver": "^2.0.0"
```

## 2. Unit Tests

### 2.1 Rust Unit Tests

#### Audio Module Tests (`src-tauri/src/audio/`)

**recorder.rs tests:**
```rust
// Test initialization with different sample rates
// Test start/stop recording state transitions
// Test buffer management and overflow handling
// Test error handling for device disconnection
// Mock cpal Host and Device traits
```

**ring_buffer_recorder.rs tests:**
```rust
// Test circular buffer write/read operations
// Test buffer overflow behavior
// Test concurrent access safety
// Test sample extraction with different lengths
```

**converter.rs tests:**
```rust
// Test format conversions (f32 -> i16)
// Test resampling accuracy
// Test edge cases (empty buffers, single sample)
// Benchmark conversion performance
```

**device_monitor.rs tests:**
```rust
// Test device enumeration
// Test default device selection
// Test device change notifications (mock events)
// Test error handling for no devices
```

#### Transcription Module Tests (`src-tauri/src/transcription/`)

**strategy.rs tests:**
```rust
// Test transcription strategy initialization
// Test strategy switching logic
// Test concurrent transcription handling
// Mock whisper model for predictable outputs
```

**ring_buffer_transcriber.rs tests:**
```rust
// Test continuous transcription flow
// Test buffer size optimization
// Test transcription merging logic
// Test memory usage patterns
```

#### Database Module Tests (`src-tauri/src/db/`)

```rust
// Test CRUD operations
// Test search functionality
// Test concurrent access
// Test migration execution
// Use in-memory SQLite for speed
```

### 2.2 Frontend Unit Tests

#### Component Tests

**RecordingControls.tsx:**
```typescript
// Test recording button states
// Test keyboard shortcut triggers
// Test permission request flow
// Test error state rendering
// Mock Tauri commands
```

**TranscriptList.tsx:**
```typescript
// Test transcript rendering
// Test pagination behavior
// Test search filtering
// Test delete confirmation
// Test empty state
```

**Settings.tsx:**
```typescript
// Test settings form validation
// Test preference persistence
// Test theme switching
// Test model selection
```

#### Hook Tests

**useRecording.ts:**
```typescript
// Test recording state management
// Test start/stop command calls
// Test error handling
// Test cleanup on unmount
```

**useTranscripts.ts:**
```typescript
// Test data fetching
// Test optimistic updates
// Test error recovery
// Test pagination logic
```

## 3. Integration Tests

### 3.1 Tauri Command Tests

```rust
// Test command registration
// Test parameter validation
// Test response serialization
// Test error propagation
// Use test fixtures for app state
```

### 3.2 Frontend-Backend Integration

```typescript
// Test recording flow end-to-end
// Test file upload processing
// Test event subscriptions
// Test state synchronization
// Mock Tauri API at transport level
```

### 3.3 Database Integration

```rust
// Test transaction handling
// Test connection pooling
// Test concurrent operations
// Test data integrity
// Use test database with known data
```

## 4. E2E Tests

### 4.1 Critical User Flows

**Recording Flow:**
```typescript
test('user can record and save audio', async ({ page }) => {
  // Grant microphone permission
  // Click record button
  // Speak test audio
  // Stop recording
  // Verify transcript appears
  // Verify audio file saved
});
```

**Search Flow:**
```typescript
test('user can search transcripts', async ({ page }) => {
  // Type search query
  // Verify results filtered
  // Click result
  // Verify detail view
});
```

**Settings Flow:**
```typescript
test('user can change settings', async ({ page }) => {
  // Open settings
  // Change model
  // Change theme
  // Verify persistence
});
```

### 4.2 Keyboard Shortcuts

```typescript
test('global shortcuts work', async ({ page }) => {
  // Test Cmd+R for recording
  // Test Escape to cancel
  // Test Cmd+S to save
});
```

## 5. Performance Tests

### 5.1 Benchmarks

**Transcription Performance:**
```rust
#[bench]
fn bench_transcribe_30s_audio(b: &mut Bencher) {
    // Measure transcription time
    // Track memory usage
    // Compare strategies
}
```

**Audio Processing:**
```rust
#[bench]
fn bench_resample_audio(b: &mut Bencher) {
    // Measure resampling speed
    // Test different buffer sizes
}
```

### 5.2 Load Tests

```typescript
// Test with 100+ transcripts
// Test rapid start/stop recording
// Test concurrent operations
// Monitor memory leaks
```

## 6. Test Organization

### Directory Structure
```
scout/
├── src-tauri/
│   ├── src/
│   └── tests/
│       ├── unit/
│       │   ├── audio/
│       │   ├── transcription/
│       │   └── db/
│       └── integration/
├── src/
│   └── __tests__/
│       ├── components/
│       ├── hooks/
│       └── utils/
└── e2e/
    ├── fixtures/
    └── specs/
```

### Test Utilities

**Rust Test Helpers:**
```rust
// create_test_audio_buffer()
// create_mock_whisper_model()
// create_test_db()
// assert_audio_format()
```

**Frontend Test Helpers:**
```typescript
// renderWithProviders()
// createMockTauriAPI()
// waitForTranscription()
// generateTestAudio()
```

## 7. CI/CD Integration

```yaml
# .github/workflows/test.yml
name: Test Suite
on: [push, pull_request]

jobs:
  rust-tests:
    runs-on: ubuntu-latest
    steps:
      - cargo test --all-features
      - cargo bench --no-run
  
  frontend-tests:
    runs-on: ubuntu-latest
    steps:
      - pnpm test
      - pnpm test:coverage
  
  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - pnpm test:e2e
```

## 8. Coverage Goals

- Unit Tests: 80% coverage minimum
- Integration Tests: Critical paths covered
- E2E Tests: Happy paths + key error cases
- Performance: Regression detection

## 9. Testing Best Practices

1. **Test Naming**: Use descriptive names that explain what and why
2. **Isolation**: Each test should be independent
3. **Fixtures**: Use consistent test data
4. **Mocking**: Mock external dependencies
5. **Assertions**: One logical assertion per test
6. **Performance**: Keep tests fast (<100ms for unit tests)
# Scout Audio Module Unit Tests

This directory contains comprehensive unit tests for the Scout application's audio module, focusing on core audio processing functionality while using mocking to isolate dependencies.

## Test Structure

### Unit Tests (`tests/unit/audio/`)

The unit tests are organized by module and provide comprehensive coverage:

#### 1. **recorder_test.rs** - AudioRecorder Tests
- **Initialization and Configuration**: Tests recorder creation, initialization, and state management
- **State Transitions**: Tests start/stop recording operations and state consistency
- **Error Handling**: Tests behavior with invalid inputs, missing initialization, and device errors
- **Thread Safety**: Tests concurrent access to recorder methods
- **Sample Callbacks**: Tests real-time audio sample callback functionality
- **Audio Level Monitoring**: Tests audio level detection and monitoring features
- **Device Integration**: Tests device name validation and selection

**Key Features Tested:**
- Recorder lifecycle management
- Command validation and error handling
- Thread-safe concurrent operations
- Audio level monitoring without device dependency
- Sample callback registration and management

#### 2. **ring_buffer_recorder_test.rs** - RingBufferRecorder Tests
- **Buffer Management**: Tests circular buffer creation, sample addition, and overflow handling
- **Audio Extraction**: Tests chunk extraction by time ranges and sample ranges  
- **File Operations**: Tests WAV file creation, writing, and format validation
- **Memory Management**: Tests buffer reuse and large audio handling
- **Edge Cases**: Tests empty buffers, invalid ranges, and boundary conditions
- **Format Validation**: Tests different audio formats (mono/stereo, various sample rates)

**Key Features Tested:**
- Circular buffer implementation with 5-minute capacity
- Efficient audio chunk extraction by time ranges
- WAV file format compliance and validation
- Memory-efficient buffer management
- Thread-safe concurrent operations

#### 3. **converter_test.rs** - AudioConverter Tests
- **Format Detection**: Tests WAV vs non-WAV file detection (case-insensitive)
- **Path Management**: Tests output path generation and validation
- **File Conversion**: Tests audio format conversion using Symphonia
- **Sample Rate Conversion**: Tests downsampling (48kHz → 16kHz) with quality preservation
- **Channel Conversion**: Tests stereo to mono conversion with proper averaging
- **Bit Depth Conversion**: Tests various input formats to 16-bit integer output
- **Error Handling**: Tests invalid files, missing files, and permission errors

**Key Features Tested:**
- Multi-format audio file support via Symphonia
- High-quality resampling algorithms
- Stereo to mono conversion with proper channel mixing
- Robust error handling for various failure modes
- Thread-safe concurrent conversion operations

#### 4. **device_monitor_test.rs** - DeviceMonitor Tests  
- **Device Enumeration**: Tests audio device discovery and capability detection
- **Event System**: Tests device change notification callbacks and event types
- **Capability Tracking**: Tests device capability monitoring and comparison
- **Lifecycle Management**: Tests monitoring start/stop and cleanup
- **Error Scenarios**: Tests behavior with no devices, permission errors
- **Thread Safety**: Tests concurrent monitoring operations

**Key Features Tested:**
- Real-time device change detection
- Comprehensive device capability analysis
- Event-driven architecture for device notifications  
- Robust error handling for various system states
- Thread-safe monitoring with proper cleanup

### Common Test Utilities (`tests/common/mod.rs`)

Enhanced test utilities providing comprehensive audio testing support:

#### Audio Generation Functions
- `create_test_audio_buffer()` - Pure sine wave generation
- `create_sawtooth_buffer()` - Sawtooth wave generation  
- `create_noise_buffer()` - Reproducible white noise
- `create_fading_buffer()` - Audio with fade in/out envelopes
- `create_mixed_audio_buffer()` - Alternating audio and silence patterns
- `create_silence_buffer()` - Silent audio for testing

#### Audio Analysis Functions
- `calculate_rms()` - Root Mean Square amplitude calculation
- `calculate_peak()` - Peak amplitude detection
- `count_zero_crossings()` - Zero crossing rate analysis
- `assert_audio_equal()` - Floating-point audio comparison with tolerance
- `assert_audio_rms()` - RMS level validation with tolerance

#### Format Conversion Functions
- `convert_f32_to_i16()` / `convert_i16_to_f32()` - Sample format conversion
- `mono_to_stereo()` / `stereo_to_mono()` - Channel configuration conversion
- `apply_gain()` - Decibel-based gain adjustment

#### File I/O Functions
- `create_test_wav_file()` - WAV file creation with specified format
- `read_test_wav_file()` - WAV file reading with format detection
- `create_test_wav_spec()` - WAV format specification helpers

## Test Features

### Mocking Strategy
- **cpal Dependencies**: Uses `mockall` crate to mock audio device interfaces
- **File System**: Uses `tempfile` crate for isolated temporary file testing
- **Database**: Uses in-memory SQLite for database-dependent tests

### Isolation and Performance
- **Fast Execution**: Unit tests run in <1ms each, suitable for CI/CD
- **No Hardware Dependencies**: Tests run without requiring audio devices
- **Parallel Execution**: Tests are designed for concurrent execution
- **Deterministic**: All tests produce consistent results across runs

### Coverage Areas
- **Core Logic**: Tests business logic without external dependencies
- **Error Conditions**: Comprehensive error scenario testing
- **Edge Cases**: Boundary conditions, empty inputs, and extreme values
- **Thread Safety**: Concurrent access patterns and race condition prevention
- **Memory Management**: Buffer overflow, cleanup, and resource management

## Integration Tests

The `audio_integration_tests.rs` file provides integration tests that:
- Test actual audio file I/O operations
- Validate real format conversion workflows  
- Test performance characteristics
- Provide end-to-end audio processing validation

### Integration Test Categories
- **File Format Testing**: Real WAV file creation and reading
- **Audio Processing**: Complete processing pipelines
- **Performance Validation**: Timing and memory usage verification
- **Real Hardware Testing**: Device enumeration (marked with `#[ignore]`)

## Running Tests

### All Unit Tests
```bash
# Run all library unit tests
cargo test --lib

# Run specific audio module tests  
cargo test audio:: --lib

# Run with output for debugging
cargo test audio:: --lib -- --nocapture
```

### Specific Test Files
```bash
# Run recorder tests
cargo test audio::recorder_test --lib

# Run ring buffer tests  
cargo test audio::ring_buffer_recorder::tests --lib

# Run converter tests (these require integration test setup)
cargo test test_audio_converter --test audio_integration_tests
```

### Integration Tests
```bash
# Run integration tests
cargo test --test audio_integration_tests

# Run integration tests requiring hardware (if available)
cargo test --test audio_integration_tests -- --ignored
```

### Performance Benchmarks
```bash
# Run performance-focused tests
cargo test benchmarks --test audio_integration_tests -- --ignored
```

## Test Quality Standards

### Code Coverage
- **Unit Tests**: >90% coverage of core audio processing logic
- **Error Paths**: All error conditions tested with appropriate mocking
- **Edge Cases**: Boundary conditions and unusual inputs validated
- **Concurrent Operations**: Thread safety verified through stress testing

### Test Reliability
- **Deterministic**: Tests produce consistent results
- **Isolated**: No interdependencies between test cases
- **Fast**: Unit tests complete in milliseconds
- **Maintainable**: Clear test structure and comprehensive documentation

### Quality Assurance
- **Input Validation**: All public API inputs tested for proper validation
- **Resource Cleanup**: Memory leaks and resource cleanup verified
- **Format Compliance**: Audio format standards compliance tested
- **Error Messages**: Meaningful error messages validated

## Architecture Benefits

### Development Workflow
- **Fast Feedback**: Quick test execution enables rapid development cycles
- **Regression Prevention**: Comprehensive coverage prevents functionality regressions
- **Refactoring Confidence**: Tests enable safe code restructuring
- **Documentation**: Tests serve as executable documentation of expected behavior

### Quality Assurance
- **Platform Independence**: Tests run consistently across different operating systems
- **CI/CD Integration**: Fast, reliable tests suitable for continuous integration
- **Performance Monitoring**: Integration tests detect performance regressions
- **Hardware Abstraction**: Core logic tested independently of hardware availability

## Future Enhancements

### Additional Test Coverage
- **Real-time Performance**: Latency and throughput testing under load
- **Memory Profiling**: Detailed memory usage analysis during long recordings
- **Device Compatibility**: Testing with various audio device types and configurations
- **Codec Support**: Extended testing for additional audio formats

### Test Infrastructure
- **Property-Based Testing**: Use `proptest` for exhaustive input validation
- **Fuzzing**: Integrate `cargo-fuzz` for security and robustness testing
- **Load Testing**: Stress testing for high-throughput scenarios
- **Cross-Platform Testing**: Platform-specific behavior validation

This comprehensive test suite ensures the Scout audio module is robust, performant, and maintainable while supporting rapid development and confident deployment.
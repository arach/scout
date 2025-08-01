# Scout Production Hardening Plan

## Executive Summary

This document outlines a comprehensive plan to harden Scout's audio and transcription pipelines for production deployment. The plan addresses critical issues including error handling, resource management, performance optimization, and observability.

**Timeline**: 4 weeks
**Priority**: P0 (Critical) items must be completed before production release

## Table of Contents

1. [Error Handling Improvements](#1-error-handling-improvements-p0---critical)
2. [Memory Optimization](#2-memory-optimization-p0---critical)
3. [Performance Optimizations](#3-performance-optimizations-p1---high)
4. [Retry Mechanisms & Circuit Breakers](#4-retry-mechanisms--circuit-breakers-p1---high)
5. [Observability & Monitoring](#5-observability--monitoring-p1---high)
6. [Resource Constraints & Graceful Degradation](#6-resource-constraints--graceful-degradation-p2---medium)
7. [Health Checks](#7-health-checks-p2---medium)
8. [Implementation Timeline](#8-implementation-timeline)

---

## 1. Error Handling Improvements (P0 - Critical)

### Current State
- 50 `unwrap()` calls in audio module
- 1 `unwrap()` call in transcription module
- Multiple `expect()` calls that could panic

### Implementation Plan

#### Phase 1: Critical Audio Path (Week 1)

**File: `src-tauri/src/audio/recorder.rs`**

Replace all unwrap() calls with proper error handling:

```rust
// BEFORE (Line 90-91)
*recorder.vad_enabled.lock().unwrap() = enabled;

// AFTER
if let Ok(mut vad_enabled) = recorder.vad_enabled.lock() {
    *vad_enabled = enabled;
} else {
    error(Component::Recording, "Failed to acquire VAD lock");
}
```

```rust
// BEFORE (Line 570)
*self.sample_count.lock().unwrap() = 0;

// AFTER  
if let Err(e) = self.sample_count.lock().map(|mut count| *count = 0) {
    error(Component::Recording, &format!("Failed to reset sample count: {}", e));
    // Continue recording - non-critical error
}
```

**File: `src-tauri/src/audio/ring_buffer_recorder.rs`**

```rust
// BEFORE (Line 51-53)
let mut samples = self.samples.lock().unwrap();
let mut writer = self.writer.lock().unwrap();

// AFTER
let mut samples = self.samples.lock()
    .map_err(|e| format!("Failed to acquire samples lock: {}", e))?;
let mut writer = self.writer.lock()
    .map_err(|e| format!("Failed to acquire writer lock: {}", e))?;
```

#### Phase 2: Non-Critical Paths (Week 2)

Replace unwrap() in logging and monitoring code with silent failures:

```rust
// Create a safe lock acquisition helper
fn try_lock<T>(mutex: &Mutex<T>, component: Component, context: &str) -> Option<MutexGuard<T>> {
    match mutex.lock() {
        Ok(guard) => Some(guard),
        Err(e) => {
            error(component, &format!("{}: lock poisoned - {}", context, e));
            None
        }
    }
}
```

### Error Recovery Strategy

```rust
// Implement automatic mutex recovery
impl AudioRecorder {
    fn recover_from_poisoned_lock(&self) {
        // Create new Arc<Mutex<T>> instances for poisoned locks
        // This is safe because we're replacing the entire mutex
        if self.is_recording.lock().is_err() {
            // Log the recovery attempt
            error(Component::Recording, "Recovering from poisoned is_recording lock");
            // Note: This requires redesigning the struct to allow mutex replacement
        }
    }
}
```

---

## 2. Memory Optimization (P0 - Critical)

### Current Issues
- Vec allocation in stereo-to-mono conversion (per callback)
- Unbounded growth potential in ring buffer
- No pre-allocated buffers for format conversion

### Implementation Plan

#### Pre-allocated Buffers

```rust
// Add to AudioRecorderWorker
struct AudioRecorderWorker {
    // ... existing fields ...
    
    // Pre-allocated buffers
    conversion_buffer: Vec<f32>,
    conversion_buffer_size: usize,
}

impl AudioRecorderWorker {
    fn ensure_conversion_buffer(&mut self, required_size: usize) {
        if self.conversion_buffer.len() < required_size {
            self.conversion_buffer.resize(required_size, 0.0);
            self.conversion_buffer_size = required_size;
        }
    }
    
    // In the audio callback
    fn process_audio_data<T>(&mut self, data: &[T]) where T: Sample {
        let mono_samples = if self.channels == 2 {
            // Reuse pre-allocated buffer
            self.ensure_conversion_buffer(data.len() / 2);
            
            for (i, chunk) in data.chunks(2).enumerate() {
                self.conversion_buffer[i] = (chunk[0].to_f32() + chunk[1].to_f32()) / 2.0;
            }
            
            &self.conversion_buffer[..data.len() / 2]
        } else {
            // No conversion needed
            data
        };
    }
}
```

#### Ring Buffer Optimization

```rust
// Use power-of-2 sizes for efficient modulo operations
const RING_BUFFER_SIZE: usize = 1 << 20; // 1MB chunks

impl RingBufferRecorder {
    pub fn new(spec: WavSpec, output_path: &Path) -> Result<Self, String> {
        // Pre-allocate with capacity
        let mut samples = VecDeque::with_capacity(RING_BUFFER_SIZE);
        
        // Use memory mapping for large files
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .open(output_path)?;
            
        // Pre-allocate file space
        file.set_len(300 * spec.sample_rate as u64 * 2)?; // 5 minutes
    }
}
```

#### Zero-Copy Audio Processing

```rust
// Implement zero-copy sample conversion using unsafe transmutation
// Only for known-safe conversions (e.g., i16 to f32 arrays)
unsafe fn convert_samples_zero_copy(input: &[i16]) -> &[f32] {
    // This is a simplified example - real implementation needs proper alignment checks
    std::slice::from_raw_parts(
        input.as_ptr() as *const f32,
        input.len() / 2
    )
}
```

---

## 3. Performance Optimizations (P1 - High)

### Lock-Free Audio Level Updates

```rust
use std::sync::atomic::{AtomicU32, Ordering};

struct AudioRecorderWorker {
    // Replace Mutex<f32> with atomic
    current_audio_level: Arc<AtomicU32>,
}

impl AudioRecorderWorker {
    fn update_audio_level(&self, level: f32) {
        // Convert f32 to u32 bits for atomic storage
        let bits = level.to_bits();
        self.current_audio_level.store(bits, Ordering::Relaxed);
    }
    
    fn get_audio_level(&self) -> f32 {
        let bits = self.current_audio_level.load(Ordering::Relaxed);
        f32::from_bits(bits)
    }
}
```

### SIMD Optimizations for RMS Calculation

```rust
#[cfg(target_arch = "x86_64")]
use std::arch::x86_64::*;

unsafe fn calculate_rms_simd(samples: &[f32]) -> f32 {
    let mut sum = _mm256_setzero_ps();
    
    // Process 8 samples at a time
    for chunk in samples.chunks_exact(8) {
        let vals = _mm256_loadu_ps(chunk.as_ptr());
        let squared = _mm256_mul_ps(vals, vals);
        sum = _mm256_add_ps(sum, squared);
    }
    
    // Sum all lanes
    let mut result = [0.0f32; 8];
    _mm256_storeu_ps(result.as_mut_ptr(), sum);
    let total: f32 = result.iter().sum();
    
    // Handle remaining samples
    let remainder_sum: f32 = samples[samples.len() & !7..]
        .iter()
        .map(|&x| x * x)
        .sum();
    
    ((total + remainder_sum) / samples.len() as f32).sqrt()
}
```

### Batch Processing for Sample Callbacks

```rust
impl RingBufferRecorder {
    // Process samples in larger batches to reduce callback overhead
    const BATCH_SIZE: usize = 4096;
    
    fn add_samples_batched(&self, new_samples: &[f32]) -> Result<(), String> {
        let mut samples = self.samples.lock()
            .map_err(|e| format!("Failed to lock samples: {}", e))?;
            
        // Process in batches
        for chunk in new_samples.chunks(Self::BATCH_SIZE) {
            samples.extend(chunk);
            
            // Batch notification instead of per-sample
            if samples.len() >= self.notify_threshold {
                self.notify_listeners();
            }
        }
        
        Ok(())
    }
}
```

---

## 4. Retry Mechanisms & Circuit Breakers (P1 - High)

### Circuit Breaker Implementation

```rust
use std::sync::atomic::{AtomicU32, AtomicI64, Ordering};
use std::time::{Duration, Instant};

#[derive(Clone)]
struct CircuitBreaker {
    failure_count: Arc<AtomicU32>,
    last_failure_time: Arc<AtomicI64>,
    state: Arc<Mutex<CircuitState>>,
    
    // Configuration
    failure_threshold: u32,
    recovery_timeout: Duration,
    half_open_max_calls: u32,
}

#[derive(Debug, Clone, Copy)]
enum CircuitState {
    Closed,
    Open,
    HalfOpen,
}

impl CircuitBreaker {
    fn new(failure_threshold: u32, recovery_timeout: Duration) -> Self {
        Self {
            failure_count: Arc::new(AtomicU32::new(0)),
            last_failure_time: Arc::new(AtomicI64::new(0)),
            state: Arc::new(Mutex::new(CircuitState::Closed)),
            failure_threshold,
            recovery_timeout,
            half_open_max_calls: 3,
        }
    }
    
    fn call<F, T, E>(&self, f: F) -> Result<T, E>
    where
        F: FnOnce() -> Result<T, E>,
        E: std::fmt::Display,
    {
        // Check current state
        let current_state = *self.state.lock().unwrap();
        
        match current_state {
            CircuitState::Open => {
                // Check if we should transition to half-open
                let last_failure = self.last_failure_time.load(Ordering::Relaxed);
                let elapsed = Instant::now().duration_since(
                    UNIX_EPOCH + Duration::from_secs(last_failure as u64)
                );
                
                if elapsed >= self.recovery_timeout {
                    *self.state.lock().unwrap() = CircuitState::HalfOpen;
                } else {
                    return Err("Circuit breaker is open".into());
                }
            }
            CircuitState::HalfOpen => {
                // Limited calls allowed
                // Implementation depends on specific use case
            }
            CircuitState::Closed => {
                // Normal operation
            }
        }
        
        // Execute the function
        match f() {
            Ok(result) => {
                self.on_success();
                Ok(result)
            }
            Err(e) => {
                self.on_failure();
                Err(e)
            }
        }
    }
    
    fn on_success(&self) {
        self.failure_count.store(0, Ordering::Relaxed);
        *self.state.lock().unwrap() = CircuitState::Closed;
    }
    
    fn on_failure(&self) {
        let failures = self.failure_count.fetch_add(1, Ordering::Relaxed) + 1;
        self.last_failure_time.store(
            Instant::now().duration_since(UNIX_EPOCH).as_secs() as i64,
            Ordering::Relaxed
        );
        
        if failures >= self.failure_threshold {
            *self.state.lock().unwrap() = CircuitState::Open;
        }
    }
}
```

### Retry with Exponential Backoff

```rust
async fn retry_with_backoff<F, T, E>(
    operation: F,
    max_retries: u32,
    initial_delay: Duration,
) -> Result<T, E>
where
    F: Fn() -> Result<T, E>,
    E: std::fmt::Display,
{
    let mut delay = initial_delay;
    
    for attempt in 0..max_retries {
        match operation() {
            Ok(result) => return Ok(result),
            Err(e) if attempt < max_retries - 1 => {
                warn(
                    Component::Transcription,
                    &format!("Attempt {} failed: {}. Retrying in {:?}", attempt + 1, e, delay)
                );
                
                tokio::time::sleep(delay).await;
                
                // Exponential backoff with jitter
                delay = delay.mul_f32(1.5 + rand::random::<f32>() * 0.5);
                delay = delay.min(Duration::from_secs(30)); // Cap at 30 seconds
            }
            Err(e) => return Err(e),
        }
    }
    
    unreachable!()
}
```

### Integration with Transcription Pipeline

```rust
impl TranscriptionPipeline {
    fn transcribe_with_resilience(&self, audio_path: &Path) -> Result<String, String> {
        let circuit_breaker = CircuitBreaker::new(3, Duration::from_secs(60));
        
        circuit_breaker.call(|| {
            retry_with_backoff(
                || self.transcribe_internal(audio_path),
                3,
                Duration::from_millis(100),
            )
        })
    }
}
```

---

## 5. Observability & Monitoring (P1 - High)

### Metrics System

```rust
use prometheus::{Counter, Histogram, Gauge, Registry};

lazy_static! {
    static ref METRICS_REGISTRY: Registry = Registry::new();
    
    // Audio metrics
    static ref AUDIO_RECORDING_DURATION: Histogram = Histogram::new(
        "scout_audio_recording_duration_seconds",
        "Duration of audio recordings"
    ).expect("metric creation");
    
    static ref AUDIO_BUFFER_OVERRUNS: Counter = Counter::new(
        "scout_audio_buffer_overruns_total",
        "Total number of audio buffer overruns"
    ).expect("metric creation");
    
    static ref AUDIO_LEVEL_CURRENT: Gauge = Gauge::new(
        "scout_audio_level_current",
        "Current audio input level (0-1)"
    ).expect("metric creation");
    
    // Transcription metrics
    static ref TRANSCRIPTION_DURATION: Histogram = Histogram::new(
        "scout_transcription_duration_seconds",
        "Time taken to transcribe audio"
    ).expect("metric creation");
    
    static ref TRANSCRIPTION_ERRORS: Counter = Counter::new(
        "scout_transcription_errors_total",
        "Total number of transcription errors"
    ).expect("metric creation");
    
    static ref TRANSCRIPTION_QUEUE_SIZE: Gauge = Gauge::new(
        "scout_transcription_queue_size",
        "Current size of transcription queue"
    ).expect("metric creation");
}

// Initialize metrics
pub fn init_metrics() {
    METRICS_REGISTRY.register(Box::new(AUDIO_RECORDING_DURATION.clone())).unwrap();
    METRICS_REGISTRY.register(Box::new(AUDIO_BUFFER_OVERRUNS.clone())).unwrap();
    METRICS_REGISTRY.register(Box::new(AUDIO_LEVEL_CURRENT.clone())).unwrap();
    METRICS_REGISTRY.register(Box::new(TRANSCRIPTION_DURATION.clone())).unwrap();
    METRICS_REGISTRY.register(Box::new(TRANSCRIPTION_ERRORS.clone())).unwrap();
    METRICS_REGISTRY.register(Box::new(TRANSCRIPTION_QUEUE_SIZE.clone())).unwrap();
}
```

### Structured Logging

```rust
use tracing::{info, warn, error, instrument};
use tracing_subscriber::fmt::format::FmtSpan;

// Initialize tracing
pub fn init_tracing() {
    let subscriber = tracing_subscriber::fmt()
        .with_env_filter("scout=debug,whisper_rs=info")
        .with_span_events(FmtSpan::ENTER | FmtSpan::EXIT)
        .with_target(false)
        .json()
        .init();
}

// Instrument critical functions
impl AudioRecorder {
    #[instrument(skip(self), fields(device_name = %device_name.as_deref().unwrap_or("default")))]
    pub async fn start_recording(
        &self,
        output_path: &Path,
        device_name: Option<String>
    ) -> Result<(), String> {
        info!("Starting audio recording");
        // ... existing implementation ...
    }
}
```

### Performance Tracking

```rust
// Add performance tracking to critical paths
impl TranscriptionStrategy for RingBufferStrategy {
    #[instrument(skip(self, transcriber))]
    async fn transcribe(&self, transcriber: Arc<WhisperTranscriber>) -> Result<TranscriptionResult, String> {
        let start = Instant::now();
        
        let result = self.transcribe_internal(transcriber).await;
        
        let duration = start.elapsed();
        TRANSCRIPTION_DURATION.observe(duration.as_secs_f64());
        
        info!(
            duration_ms = duration.as_millis(),
            success = result.is_ok(),
            "Transcription completed"
        );
        
        result
    }
}
```

---

## 6. Resource Constraints & Graceful Degradation (P2 - Medium)

### Memory Monitoring

```rust
use sysinfo::{System, SystemExt};

struct ResourceMonitor {
    system: System,
    memory_threshold: f32, // Percentage (0-100)
    cpu_threshold: f32,    // Percentage (0-100)
}

impl ResourceMonitor {
    fn new(memory_threshold: f32, cpu_threshold: f32) -> Self {
        Self {
            system: System::new_all(),
            memory_threshold,
            cpu_threshold,
        }
    }
    
    fn check_resources(&mut self) -> ResourceStatus {
        self.system.refresh_memory();
        self.system.refresh_cpu();
        
        let memory_usage = self.system.used_memory() as f32 / self.system.total_memory() as f32 * 100.0;
        let cpu_usage = self.system.global_cpu_info().cpu_usage();
        
        if memory_usage > self.memory_threshold || cpu_usage > self.cpu_threshold {
            ResourceStatus::Constrained {
                memory_usage,
                cpu_usage,
            }
        } else {
            ResourceStatus::Normal
        }
    }
}

enum ResourceStatus {
    Normal,
    Constrained { memory_usage: f32, cpu_usage: f32 },
}
```

### Adaptive Quality Settings

```rust
impl TranscriptionPipeline {
    fn select_strategy_adaptive(&self, duration: Duration, resources: ResourceStatus) -> Box<dyn TranscriptionStrategy> {
        match resources {
            ResourceStatus::Constrained { .. } => {
                // Use lighter models when constrained
                warn(Component::Transcription, "System resources constrained, using Tiny model only");
                Box::new(ClassicStrategy::new(WhisperModel::Tiny))
            }
            ResourceStatus::Normal => {
                // Normal strategy selection
                if duration > Duration::from_secs(30) {
                    Box::new(RingBufferStrategy::new())
                } else {
                    Box::new(ProgressiveStrategy::new())
                }
            }
        }
    }
}
```

### Automatic Buffer Size Adjustment

```rust
impl AudioRecorderWorker {
    fn select_buffer_size_adaptive(&self, device: &Device, resources: ResourceStatus) -> cpal::BufferSize {
        let base_sizes = match resources {
            ResourceStatus::Normal => vec![128, 256, 512, 1024],
            ResourceStatus::Constrained { .. } => vec![512, 1024, 2048], // Larger buffers when constrained
        };
        
        // Try each size and return the first that works
        for size in base_sizes {
            if self.test_buffer_size(device, size).is_ok() {
                return cpal::BufferSize::Fixed(size);
            }
        }
        
        cpal::BufferSize::Default
    }
}
```

---

## 7. Health Checks (P2 - Medium)

### Health Check System

```rust
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize)]
pub struct HealthStatus {
    pub status: HealthState,
    pub message: Option<String>,
    pub last_check: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub enum HealthState {
    Healthy,
    Degraded,
    Unhealthy,
}

#[async_trait]
pub trait HealthCheck: Send + Sync {
    async fn check(&self) -> HealthStatus;
    fn name(&self) -> &str;
}

pub struct HealthCheckRegistry {
    checks: HashMap<String, Box<dyn HealthCheck>>,
}

impl HealthCheckRegistry {
    pub async fn run_all(&self) -> HashMap<String, HealthStatus> {
        let mut results = HashMap::new();
        
        for (name, check) in &self.checks {
            results.insert(name.clone(), check.check().await);
        }
        
        results
    }
}
```

### Component Health Checks

```rust
// Audio device health check
struct AudioDeviceHealthCheck;

#[async_trait]
impl HealthCheck for AudioDeviceHealthCheck {
    async fn check(&self) -> HealthStatus {
        let host = cpal::default_host();
        
        match host.default_input_device() {
            Some(device) => {
                // Try to get device config
                match device.default_input_config() {
                    Ok(_) => HealthStatus {
                        status: HealthState::Healthy,
                        message: None,
                        last_check: Utc::now(),
                    },
                    Err(e) => HealthStatus {
                        status: HealthState::Unhealthy,
                        message: Some(format!("Cannot access device config: {}", e)),
                        last_check: Utc::now(),
                    },
                }
            }
            None => HealthStatus {
                status: HealthState::Unhealthy,
                message: Some("No input device available".to_string()),
                last_check: Utc::now(),
            },
        }
    }
    
    fn name(&self) -> &str {
        "audio_device"
    }
}

// Model file health check
struct ModelHealthCheck {
    model_path: PathBuf,
}

#[async_trait]
impl HealthCheck for ModelHealthCheck {
    async fn check(&self) -> HealthStatus {
        if !self.model_path.exists() {
            return HealthStatus {
                status: HealthState::Unhealthy,
                message: Some("Model file not found".to_string()),
                last_check: Utc::now(),
            };
        }
        
        // Check file size (Tiny model should be ~39MB)
        match std::fs::metadata(&self.model_path) {
            Ok(metadata) => {
                let size_mb = metadata.len() / 1_000_000;
                if size_mb < 10 {
                    HealthStatus {
                        status: HealthState::Unhealthy,
                        message: Some(format!("Model file too small: {}MB", size_mb)),
                        last_check: Utc::now(),
                    }
                } else {
                    HealthStatus {
                        status: HealthState::Healthy,
                        message: None,
                        last_check: Utc::now(),
                    }
                }
            }
            Err(e) => HealthStatus {
                status: HealthState::Unhealthy,
                message: Some(format!("Cannot read model file: {}", e)),
                last_check: Utc::now(),
            },
        }
    }
    
    fn name(&self) -> &str {
        "whisper_model"
    }
}
```

### Tauri Command Integration

```rust
#[tauri::command]
async fn health_check(state: State<'_, AppState>) -> Result<HashMap<String, HealthStatus>, String> {
    state.health_registry.run_all().await
}
```

---

## 8. Implementation Timeline

### Week 1: Critical Fixes
- [ ] Remove all unwrap() calls in audio callbacks
- [ ] Implement pre-allocated buffers
- [ ] Fix memory leaks in ring buffer
- [ ] Basic error recovery mechanisms

### Week 2: Performance & Reliability
- [ ] Implement circuit breakers
- [ ] Add retry mechanisms
- [ ] Lock-free audio level updates
- [ ] SIMD optimizations

### Week 3: Observability
- [ ] Implement metrics collection
- [ ] Add structured logging
- [ ] Create performance dashboards
- [ ] Set up alerts

### Week 4: Advanced Features
- [ ] Resource monitoring
- [ ] Graceful degradation
- [ ] Health check system
- [ ] Load testing & optimization

## Testing Strategy

### Unit Tests
```rust
#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_circuit_breaker_opens_after_threshold() {
        let cb = CircuitBreaker::new(3, Duration::from_secs(60));
        
        // Fail 3 times
        for _ in 0..3 {
            let _ = cb.call(|| Err::<(), &str>("test error"));
        }
        
        // Should be open now
        let result = cb.call(|| Ok::<(), &str>(()));
        assert!(result.is_err());
    }
    
    #[test]
    fn test_pre_allocated_buffer_reuse() {
        // Test that buffers are reused and not reallocated
        // Monitor allocations using a custom allocator
    }
}
```

### Integration Tests
```rust
#[tokio::test]
async fn test_transcription_under_memory_pressure() {
    // Allocate most available memory
    let _memory_hog = vec![0u8; 1_000_000_000]; // 1GB
    
    // Try transcription
    let pipeline = TranscriptionPipeline::new();
    let result = pipeline.transcribe("test.wav").await;
    
    // Should degrade gracefully, not panic
    assert!(result.is_ok() || matches!(result, Err(e) if e.contains("constrained")));
}
```

### Load Testing
```bash
# Create load testing script
#!/bin/bash

# Start Scout with monitoring
RUST_LOG=debug scout &
SCOUT_PID=$!

# Monitor resources
while true; do
    ps -p $SCOUT_PID -o %cpu,%mem,rss
    sleep 1
done &

# Generate load
for i in {1..100}; do
    # Trigger recording via Tauri command
    echo "Recording $i"
    # ... recording commands ...
done
```

## Success Criteria

1. **Zero panics** in production under any load
2. **Memory usage** stays under 215MB target
3. **Latency** remains under 300ms for transcription
4. **Recovery time** < 60 seconds from any failure
5. **Observability** - all critical paths instrumented
6. **Degradation** - graceful handling of resource constraints

## Conclusion

This plan provides a systematic approach to hardening Scout for production. The implementation should be done in phases, with continuous testing and monitoring at each stage. Priority should be given to P0 items that directly affect stability and reliability.
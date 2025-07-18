# Building Sub-300ms Transcription with Progressive Processing

*July 18, 2024*

We had two Whisper models with opposite tradeoffs:
- **Tiny (39MB)**: Near-instant transcription but loose accuracy, often missing words or getting creative
- **Medium (1.5GB)**: Excellent accuracy but 2-5 second processing time that scales with recording length

This post covers how we combined both models into a progressive transcription system that delivers instant feedback while refining accuracy in the background.

## Rethinking the Pipeline

### The Original Problem

Our transcription pipeline was simple and worked well:
1. User records audio
2. User stops recording  
3. Process entire audio with Medium model
4. Return transcript

The problem: Step 3 took 2-5 seconds of dead time.

### The Solution

We identified a key insight: **cognitive flow while speaking is different from cognitive state while waiting**.

- **While speaking**: You're in flow state, generating ideas
- **While waiting**: You're blocked, losing momentum

What if we could keep users in that flow state by showing text immediately?

### Core Principle

Perfect transcription can wait. Users need *good enough* transcription instantly that improves over time. Think progressive JPEG loading: show pixels immediately, refine quality progressively.

## Implementation: Dual-Model Architecture

### Architecture

Two-tier transcription system:

```
Tiny Model (39MB)
├── Purpose: Immediate feedback
├── Speed: 6-7x real-time  
├── Accuracy: 80-85%
└── Chunk size: 5 seconds

Medium Model (1.5GB)
├── Purpose: Quality refinement
├── Speed: 1.2-1.5x real-time
├── Accuracy: 95%+
└── Chunk size: 10 seconds (configurable)
```

### Cache Collision Bug

First implementation failed. Both models loaded but only one worked. Root cause:

```rust
// Our cache only stored ONE model!
static TRANSCRIBER_CACHE: Option<(PathBuf, Transcriber)>
```

Medium overwrote Tiny. Tiny overwrote Medium. Classic cache collision.

Fix: HashMap for multi-model support:

```rust
static TRANSCRIBER_CACHE: HashMap<PathBuf, Transcriber>
```

### Background Processing

Requirements:

1. Process Tiny chunks in real-time (every 5s)
2. Run Medium refinement in background (every 10s)  
3. Stop IMMEDIATELY when recording ends
4. Never make the user wait

Solution: Dedicated tokio task with immediate cancellation:

```rust
// When recording stops
if let Some(handle) = self.refinement_handle.take() {
    handle.abort(); // Cancel immediately!
}
```

### Parameter Optimization

Benchmark suite: 4 recordings (8s, 10s, 72s, 100s)
Tested chunk sizes: 5s, 10s, 15s, 20s
Result: **10 seconds optimal**

## Performance Results

### Latency Reduction
- **Before**: 2-5 seconds after recording stops
- **After**: <300ms after recording stops
- **Improvement**: 85-94% reduction in perceived latency

### Processing Timeline
- **0-5s**: Initial text (Tiny model)
- **10s**: First refinement (Medium model)
- **20s**: Second refinement  
- **Stop**: Immediate final output

### Benchmark Results

| Recording | Tiny Chunks | Refinements | Latency |
|-----------|-------------|-------------|---------|
| 8s | 1 | 0-1 | <300ms |
| 30s | 6 | 3 | <300ms |
| 100s | 20 | 10 | <300ms |

### Resource Usage

- **Before**: 100% CPU spike post-recording
- **After**: 40-60% CPU during recording, 0% post-recording  
- **Memory**: Consistent 215MB (both models loaded)

## Key Takeaways

1. **Challenge assumptions**: Default patterns aren't always optimal
2. **Prioritize perceived performance**: Immediate feedback beats delayed perfection
3. **Measure, don't guess**: Data-driven parameter tuning is essential
4. **Progressive enhancement works**: 85% accuracy now + refinement > 95% accuracy later

## User Impact

Progressive transcription eliminates the speak-wait-read cycle. Text appears as you speak, quality improves in the background. When you stop recording, your transcript is ready instantly. Zero spinner time.

## Implementation Status

Progressive transcription ships with Scout v0.2.0+. Zero-wait transcription is now the default.

[Get Scout](https://github.com/scout-app/scout/releases)

## Future Directions

Our current Tiny + Medium combination is just the beginning. Whisper's model spectrum offers many unexplored possibilities:

- **Base (74MB)**: Slightly larger than Tiny with better accuracy/speed ratio
- **Small (244MB)**: Strong middle ground, 3x larger but significantly more accurate
- **Medium.en (1.5GB)**: English-only variant with optimized performance
- **Large-v3 (3.1GB)**: State-of-the-art accuracy when latency isn't critical

We're exploring several optimization paths:
- Three-tier processing: Tiny → Base → Medium for balanced quality progression  
- Dynamic model selection based on recording length and available resources
- Specialized pipelines for different contexts (dictation vs. meetings vs. interviews)
- Mixed approaches: Tiny for live preview, Large for final transcript on demand

The progressive architecture makes experimenting with these combinations straightforward. Expect continued latency improvements as we find the optimal model mix for each scenario.

---

*Stack: Rust, Tauri, whisper.cpp with CoreML acceleration. 100% local processing.*

*Resources: [Architecture docs](https://github.com/scout-app/scout/tree/main/docs/progressive-transcription-architecture.md) | [Source](https://github.com/scout-app/scout)*
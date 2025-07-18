# Building Sub-300ms Transcription: The Journey to Progressive Processing

*July 18, 2024*

Sometimes the best features come from questioning fundamental assumptions. For Scout, that meant asking: "Why do users have to wait for transcription after they stop speaking?"

This is the story of how we rebuilt our transcription pipeline to deliver instant results while improving quality in the background.

## The Thought Process: Rethinking the Pipeline

### The Original Problem

Our transcription pipeline was simple and worked well:
1. User records audio
2. User stops recording  
3. Process entire audio with Medium model
4. Return transcript

The catch? Step 3 took 2-5 seconds. Users stared at a spinner, waiting.

### The Aha Moment

During a team discussion about cognitive modes, we realized something crucial: **the way people think while speaking is different from how they think while waiting**.

- **While speaking**: You're in flow state, generating ideas
- **While waiting**: You're blocked, losing momentum

What if we could keep users in that flow state by showing text immediately?

### The Key Insight

We don't need perfect transcription instantly - we need *good enough* transcription instantly that gets better over time. It's like progressive image loading on the web: show something immediately, refine it as you go.

## Implementation Strategy: Two Models, One Experience

### Phase 1: Architecture Design

We sketched out a two-tier system:

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

### Phase 2: The Cache Problem

Our first implementation attempt failed spectacularly. Both models would load, but only one would work. After debugging, we found the culprit:

```rust
// Our cache only stored ONE model!
static TRANSCRIBER_CACHE: Option<(PathBuf, Transcriber)>
```

When Medium loaded, it kicked out Tiny. When Tiny loaded, it kicked out Medium. 🤦

The fix was straightforward - support multiple models:

```rust
static TRANSCRIBER_CACHE: HashMap<PathBuf, Transcriber>
```

### Phase 3: Background Refinement

The trickiest part was managing background refinement without blocking. We needed to:

1. Process Tiny chunks in real-time (every 5s)
2. Run Medium refinement in background (every 10s)  
3. Stop IMMEDIATELY when recording ends
4. Never make the user wait

The solution was a separate tokio task with careful cancellation:

```rust
// When recording stops
if let Some(handle) = self.refinement_handle.take() {
    handle.abort(); // Cancel immediately!
}
```

### Phase 4: Finding the Sweet Spot

We created a benchmark suite with 4 test recordings (8s, 10s, 72s, 100s) and tested refinement chunks of 5, 10, 15, and 20 seconds.

The data was clear: **10 seconds is the sweet spot**.

## Results: The Numbers Don't Lie

### Latency Reduction
- **Before**: 2-5 seconds after recording stops
- **After**: <300ms after recording stops
- **Improvement**: 85-94% reduction in perceived latency

### Quality Timeline
- **0-5s**: First text appears (Tiny model)
- **10s**: First refinement (Medium model)
- **20s**: Second refinement
- **Stop**: Instant final transcript

### Real-World Performance

Testing on actual recordings showed:

| Recording Length | Tiny Chunks | Refinements | User Experience |
|-----------------|-------------|-------------|-----------------|
| 8 seconds | 1 | 0-1 | Text appears at 5s |
| 30 seconds | 6 | 3 | Continuous improvement |
| 100 seconds | 20 | 10 | Smooth, progressive quality |

### CPU Usage

The progressive approach actually REDUCES peak CPU usage by spreading the work:
- Old: 100% CPU spike after recording
- New: 40-60% CPU during recording, 0% after

## Lessons Learned

1. **Question Everything**: "That's how it's always been done" isn't a good reason
2. **User Psychology Matters**: Immediate feedback changes the entire experience
3. **Perfect is the Enemy of Good**: 85% accuracy NOW beats 95% accuracy in 5 seconds
4. **Measure Everything**: Our benchmark suite revealed the optimal parameters

## What This Means for Users

The progressive transcription strategy transforms dictation from a "speak-then-wait" experience to a real-time conversation with your computer. You see your words as you speak them, and they magically improve in quality while you continue talking.

When you stop, your transcript is ready. No spinners. No waiting. Just your words, ready to use.

## Try It Yourself

Scout's progressive transcription is available now. Experience the difference - because the best transcription is the one that doesn't make you wait.

[Download Scout →](https://github.com/scout-app/scout/releases)

---

*Technical details: Built with Rust, Tauri, and whisper.cpp. Runs 100% locally on your device. Your words never leave your computer.*

*Want to dig deeper? Check out our [technical documentation](https://github.com/scout-app/scout/tree/main/docs/progressive-transcription-architecture.md) or browse the [source code](https://github.com/scout-app/scout).*
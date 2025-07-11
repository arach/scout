# Dynamic Transcription Strategies & Progressive Refinement

This document explores advanced improvements to Scout's transcription system, focusing on dynamic strategy selection, adaptive chunk sizing, and progressive transcription refinement.

## Current State Analysis

### Performance Reality Check
With current performance showing **25-35x real-time speed** using the tiny.en model, we have significant headroom for optimization that wasn't available when the system was designed around 3x speed.

### Current Limitations
- **Fixed 5-second chunks** - Optimized for slower transcription speeds
- **Static strategy selection** - Ring buffer only activates after 5 seconds
- **One-size-fits-all approach** - Doesn't adapt to actual system performance
- **Single-pass transcription** - No opportunity for quality improvement

## Dynamic Strategy Selection

### Adaptive Chunk Sizing

**Current Approach:**
```rust
// Fixed chunk size regardless of performance
const CHUNK_DURATION: Duration = Duration::from_secs(5);
```

**Proposed Dynamic Approach:**
```rust
fn calculate_optimal_chunk_size(performance_data: &PerformanceHistory) -> Duration {
    let avg_speed = performance_data.average_transcription_speed();
    
    match avg_speed {
        speed if speed > 20.0 => Duration::from_secs(1),      // 1s chunks - very fast
        speed if speed > 10.0 => Duration::from_millis(1500), // 1.5s chunks - fast
        speed if speed > 5.0  => Duration::from_secs(2),      // 2s chunks - moderate  
        _                     => Duration::from_secs(5),      // 5s chunks - conservative
    }
}
```

### Early Ring Buffer Activation

**Current Logic:**
```rust
if recording_duration > 5s && chunking_enabled {
    use_ring_buffer_strategy();
} else {
    use_processing_queue_strategy();
}
```

**Proposed Performance-Based Logic:**
```rust
fn select_transcription_strategy(
    recording_duration: Duration,
    recent_performance: &PerformanceMetrics
) -> TranscriptionStrategy {
    let optimal_threshold = match recent_performance.average_speed() {
        speed if speed > 20.0 => Duration::from_secs(1),  // Very fast models
        speed if speed > 10.0 => Duration::from_secs(2),  // Fast models
        speed if speed > 5.0  => Duration::from_secs(3),  // Moderate models
        _                     => Duration::from_secs(5),  // Conservative fallback
    };
    
    if recording_duration > optimal_threshold {
        TranscriptionStrategy::RingBuffer { 
            chunk_size: calculate_optimal_chunk_size(recent_performance) 
        }
    } else {
        TranscriptionStrategy::ProcessingQueue
    }
}
```

### Benefits of Smaller Chunks

**1-Second Chunks Enable:**
- **Near real-time feedback** - Results appear every 1-2 seconds
- **Better short utterance handling** - "Yes", "No", "Thanks" get immediate transcription
- **Natural speech flow** - Words appear as users speak them
- **Improved responsiveness** - System feels more interactive and alive

**Trade-offs to Consider:**
- **Processing overhead** - More chunks = more parallel transcriptions
- **Speech boundary issues** - Risk of cutting words in half
- **Memory usage** - More concurrent transcription processes
- **Model warm-up costs** - Each chunk has initialization overhead

## Progressive Transcription Refinement

### Multi-Pass Architecture

**Concept:** Provide immediate feedback with fast transcription, then improve quality in the background using more sophisticated models.

```
Audio Input
    ↓
┌─────────────────┐     ┌──────────────────┐
│ Quick Pass      │────▶│ Show to User     │
│ (tiny.en ~50ms) │     │ (Immediate)      │
└─────────────────┘     └──────────────────┘
    ↓                            ↑
┌─────────────────┐     ┌──────────────────┐
│ Quality Pass    │────▶│ Smart Update     │
│ (medium.en      │     │ (If Improved)    │
│ ~500ms)         │     │                  │
└─────────────────┘     └──────────────────┘
```

### Progressive Transcriber Implementation

```rust
pub struct ProgressiveTranscriber {
    quick_model: Arc<Transcriber>,     // tiny.en for immediate results
    quality_model: Arc<Transcriber>,   // medium.en for accuracy
    diff_analyzer: TranscriptDiffer,   // Intelligent comparison
}

pub struct ProgressiveResult {
    pub immediate: TranscriptionResult,           // Show immediately
    pub refined: Pin<Box<dyn Future<Output = TranscriptionResult>>>, // Background task
}

impl ProgressiveTranscriber {
    pub async fn transcribe_progressive(&self, audio: &[f32]) -> Result<ProgressiveResult, String> {
        // Phase 1: Quick transcription (show immediately)
        let quick_result = self.quick_model.transcribe(audio).await?;
        
        // Phase 2: Quality transcription (background processing)
        let quality_future = {
            let model = self.quality_model.clone();
            let audio_clone = audio.to_vec();
            
            Box::pin(async move {
                model.transcribe(&audio_clone).await
            })
        };
        
        Ok(ProgressiveResult {
            immediate: quick_result,
            refined: quality_future,
        })
    }
}
```

### Intelligent Diff Analysis

**Purpose:** Determine when refined transcription actually improves the result.

```rust
pub struct TranscriptDiffer {
    similarity_threshold: f32,  // Minimum similarity to consider update
    confidence_threshold: f32,  // Minimum confidence improvement needed
}

pub struct DiffAnalysis {
    pub similarity_score: f32,        // How similar are the transcripts (0.0-1.0)
    pub improvements: Vec<Improvement>, // Specific improvements identified
    pub should_update: bool,          // Recommendation to update or not
    pub confidence_delta: f32,        // Change in transcription confidence
}

pub enum Improvement {
    WordCorrection { 
        from: String, 
        to: String, 
        confidence: f32,
        position: usize,
    },
    PunctuationFix { 
        position: usize, 
        change: String 
    },
    CapitalizationFix { 
        word_index: usize 
    },
    HallucinationRemoval { 
        removed_text: String,
        reason: String,
    },
    GrammarImprovement {
        from_phrase: String,
        to_phrase: String,
        improvement_type: String,
    },
}
```

### Smart Update Decision Logic

```rust
fn should_update_transcript(
    diff: &DiffAnalysis, 
    context: &UpdateContext
) -> UpdateDecision {
    // Never update if changes are too minimal
    if diff.similarity_score > 0.98 {
        return UpdateDecision::Skip("Minimal changes detected");
    }
    
    // Always update if hallucinations were removed
    if diff.improvements.iter().any(|i| matches!(i, Improvement::HallucinationRemoval(_))) {
        return UpdateDecision::Update("Hallucination removal");
    }
    
    // Always update for significant quality improvements
    if diff.confidence_delta > 0.20 && diff.similarity_score > 0.75 {
        return UpdateDecision::Update("Significant quality improvement");
    }
    
    // Don't update if user is actively interacting
    if context.user_is_typing() || context.time_since_user_action() < Duration::from_millis(500) {
        return UpdateDecision::Defer("User is active");
    }
    
    // Update for moderate improvements if transcript is stable
    if diff.confidence_delta > 0.10 && diff.similarity_score > 0.85 {
        return UpdateDecision::Update("Moderate improvement");
    }
    
    UpdateDecision::Skip("Insufficient improvement")
}

pub enum UpdateDecision {
    Update(&'static str),    // Update with reason
    Skip(&'static str),      // Don't update with reason
    Defer(&'static str),     // Try again later with reason
}
```

## User Experience Design

### Visual Feedback Patterns

**Phase 1 - Immediate Results:**
```
┌─────────────────────────────────────────┐
│ "hello world"                           │  ← Quick transcription (tiny.en)
│ ⏳ Refining...                          │  ← Subtle processing indicator
└─────────────────────────────────────────┘
```

**Phase 2 - Refined Results:**
```
┌─────────────────────────────────────────┐
│ "Hello, world."                         │  ← Improved punctuation/capitalization
│ ✨ Improved (2 edits)                   │  ← Brief improvement notification
└─────────────────────────────────────────┘
```

**Phase 3 - Stable State:**
```
┌─────────────────────────────────────────┐
│ "Hello, world."                         │  ← Final transcription
│                                         │  ← Clean, no indicators
└─────────────────────────────────────────┘
```

### Progressive Ring Buffer Processing

**Multi-chunk Progressive Refinement:**
```
Timeline: 0s ────── 1s ────── 2s ────── 3s

Chunk 1:  "hello"     →  "Hello"
          (quick)         (refined)

Chunk 2:            "world"   →  "world."
                    (quick)      (refined)

Chunk 3:                     "how are"  →  "How are"
                             (quick)        (refined)
```

### User Control Options

```json
{
  "progressive_transcription": {
    "enabled": true,
    "mode": "auto",  // "auto", "fast_only", "quality_only"
    "show_improvements": true,
    "auto_update_threshold": 0.15,
    "respect_user_activity": true,
    "max_refinement_delay_ms": 2000
  }
}
```

## Technical Implementation

### Performance Considerations

**Memory Usage:**
- Running two models simultaneously increases memory footprint
- Need to balance quick model simplicity vs. quality model sophistication
- Consider model unloading strategies for memory-constrained devices

**CPU Utilization:**
- Background quality processing should not impact quick result delivery
- Thread pool management for concurrent transcriptions
- Consider GPU utilization patterns for different models

**Latency Optimization:**
- Model warm-up time for quality transcription
- Async processing pipeline to prevent blocking
- Smart caching strategies for repeated audio patterns

### Model Selection Strategies

**Adaptive Model Pairing:**
```rust
pub struct ModelPair {
    quick: ModelConfig,
    quality: ModelConfig,
}

fn select_optimal_model_pair(system_specs: &SystemSpecs, user_prefs: &UserPreferences) -> ModelPair {
    match (system_specs.performance_tier(), user_prefs.priority()) {
        (PerformanceTier::High, Priority::Accuracy) => ModelPair {
            quick: ModelConfig::Base,      // Better baseline
            quality: ModelConfig::LargeV3, // Best available
        },
        (PerformanceTier::High, Priority::Speed) => ModelPair {
            quick: ModelConfig::Tiny,      // Fastest start
            quality: ModelConfig::Medium,  // Good improvement
        },
        (PerformanceTier::Medium, _) => ModelPair {
            quick: ModelConfig::Tiny,      // Conservative
            quality: ModelConfig::Base,    // Moderate improvement
        },
        (PerformanceTier::Low, _) => ModelPair {
            quick: ModelConfig::Tiny,      // Only option
            quality: ModelConfig::Tiny,    // Same model (no progression)
        },
    }
}
```

## Integration with Existing Architecture

### Ring Buffer Strategy Enhancement

```rust
pub struct ProgressiveRingBufferStrategy {
    buffer: Arc<RingBufferRecorder>,
    progressive_transcriber: ProgressiveTranscriber,
    chunk_size_calculator: AdaptiveChunkSizer,
    update_coordinator: TranscriptUpdateCoordinator,
}

impl TranscriptionStrategy for ProgressiveRingBufferStrategy {
    async fn process_chunk(&mut self, audio_chunk: &[f32]) -> Result<ChunkResult, String> {
        // Get immediate result
        let progressive_result = self.progressive_transcriber
            .transcribe_progressive(audio_chunk).await?;
        
        // Show quick result immediately
        let quick_result = ChunkResult {
            text: progressive_result.immediate.text,
            confidence: progressive_result.immediate.confidence,
            chunk_id: self.next_chunk_id(),
            is_provisional: true, // Mark as potentially improvable
        };
        
        // Schedule quality refinement
        self.update_coordinator.schedule_refinement(
            progressive_result.refined,
            quick_result.chunk_id,
        );
        
        Ok(quick_result)
    }
}
```

### Post-Processing Pipeline Integration

The progressive refinement system integrates cleanly with the existing post-processing pipeline:

```
Progressive Transcription → Post-Processing Hooks → Database Storage
      ↓                           ↓                       ↓
  Quick Result             Profanity Filter        Initial Save
      ↓                           ↓                       ↓
 Quality Result            Enhanced Filter         Update Save
      ↓                           ↓                       ↓
  Diff Analysis            Final Clipboard         Metrics Update
```

## Implementation Phases

### Phase 1: Foundation (Week 1-2)
- **Adaptive chunk sizing** based on recent performance metrics
- **Early ring buffer activation** (1-2 second thresholds)
- **Basic performance tracking** for dynamic decisions

### Phase 2: Progressive Pipeline (Week 3-4)
- **Dual-model transcription** infrastructure
- **Simple diff comparison** (word-level similarity)
- **Basic update logic** (update if significantly different)

### Phase 3: Intelligence (Week 5-6)
- **Advanced diff analysis** with improvement categorization
- **Smart update decisions** based on user activity and context
- **Visual feedback** for progressive improvements

### Phase 4: Optimization (Week 7-8)
- **Performance tuning** for memory and CPU usage
- **User preference integration** for progressive behavior
- **Analytics and monitoring** for real-world performance

## Success Metrics

### User Experience Metrics
- **Perceived latency** - Time to first transcription result
- **User satisfaction** - Preference surveys on progressive vs. single-pass
- **Edit frequency** - How often users manually correct transcriptions
- **Session engagement** - Longer dictation sessions due to responsiveness

### Technical Performance Metrics
- **Transcription accuracy delta** - Improvement from quick to quality pass
- **System resource usage** - Memory and CPU overhead
- **Update acceptance rate** - How often quality improvements are applied
- **Processing efficiency** - Throughput with progressive vs. single-pass

### Quality Metrics
- **Hallucination reduction** - Fewer AI artifacts in final transcriptions
- **Punctuation accuracy** - Improvement in proper punctuation
- **Capitalization correctness** - Better sentence and proper noun handling
- **Overall accuracy** - Word error rate improvements

---

*This progressive approach transforms Scout from a fast transcription tool into an intelligent, adaptive system that provides immediate feedback while continuously improving quality behind the scenes.*
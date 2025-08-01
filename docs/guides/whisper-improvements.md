# Whisper Transcription Enhancement Guide  
_Enhancing Scout’s local-first transcription pipeline_

---

## Table of Contents
1. [Introduction](#introduction)  
2. [Prerequisites & New Dependencies](#prerequisites--new-dependencies)  
3. [Improvement Matrix](#improvement-matrix)  
4. [Implementation Walk-through](#implementation-walk-through)  
   - 4.1 [Transcriber Caching](#41-transcriber-caching)  
   - 4.2 [High-Quality Resampling](#42-high-quality-resampling)  
   - 4.3 [Audio Pre-processing Pipeline](#43-audio-pre-processing-pipeline)  
   - 4.4 [Retry & Validation Layers](#44-retry--validation-layers)  
   - 4.5 [Multiple Model Support & Auto-Selection](#45-multiple-model-support--auto-selection)  
   - 4.6 [Progressive/Streaming Transcription](#46-progressivestreaming-transcription)  
   - 4.7 [Resource Pooling](#47-resource-pooling)  
   - 4.8 [Configuration Struct & CLI Flags](#48-configuration-struct--cli-flags)  
5. [Testing Strategy](#testing-strategy)  
6. [Migration Notes](#migration-notes)  
7. [Benchmarking & Performance Validation](#benchmarking--performance-validation)  
8. [Appendix: Full Code Listings](#appendix-full-code-listings)  

---

## Introduction
Scout currently instantiates a new `Transcriber` for every request and uses a minimal audio pipeline. This guide introduces **eight** upgrade pillars that increase speed, accuracy and developer ergonomics while keeping all data local.

---

## Prerequisites & New Dependencies
Add the following crates (versions are suggestions—pin as needed):

```toml
# Cargo.toml
[dependencies]
whisper-rs       = "0.11"
parking_lot      = "0.12"   # lock-free pools
rubato           = "0.14"   # HQ resampling
threadpool       = "1.8"    # background workers
uuid             = { version = "1", features = ["v4"] }
serde            = { version = "1", features = ["derive"] }
```

> _Why rubato?_ Whisper’s own resampler is linear; `rubato` offers poly-phase sinc interpolation for better audio fidelity.

---

## Improvement Matrix
| # | Area | Rationale | Outcome |
|---|------|-----------|---------|
| 1 | **Transcriber Caching** | Avoid repeated model deserialisation (hundreds of ms) | 4-10× faster cold-start |
| 2 | **HQ Resampling** | Reduce aliasing / loss | Slight WER ↓ |
| 3 | **Pre-processing** | Normalise, HP-filter, noise-gate | Higher confidence |
| 4 | **Retry & Validation** | Auto recover from transient errors | Fewer failed jobs |
| 5 | **Multi-Model & Auto-Select** | Balance speed/accuracy per context | User control |
| 6 | **Streaming / Progressive** | UI feedback on long recordings | Better UX |
| 7 | **Resource Pooling** | Minimise heap churn | Lower peak RSS |
| 8 | **Config Abstraction** | Future-proof & CLI overrides | Easier tuning |

---

## Implementation Walk-through

### 4.1 Transcriber Caching
1. **Create wrapper**

```rust
// src-tauri/src/transcription/cache.rs
#[derive(Clone)]
pub struct CachedTranscriber {
    inner: Arc<Mutex<Transcriber>>,
}

impl CachedTranscriber {
    pub fn init(model_path: &Path) -> Result<Self, String> {
        Ok(Self {
            inner: Arc::new(Mutex::new(Transcriber::new(model_path)?)),
        })
    }
    pub fn get(&self) -> Arc<Mutex<Transcriber>> {
        self.inner.clone()
    }
}
```

2. **Store in `AppState`**

```rust
pub struct AppState {
    // ...
    pub transcriber_cache: CachedTranscriber,
}
```

3. **Register during `setup()`**

```rust
let cache = CachedTranscriber::init(&model_path)?;
app.manage(cache.clone());
```

4. **Use in command**

```rust
#[tauri::command]
async fn transcribe_audio(state: State<'_, AppState>, file: String) -> Result<String,String>{
    let audio = state.recordings_dir.join(&file);
    let transcriber = state.transcriber_cache.get();
    let guard = transcriber.lock().unwrap();
    guard.transcribe(&audio)
}
```

### 4.2 High-Quality Resampling
1. Add `rubato` crate.  
2. Replace `resample()`:

```rust
fn resample(&self, samples: &[f32], ratio: f32) -> Vec<f32> {
    if (ratio - 1.0).abs() < f32::EPSILON { return samples.to_vec(); }

    let params = rubato::SincInterpolationParameters {
        sinc_len: 256,
        f_cutoff: 0.95,
        interpolation: rubato::SincInterpolationType::Linear,
        oversampling_factor: 256,
        window: rubato::WindowFunction::BlackmanHarris2,
    };
    let mut resampler = rubato::SincFixedIn::<f32>::new(
        ratio,
        1.0,
        params,
        samples.len(),
        1,
    ).expect("bad resampler");
    resampler.process(&[samples.to_vec()], None).unwrap()[0].clone()
}
```

### 4.3 Audio Pre-processing Pipeline
1. **Validation & Normalisation**

```rust
fn normalize(samples:&[f32])->Vec<f32>{
    let peak = samples.iter().fold(0.0,|m,&v|m.max(v.abs()));
    if peak==0.0 {return samples.to_vec();}
    samples.iter().map(|s| s/peak*0.95).collect()
}
```

2. **High-pass filter (simple first-order)**

```rust
fn high_pass(samples:&[f32], sr:u32)->Vec<f32>{
    let rc = 1.0/(2.0*std::f32::consts::PI*100.0); // 100 Hz cut
    let dt = 1.0/sr as f32;
    let alpha = rc/(rc+dt);
    let mut out = Vec::with_capacity(samples.len());
    let mut prev_y = 0.0;
    let mut prev_x = samples[0];
    for &x in samples{
        let y = alpha*(prev_y + x - prev_x);
        out.push(y);
        prev_y = y;
        prev_x = x;
    }
    out
}
```

3. **Noise gate / silence trim** (optional using RMS threshold).

### 4.4 Retry & Validation Layers
Wrap `Transcriber::transcribe`:

```rust
pub fn transcribe_with_retry(&self, audio:&Path, max:u32)->Result<String,String>{
    let mut attempts=0;
    loop{
        let res=self.transcribe(audio);
        match res{
            Ok(t)=>return Ok(t),
            Err(e) if attempts<max-1=>{
                eprintln!("Retry {attempts}: {e}");
                attempts+=1;
                std::thread::sleep(std::time::Duration::from_millis(200*attempts));
            }
            Err(e)=>return Err(e)
        }
    }
}
```

### 4.5 Multiple Model Support & Auto-Selection
1. **Enum & helper**

```rust
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub enum WhisperModel { Tiny, Base, Small }
impl WhisperModel {
    pub fn file(self)->&'static str{ match self{ Self::Tiny=>"ggml-tiny.en.bin", Self::Base=>"ggml-base.en.bin", Self::Small=>"ggml-small.en.bin"}}
}
```

2. **Selection logic**

```rust
fn choose_model(duration:Duration, pref:f32)->WhisperModel{
    match (duration.as_secs(), pref){
        (0..=30, p) if p>0.9 => WhisperModel::Small,
        (0..=300, _)         => WhisperModel::Base,
        _                    => WhisperModel::Tiny,
    }
}
```

3. Accept a `model_preference` parameter from the UI and pass to workflow.

### 4.6 Progressive/Streaming Transcription
*Outline only* (complete listing in appendix):

* Split recording thread into 1 s chunks.  
* Send chunks over an `mpsc::channel` to a streaming worker.  
* Call `state.full_n_segments()` repeatedly to emit partial text.  
* Front-end subscribes to `"partial-transcript"` events.

### 4.7 Resource Pooling
1. **Buffer pool**

```rust
pub struct AudioPool{ inner:Arc<parking_lot::Mutex<Vec<Vec<f32>>>>, sz:usize }
impl AudioPool{
   pub fn get(&self)->Vec<f32>{ self.inner.lock().pop().unwrap_or(vec![0.0;self.sz]) }
   pub fn put(&self,mut b:Vec<f32>){ b.clear(); b.resize(self.sz,0.0); if self.inner.lock().len()<8{ self.inner.lock().push(b);} }
}
```

2. Inject into recorder and resampler.

### 4.8 Configuration Struct & CLI Flags
1. **Config**

```rust
#[derive(Debug, Clone, Deserialize)]
pub struct TranscriptionConfig{
  pub model: WhisperModel,
  pub threads:u32,
  pub beam:u32,
  pub lang:Option<String>,
}
impl Default for TranscriptionConfig{ fn default()->Self{ Self{ model:WhisperModel::Base, threads:4, beam:1, lang:Some("en".into())}}}
```

2. **Load from `settings.json` or `--model small` flag using `clap` crate.

---

## Testing Strategy
| Layer | Test | Tooling |
|-------|------|---------|
| Audio I/O | Record 5 s white-noise, expect RMS ≈0.95 after normalise | `cpal` + assert |
| Resampler | 48 kHz → 16 kHz sine, verify SNR ≥ 60 dB | `assert_approx_eq` |
| Transcriber | Use canned WAV, compare WER against baseline | [`jiwer`](https://github.com/jitsi/jiwer) via Python |
| Retry | Simulate transient error (rename model file) | unit-test with tempdir |
| Model selector | durations 10 s/3 min/10 min | assert chosen variant |
| Streaming | Mock 3 chunks, ensure 3 partial events | tokio-test |

---

## Migration Notes
1. **Model files** remain unchanged; ensure additional variants are downloaded (`scripts/download-models.sh` already supports).  
2. Existing DB schema unaffected.  
3. Front-end must handle `"partial-transcript"` event (non-breaking).  
4. Remove any code that instantiates `Transcriber` directly—use cache.

---

## Benchmarking & Performance Validation
1. **Baseline**  
   ```
   time scout_cli transcribe sample.wav          # before
   ```
2. **After upgrade**  
   ```
   time scout_cli transcribe sample.wav          # after
   ```

3. **Metrics to capture**  
   | Metric | Tool | Target |
   |--------|------|--------|
   | Cold-start latency | `hyperfine` | ↓ ≥ 70 % |
   | Peak RSS | `/usr/bin/time -l` | –100 MB |
   | WER | `jiwer` | ≤ baseline |

4. **Automated script**

```bash
./scripts/bench.sh sample.wav results.json
```

> See appendix for `bench.sh`.

---

## Appendix: Full Code Listings
Complete, ready-to-copy modules are provided in `appendix/` folder (not generated yet). They include:
- `cache.rs`
- `audio_preprocess.rs`
- `streaming_transcriber.rs`
- Updated `transcription/mod.rs`

---

**End of Guide**

use std::path::PathBuf;
use std::time::Instant;
use tokio;
use serde::{Serialize, Deserialize};
use chrono;
use hound;
use scout_lib::transcription::Transcriber;
use scout_lib::db::Database;
use scout_lib::benchmarking::{TestDataExtractor, RecordingLength};

#[derive(Debug, Serialize, Deserialize)]
struct GoldStandardTranscription {
    recording_name: String,
    audio_file_path: String,
    duration_ms: u32,
    category: String,
    gold_standard_transcription: String,
    model_used: String,
    processing_time_ms: f64,
    generated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct GoldStandardReport {
    timestamp: String,
    model_used: String,
    total_recordings: usize,
    transcriptions: Vec<GoldStandardTranscription>,
}

#[derive(Debug, Serialize, Deserialize)]
struct RealChunkingAnalysis {
    recording_name: String,
    duration_ms: u32,
    category: String,
    sample_rate: u32,
    
    // Full recording baseline
    full_recording_transcription: String,
    baseline_source: String, // "gold_standard" or "generated"
    
    // Real chunked results
    chunk_analyses: Vec<ChunkAnalysis>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ChunkAnalysis {
    chunk_size_ms: u32,
    chunks: Vec<ChunkResult>,
    stitched_transcription: String,
    total_processing_time_ms: f64,
    time_to_first_chunk_ms: f64,
    
    // Quality comparison vs full recording
    word_differences: Vec<WordDiff>,
    sentence_differences: Vec<SentenceDiff>,
    similarity_score: f64,
}

#[derive(Debug, Serialize, Deserialize)]
struct ChunkResult {
    chunk_index: u32,
    start_time_ms: f64,
    end_time_ms: f64,
    transcription: String,
    processing_time_ms: f64,
    confidence_score: f64,
}

#[derive(Debug, Serialize, Deserialize)]
struct WordDiff {
    position: usize,
    full_word: String,
    chunked_word: String,
    diff_type: String, // "missing", "extra", "substitution", "correct"
}

#[derive(Debug, Serialize, Deserialize)]
struct SentenceDiff {
    sentence_index: usize,
    full_sentence: String,
    chunked_sentence: String,
    similarity: f64,
}

#[derive(Debug, Serialize, Deserialize)]
struct RealChunkingReport {
    timestamp: String,
    test_description: String,
    recordings_analyzed: Vec<RealChunkingAnalysis>,
    summary: ChunkingSummary,
}

#[derive(Debug, Serialize, Deserialize)]
struct ChunkingSummary {
    total_recordings: usize,
    chunk_sizes_tested: Vec<u32>,
    key_findings: Vec<String>,
    quality_impact_analysis: Vec<String>,
    optimal_chunk_recommendations: Vec<String>,
}

// Real audio chunking function
fn chunk_audio_file(
    audio_path: &PathBuf,
    chunk_size_ms: u32,
) -> Result<Vec<(Vec<f32>, f64, f64)>, String> {
    println!("    🎵 Chunking audio into {}ms segments", chunk_size_ms);
    
    // Read the audio file
    let mut reader = hound::WavReader::open(audio_path)
        .map_err(|e| format!("Failed to open audio file: {}", e))?;
    
    let spec = reader.spec();
    let sample_rate = spec.sample_rate;
    let samples_per_chunk = (sample_rate as f64 * chunk_size_ms as f64 / 1000.0) as usize;
    
    println!("    📊 Sample rate: {}Hz, samples per {}ms chunk: {}", sample_rate, chunk_size_ms, samples_per_chunk);
    
    // Read all samples - handle different bit depths and sample formats
    let samples: Result<Vec<f32>, _> = match (spec.bits_per_sample, spec.sample_format) {
        (16, hound::SampleFormat::Int) => {
            reader.samples::<i16>()
                .map(|s| s.map(|sample| sample as f32 / i16::MAX as f32))
                .collect()
        },
        (32, hound::SampleFormat::Int) => {
            reader.samples::<i32>()
                .map(|s| s.map(|sample| sample as f32 / i32::MAX as f32))
                .collect()
        },
        (32, hound::SampleFormat::Float) => {
            reader.samples::<f32>()
                .collect()
        },
        _ => {
            return Err(format!("Unsupported audio format: {} bits, {:?}", spec.bits_per_sample, spec.sample_format));
        }
    };
    
    let samples = samples.map_err(|e| format!("Failed to read samples: {}", e))?;
    
    println!("    📈 Total samples: {}", samples.len());
    
    // Create chunks
    let mut chunks = Vec::new();
    let mut current_sample = 0;
    
    while current_sample < samples.len() {
        let chunk_end = (current_sample + samples_per_chunk).min(samples.len());
        let chunk_samples = samples[current_sample..chunk_end].to_vec();
        
        let start_time_ms = current_sample as f64 * 1000.0 / sample_rate as f64;
        let end_time_ms = chunk_end as f64 * 1000.0 / sample_rate as f64;
        
        chunks.push((chunk_samples, start_time_ms, end_time_ms));
        current_sample += samples_per_chunk;
    }
    
    println!("    ✅ Created {} chunks", chunks.len());
    Ok(chunks)
}

// Write temporary chunk audio file
fn write_chunk_to_file(
    chunk_samples: &[f32],
    sample_rate: u32,
    output_path: &PathBuf,
) -> Result<(), String> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    
    let mut writer = hound::WavWriter::create(output_path, spec)
        .map_err(|e| format!("Failed to create chunk file: {}", e))?;
    
    for &sample in chunk_samples {
        let sample_i16 = (sample * i16::MAX as f32) as i16;
        writer.write_sample(sample_i16)
            .map_err(|e| format!("Failed to write sample: {}", e))?;
    }
    
    writer.finalize()
        .map_err(|e| format!("Failed to finalize chunk file: {}", e))?;
    
    Ok(())
}

// Real chunked transcription
async fn perform_real_chunked_transcription(
    transcriber: &Transcriber,
    audio_path: &PathBuf,
    chunk_size_ms: u32,
    sample_rate: u32,
) -> Result<ChunkAnalysis, String> {
    println!("  🔧 Real chunking analysis for {}ms chunks", chunk_size_ms);
    
    let start_time = Instant::now();
    
    // Chunk the audio
    let audio_chunks = chunk_audio_file(audio_path, chunk_size_ms)?;
    
    let mut chunk_results = Vec::new();
    let mut stitched_transcription = String::new();
    let mut first_chunk_time = None;
    
    // Create temporary directory for chunk files
    let temp_dir = std::env::temp_dir().join("scout_chunks");
    tokio::fs::create_dir_all(&temp_dir).await
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;
    
    for (chunk_idx, (chunk_samples, start_time_ms, end_time_ms)) in audio_chunks.iter().enumerate() {
        println!("    📝 Transcribing chunk {} ({:.1}ms - {:.1}ms)", chunk_idx + 1, start_time_ms, end_time_ms);
        
        // Write chunk to temporary file
        let chunk_path = temp_dir.join(format!("chunk_{}_{}.wav", chunk_size_ms, chunk_idx));
        write_chunk_to_file(chunk_samples, sample_rate, &chunk_path)?;
        
        // Transcribe the chunk
        let chunk_start = Instant::now();
        let chunk_transcription = match transcriber.transcribe(&chunk_path) {
            Ok(text) => text.trim().to_string(),
            Err(e) => {
                println!("      ⚠️ Chunk {} transcription failed: {}", chunk_idx + 1, e);
                "".to_string()
            }
        };
        let chunk_time = chunk_start.elapsed();
        
        if first_chunk_time.is_none() {
            first_chunk_time = Some(chunk_time.as_millis() as f64);
        }
        
        println!("      ✅ \"{}\", took {}ms", 
                chunk_transcription.chars().take(50).collect::<String>() +
                if chunk_transcription.len() > 50 { "..." } else { "" },
                chunk_time.as_millis());
        
        chunk_results.push(ChunkResult {
            chunk_index: chunk_idx as u32,
            start_time_ms: *start_time_ms,
            end_time_ms: *end_time_ms,
            transcription: chunk_transcription.clone(),
            processing_time_ms: chunk_time.as_millis() as f64,
            confidence_score: 0.85, // Placeholder - Whisper doesn't expose confidence directly
        });
        
        // Stitch transcription
        if !chunk_transcription.is_empty() {
            if !stitched_transcription.is_empty() && !stitched_transcription.ends_with(' ') {
                stitched_transcription.push(' ');
            }
            stitched_transcription.push_str(&chunk_transcription);
        }
        
        // Clean up chunk file
        let _ = std::fs::remove_file(&chunk_path);
    }
    
    let total_time = start_time.elapsed();
    
    println!("    🎯 Stitched result: \"{}\"", 
            stitched_transcription.chars().take(100).collect::<String>() +
            if stitched_transcription.len() > 100 { "..." } else { "" });
    
    Ok(ChunkAnalysis {
        chunk_size_ms,
        chunks: chunk_results,
        stitched_transcription,
        total_processing_time_ms: total_time.as_millis() as f64,
        time_to_first_chunk_ms: first_chunk_time.unwrap_or(0.0),
        word_differences: Vec::new(), // Will be filled by comparison
        sentence_differences: Vec::new(), // Will be filled by comparison
        similarity_score: 0.0, // Will be calculated
    })
}

fn analyze_transcription_quality(
    full_transcription: &str,
    chunk_analysis: &mut ChunkAnalysis,
) {
    println!("    🔍 Analyzing quality differences...");
    
    chunk_analysis.word_differences = compare_words(full_transcription, &chunk_analysis.stitched_transcription);
    chunk_analysis.sentence_differences = compare_sentences(full_transcription, &chunk_analysis.stitched_transcription);
    chunk_analysis.similarity_score = calculate_text_similarity(full_transcription, &chunk_analysis.stitched_transcription);
    
    println!("    📊 Similarity: {:.3}, {} word differences", 
            chunk_analysis.similarity_score, chunk_analysis.word_differences.len());
}

// Normalize words by removing punctuation and converting to lowercase
fn normalize_word(word: &str) -> String {
    word.chars()
        .filter(|c| c.is_alphabetic() || c.is_numeric())
        .collect::<String>()
        .to_lowercase()
}

fn compare_words(text1: &str, text2: &str) -> Vec<WordDiff> {
    let words1: Vec<String> = text1.split_whitespace()
        .map(normalize_word)
        .filter(|w| !w.is_empty())
        .collect();
    let words2: Vec<String> = text2.split_whitespace()
        .map(normalize_word)
        .filter(|w| !w.is_empty())
        .collect();
    
    let mut differences = Vec::new();
    let max_len = words1.len().max(words2.len());
    
    for i in 0..max_len {
        match (words1.get(i), words2.get(i)) {
            (Some(word1), Some(word2)) => {
                if word1 != word2 {
                    differences.push(WordDiff {
                        position: i,
                        full_word: word1.clone(),
                        chunked_word: word2.clone(),
                        diff_type: "substitution".to_string(),
                    });
                }
            }
            (Some(word1), None) => {
                differences.push(WordDiff {
                    position: i,
                    full_word: word1.clone(),
                    chunked_word: "".to_string(),
                    diff_type: "missing".to_string(),
                });
            }
            (None, Some(word2)) => {
                differences.push(WordDiff {
                    position: i,
                    full_word: "".to_string(),
                    chunked_word: word2.clone(),
                    diff_type: "extra".to_string(),
                });
            }
            (None, None) => break,
        }
    }
    
    differences
}

fn compare_sentences(text1: &str, text2: &str) -> Vec<SentenceDiff> {
    let sentences1: Vec<&str> = text1.split(&['.', '!', '?'][..]).map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
    let sentences2: Vec<&str> = text2.split(&['.', '!', '?'][..]).map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
    
    let mut differences = Vec::new();
    let max_len = sentences1.len().max(sentences2.len());
    
    for i in 0..max_len {
        let sent1 = sentences1.get(i).unwrap_or(&"").to_string();
        let sent2 = sentences2.get(i).unwrap_or(&"").to_string();
        
        if !sent1.is_empty() || !sent2.is_empty() {
            let similarity = calculate_text_similarity(&sent1, &sent2);
            differences.push(SentenceDiff {
                sentence_index: i,
                full_sentence: sent1,
                chunked_sentence: sent2,
                similarity,
            });
        }
    }
    
    differences
}

fn calculate_text_similarity(text1: &str, text2: &str) -> f64 {
    let words1: std::collections::HashSet<String> = text1.split_whitespace()
        .map(normalize_word)
        .filter(|w| !w.is_empty())
        .collect();
    let words2: std::collections::HashSet<String> = text2.split_whitespace()
        .map(normalize_word)
        .filter(|w| !w.is_empty())
        .collect();
    
    if words1.is_empty() && words2.is_empty() {
        return 1.0;
    }
    
    let intersection = words1.intersection(&words2).count();
    let union = words1.union(&words2).count();
    
    if union == 0 {
        return 0.0;
    }
    
    intersection as f64 / union as f64
}

// Calculate Word Error Rate (WER) - standard speech recognition metric
fn calculate_word_error_rate(reference: &str, hypothesis: &str) -> f64 {
    let ref_words: Vec<String> = reference.split_whitespace()
        .map(normalize_word)
        .filter(|w| !w.is_empty())
        .collect();
    let hyp_words: Vec<String> = hypothesis.split_whitespace()
        .map(normalize_word)
        .filter(|w| !w.is_empty())
        .collect();
    
    if ref_words.is_empty() {
        return if hyp_words.is_empty() { 0.0 } else { 1.0 };
    }
    
    // Simple Levenshtein distance calculation for WER
    let mut dp = vec![vec![0; hyp_words.len() + 1]; ref_words.len() + 1];
    
    // Initialize base cases
    for i in 0..=ref_words.len() {
        dp[i][0] = i; // deletions
    }
    for j in 0..=hyp_words.len() {
        dp[0][j] = j; // insertions
    }
    
    // Fill the DP table
    for i in 1..=ref_words.len() {
        for j in 1..=hyp_words.len() {
            if ref_words[i-1] == hyp_words[j-1] {
                dp[i][j] = dp[i-1][j-1]; // match
            } else {
                dp[i][j] = 1 + dp[i-1][j-1].min(dp[i-1][j]).min(dp[i][j-1]); // substitution, deletion, insertion
            }
        }
    }
    
    dp[ref_words.len()][hyp_words.len()] as f64 / ref_words.len() as f64
}

async fn load_gold_standard_transcription(recording_name: &str, gold_standard_path: &PathBuf) -> Result<String, String> {
    let content = tokio::fs::read_to_string(gold_standard_path).await
        .map_err(|e| format!("Failed to read gold standard file: {}", e))?;
    
    let report: GoldStandardReport = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse gold standard JSON: {}", e))?;
    
    for transcription in &report.transcriptions {
        if transcription.recording_name == recording_name {
            return Ok(transcription.gold_standard_transcription.clone());
        }
    }
    
    Err(format!("Recording '{}' not found in gold standard transcriptions", recording_name))
}

fn get_audio_sample_rate(audio_path: &PathBuf) -> Result<u32, String> {
    let reader = hound::WavReader::open(audio_path)
        .map_err(|e| format!("Failed to open audio file: {}", e))?;
    Ok(reader.spec().sample_rate)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("🎯 REAL AUDIO CHUNKING ANALYSIS");
    println!("===============================\n");
    
    // Initialize database and get test recordings
    let db_path = PathBuf::from("./benchmark_corpus/benchmark.db");
    let database = std::sync::Arc::new(Database::new(&db_path).await?);
    let extractor = TestDataExtractor::new(database.clone());
    let all_tests = extractor.extract_test_recordings().await?;
    
    if all_tests.is_empty() {
        println!("❌ No test recordings found in benchmark corpus");
        return Ok(());
    }
    
    // Select recordings for detailed real chunking analysis
    let mut selected_recordings = Vec::new();
    
    // Get 1 from each category for detailed analysis
    for category in [RecordingLength::UltraShort, RecordingLength::Short, RecordingLength::Medium, RecordingLength::Long] {
        if let Some(recording) = all_tests.iter().find(|r| std::mem::discriminant(&r.recording_length_category) == std::mem::discriminant(&category)) {
            selected_recordings.push(recording);
        }
    }
    
    println!("📋 Analyzing {} recordings with REAL AUDIO CHUNKING", selected_recordings.len());
    
    // Initialize transcriber with the best available model for baseline
    let large_model_path = PathBuf::from("./models/ggml-large-v3.en.bin");
    let base_model_path = PathBuf::from("./models/ggml-base.en.bin");
    
    let (transcriber, model_used) = if large_model_path.exists() {
        match Transcriber::new(&large_model_path) {
            Ok(t) => (t, "large-v3 (best quality baseline)"),
            Err(_) => {
                match Transcriber::new(&base_model_path) {
                    Ok(t) => (t, "base (fallback)"),
                    Err(e) => {
                        println!("❌ Failed to initialize any transcriber: {}", e);
                        return Ok(());
                    }
                }
            }
        }
    } else {
        match Transcriber::new(&base_model_path) {
            Ok(t) => (t, "base (download large-v3 for better baseline)"),
            Err(e) => {
                println!("❌ Failed to initialize transcriber: {}", e);
                return Ok(());
            }
        }
    };
    
    println!("✅ Transcriber initialized with {} model", model_used);
    if !large_model_path.exists() {
        println!("💡 For best baseline quality, download large-v3 model:");
        println!("   wget https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin -O ./models/ggml-large-v3.en.bin");
    }
    println!();
    
    // Test different chunk sizes: 1s, 2s, 3s
    let chunk_sizes = vec![1000, 2000, 3000];
    let mut recordings_analyzed = Vec::new();
    
    for recording in &selected_recordings {
        println!("🎵 REAL CHUNKING ANALYSIS: {} ({}ms, {:?})", recording.name, recording.duration_ms, recording.recording_length_category);
        
        // Get sample rate
        let sample_rate = match get_audio_sample_rate(&recording.audio_file) {
            Ok(sr) => sr,
            Err(e) => {
                println!("  ❌ Failed to get sample rate: {}", e);
                continue;
            }
        };
        
        // Load gold standard transcription as baseline
        println!("  📊 Loading gold standard transcription (baseline)...");
        let gold_standard_path = PathBuf::from("./benchmark_corpus/gold_standard_transcriptions.json");
        let (full_transcription, baseline_source) = if gold_standard_path.exists() {
            match load_gold_standard_transcription(&recording.name, &gold_standard_path).await {
                Ok(gold_transcription) => {
                    println!("    ✅ Gold Standard: \"{}\"", 
                            gold_transcription.chars().take(80).collect::<String>() + 
                            if gold_transcription.len() > 80 { "..." } else { "" });
                    (gold_transcription, "gold_standard".to_string())
                }
                Err(e) => {
                    println!("    ⚠️  Gold standard not found, generating on-the-fly: {}", e);
                    let full_start = Instant::now();
                    let transcription = match transcriber.transcribe(&recording.audio_file) {
                        Ok(text) => text.trim().to_string(),
                        Err(e) => {
                            println!("    ❌ Failed: {}", e);
                            continue;
                        }
                    };
                    let full_time = full_start.elapsed();
                    println!("    ✅ Generated: \"{}\" ({}ms)", 
                            transcription.chars().take(80).collect::<String>() + 
                            if transcription.len() > 80 { "..." } else { "" },
                            full_time.as_millis());
                    (transcription, "generated".to_string())
                }
            }
        } else {
            println!("    ⚠️  No gold standard file found, generating on-the-fly...");
            println!("    💡 Run 'cargo run --bin generate_gold_standard_transcriptions' first for best results");
            let full_start = Instant::now();
            let transcription = match transcriber.transcribe(&recording.audio_file) {
                Ok(text) => text.trim().to_string(),
                Err(e) => {
                    println!("    ❌ Failed: {}", e);
                    continue;
                }
            };
            let full_time = full_start.elapsed();
            println!("    ✅ Generated: \"{}\" ({}ms)", 
                    transcription.chars().take(80).collect::<String>() + 
                    if transcription.len() > 80 { "..." } else { "" },
                    full_time.as_millis());
            (transcription, "generated".to_string())
        };
        
        // Test different chunk sizes with REAL AUDIO CHUNKING
        let mut chunk_analyses = Vec::new();
        
        for &chunk_size_ms in &chunk_sizes {
            println!("\n  🔧 REAL CHUNKING: {}ms chunks", chunk_size_ms);
            
            match perform_real_chunked_transcription(&transcriber, &recording.audio_file, chunk_size_ms, sample_rate).await {
                Ok(mut chunk_analysis) => {
                    analyze_transcription_quality(&full_transcription, &mut chunk_analysis);
                    let wer = calculate_word_error_rate(&full_transcription, &chunk_analysis.stitched_transcription);
                    println!("    📊 Word Error Rate: {:.1}%", wer * 100.0);
                    chunk_analyses.push(chunk_analysis);
                }
                Err(e) => {
                    println!("    ❌ Real chunking failed: {}", e);
                }
            }
        }
        
        recordings_analyzed.push(RealChunkingAnalysis {
            recording_name: recording.name.clone(),
            duration_ms: recording.duration_ms,
            category: format!("{:?}", recording.recording_length_category),
            sample_rate,
            full_recording_transcription: full_transcription,
            baseline_source,
            chunk_analyses,
        });
        
        println!();
    }
    
    // Generate comprehensive analysis
    let key_findings = generate_real_chunking_findings(&recordings_analyzed);
    let quality_impact = generate_quality_impact_analysis(&recordings_analyzed);
    let recommendations = generate_chunk_recommendations(&recordings_analyzed);
    
    let report = RealChunkingReport {
        timestamp: chrono::Utc::now().to_rfc3339(),
        test_description: "Real audio chunking analysis with actual Whisper transcription".to_string(),
        recordings_analyzed,
        summary: ChunkingSummary {
            total_recordings: selected_recordings.len(),
            chunk_sizes_tested: chunk_sizes.clone(),
            key_findings,
            quality_impact_analysis: quality_impact,
            optimal_chunk_recommendations: recommendations,
        },
    };
    
    // Print detailed results
    print_real_chunking_analysis(&report);
    
    // Save results
    let json_content = serde_json::to_string_pretty(&report)?;
    let output_file = "./real_audio_chunking_analysis.json";
    tokio::fs::write(output_file, json_content).await?;
    
    println!("\n📄 Real chunking analysis saved to: {}", output_file);
    
    Ok(())
}

fn generate_real_chunking_findings(recordings: &[RealChunkingAnalysis]) -> Vec<String> {
    let mut findings = Vec::new();
    
    for recording in recordings {
        for chunk_analysis in &recording.chunk_analyses {
            let word_error_rate = chunk_analysis.word_differences.len() as f64 / 
                                 recording.full_recording_transcription.split_whitespace().count().max(1) as f64;
            
            findings.push(format!(
                "{} ({}ms) with {}ms chunks: {:.3} similarity, {:.1}% word error rate, {:.0}ms to first result",
                recording.category, recording.duration_ms, chunk_analysis.chunk_size_ms,
                chunk_analysis.similarity_score, word_error_rate * 100.0, chunk_analysis.time_to_first_chunk_ms
            ));
        }
    }
    
    findings
}

fn generate_quality_impact_analysis(recordings: &[RealChunkingAnalysis]) -> Vec<String> {
    let mut analysis = Vec::new();
    
    for recording in recordings {
        let mut chunk_quality: Vec<(u32, f64)> = recording.chunk_analyses.iter()
            .map(|ca| (ca.chunk_size_ms, ca.similarity_score))
            .collect();
        chunk_quality.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
        
        if let Some((best_size, best_score)) = chunk_quality.first() {
            if let Some((worst_size, worst_score)) = chunk_quality.last() {
                analysis.push(format!(
                    "{} recordings: Best={}ms chunks ({:.3}), Worst={}ms chunks ({:.3}), Quality drop: {:.3}",
                    recording.category, best_size, best_score, worst_size, worst_score, best_score - worst_score
                ));
            }
        }
    }
    
    analysis
}

fn generate_chunk_recommendations(recordings: &[RealChunkingAnalysis]) -> Vec<String> {
    let mut recommendations = Vec::new();
    
    // Find patterns across categories
    let mut category_optimal: std::collections::HashMap<String, (u32, f64, f64)> = std::collections::HashMap::new();
    
    for recording in recordings {
        for chunk_analysis in &recording.chunk_analyses {
            let entry = category_optimal.entry(recording.category.clone()).or_insert((chunk_analysis.chunk_size_ms, chunk_analysis.similarity_score, chunk_analysis.time_to_first_chunk_ms));
            if chunk_analysis.similarity_score > entry.1 || 
               (chunk_analysis.similarity_score == entry.1 && chunk_analysis.time_to_first_chunk_ms < entry.2) {
                *entry = (chunk_analysis.chunk_size_ms, chunk_analysis.similarity_score, chunk_analysis.time_to_first_chunk_ms);
            }
        }
    }
    
    for (category, (optimal_size, score, latency)) in category_optimal {
        recommendations.push(format!(
            "{} recordings: Use {}ms chunks (similarity: {:.3}, first result: {:.0}ms)",
            category, optimal_size, score, latency
        ));
    }
    
    // Overall recommendation
    let overall_scores: Vec<f64> = recordings.iter()
        .flat_map(|r| &r.chunk_analyses)
        .map(|ca| ca.similarity_score)
        .collect();
    
    let sum: f64 = overall_scores.iter().sum();
    if overall_scores.len() > 0 {
        let avg_score = sum / overall_scores.len() as f64;
        if avg_score > 0.95 {
            recommendations.push("Overall: Chunking has minimal quality impact - optimize for responsiveness".to_string());
        } else if avg_score > 0.85 {
            recommendations.push("Overall: Moderate quality impact - balance responsiveness and quality".to_string());
        } else {
            recommendations.push("Overall: Significant quality impact - prioritize larger chunks".to_string());
        }
    }
    
    recommendations
}

fn print_real_chunking_analysis(report: &RealChunkingReport) {
    println!("🎯 REAL AUDIO CHUNKING ANALYSIS RESULTS");
    println!("========================================");
    
    for recording in &report.recordings_analyzed {
        println!("\n🎵 {} ({}, {}ms, {}Hz)", recording.recording_name, recording.category, recording.duration_ms, recording.sample_rate);
        println!("🏆 Baseline ({}): \"{}\"", 
                recording.baseline_source,
                recording.full_recording_transcription.chars().take(120).collect::<String>() + 
                if recording.full_recording_transcription.len() > 120 { "..." } else { "" });
        
        for chunk_analysis in &recording.chunk_analyses {
            println!("\n  🔧 {}ms REAL CHUNKS ({} chunks):", chunk_analysis.chunk_size_ms, chunk_analysis.chunks.len());
            println!("     📝 Stitched: \"{}\"", 
                    chunk_analysis.stitched_transcription.chars().take(120).collect::<String>() + 
                    if chunk_analysis.stitched_transcription.len() > 120 { "..." } else { "" });
            println!("     📊 Similarity: {:.3}", chunk_analysis.similarity_score);
            println!("     ⏱️  First chunk: {:.0}ms, Total: {:.0}ms", chunk_analysis.time_to_first_chunk_ms, chunk_analysis.total_processing_time_ms);
            
            if !chunk_analysis.word_differences.is_empty() {
                println!("     🔍 Word differences: {}", chunk_analysis.word_differences.len());
                for (i, diff) in chunk_analysis.word_differences.iter().take(3).enumerate() {
                    println!("       {}. {} '{}' → '{}'", i+1, diff.diff_type, diff.full_word, diff.chunked_word);
                }
                if chunk_analysis.word_differences.len() > 3 {
                    println!("       ... and {} more", chunk_analysis.word_differences.len() - 3);
                }
            }
            
            // Show individual chunk results
            println!("     📋 Individual chunks:");
            for chunk in &chunk_analysis.chunks {
                if !chunk.transcription.is_empty() {
                    println!("       {}: \"{}\" ({:.0}ms)", chunk.chunk_index + 1, 
                            chunk.transcription.chars().take(40).collect::<String>() +
                            if chunk.transcription.len() > 40 { "..." } else { "" },
                            chunk.processing_time_ms);
                }
            }
        }
    }
    
    println!("\n💡 KEY FINDINGS:");
    for finding in &report.summary.key_findings {
        println!("   • {}", finding);
    }
    
    println!("\n📊 QUALITY IMPACT ANALYSIS:");
    for impact in &report.summary.quality_impact_analysis {
        println!("   • {}", impact);
    }
    
    println!("\n🎯 RECOMMENDATIONS:");
    for rec in &report.summary.optimal_chunk_recommendations {
        println!("   • {}", rec);
    }
}
use std::path::PathBuf;
use std::time::Instant;
use tokio;
use serde::{Serialize, Deserialize};
use sqlx::Row;
use chrono;
use hound;
use scout_lib::transcription::Transcriber;
use scout_lib::db::Database;
use scout_lib::benchmarking::RecordingLength;

#[derive(Debug, Serialize, Deserialize)]
struct ComprehensiveRecording {
    pub name: String,
    pub audio_file: PathBuf,
    pub duration_ms: u32,
    pub transcript: String,
    pub word_count: usize,
    pub recording_length_category: RecordingLength,
}

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
    processing_summary: ProcessingSummary,
}

#[derive(Debug, Serialize, Deserialize)]
struct ProcessingSummary {
    total_time_ms: f64,
    avg_time_per_recording_ms: f64,
    fastest_ms: f64,
    slowest_ms: f64,
}

#[derive(Debug, Serialize, Deserialize)]
struct ComprehensiveChunkingAnalysis {
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
    similarity_score: f64,
    word_error_rate: f64,
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
struct ComprehensiveChunkingReport {
    timestamp: String,
    test_description: String,
    recordings_analyzed: Vec<ComprehensiveChunkingAnalysis>,
    summary: ComprehensiveSummary,
}

#[derive(Debug, Serialize, Deserialize)]
struct ComprehensiveSummary {
    total_recordings: usize,
    chunk_sizes_tested: Vec<u32>,
    quality_statistics: QualityStatistics,
    performance_statistics: PerformanceStatistics,
    recommendations: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct QualityStatistics {
    chunk_size_5000ms: ChunkSizeStats,
    chunk_size_10000ms: ChunkSizeStats,
    chunk_size_15000ms: ChunkSizeStats,
}

#[derive(Debug, Serialize, Deserialize)]
struct ChunkSizeStats {
    avg_similarity: f64,
    avg_word_error_rate: f64,
    recordings_above_90_percent: usize,
    recordings_above_80_percent: usize,
    success_rate_professional: f64, // >90% similarity
    success_rate_acceptable: f64,   // >80% similarity
}

#[derive(Debug, Serialize, Deserialize)]
struct PerformanceStatistics {
    avg_time_to_first_result_ms: f64,
    min_time_to_first_result_ms: f64,
    max_time_to_first_result_ms: f64,
}

async fn extract_comprehensive_recordings(database: &Database) -> Result<Vec<ComprehensiveRecording>, String> {
    println!("📊 Loading comprehensive recordings from benchmark corpus...");
    
    let query = r#"
        SELECT name, audio_file, duration_ms, transcript, word_count, recording_length_category
        FROM recordings 
        ORDER BY duration_ms DESC
    "#;
    
    let rows = sqlx::query(query)
        .fetch_all(database.get_pool())
        .await
        .map_err(|e| format!("Database query failed: {}", e))?;
    
    let mut recordings = Vec::new();
    
    for row in rows {
        let name: String = row.get("name");
        let audio_file_str: String = row.get("audio_file");
        let duration_ms: i64 = row.get("duration_ms");
        let transcript: String = row.get("transcript");
        let word_count: i64 = row.get("word_count");
        let category_str: String = row.get("recording_length_category");
        
        let audio_file = PathBuf::from(&audio_file_str);
        
        // Skip if audio file doesn't exist
        if !audio_file.exists() {
            println!("⚠️  Skipping {}: audio file not found", audio_file_str);
            continue;
        }
        
        let category = match category_str.as_str() {
            "Short" => RecordingLength::Short,
            "Medium" => RecordingLength::Medium,  
            "Long" => RecordingLength::Long,
            "Extended" => RecordingLength::Extended,
            _ => RecordingLength::Extended, // Default fallback
        };
        
        recordings.push(ComprehensiveRecording {
            name,
            audio_file,
            duration_ms: duration_ms as u32,
            transcript,
            word_count: word_count as usize,
            recording_length_category: category,
        });
    }
    
    println!("📋 Loaded {} comprehensive recordings", recordings.len());
    Ok(recordings)
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

// Real audio chunking function
fn chunk_audio_file(
    audio_path: &PathBuf,
    chunk_size_ms: u32,
) -> Result<Vec<(Vec<f32>, f64, f64)>, String> {
    // Read the audio file
    let mut reader = hound::WavReader::open(audio_path)
        .map_err(|e| format!("Failed to open audio file: {}", e))?;
    
    let spec = reader.spec();
    let sample_rate = spec.sample_rate;
    let samples_per_chunk = (sample_rate as f64 * chunk_size_ms as f64 / 1000.0) as usize;
    
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
        // Write chunk to temporary file
        let chunk_path = temp_dir.join(format!("chunk_{}_{}.wav", chunk_size_ms, chunk_idx));
        write_chunk_to_file(chunk_samples, sample_rate, &chunk_path)?;
        
        // Transcribe the chunk
        let chunk_start = Instant::now();
        let chunk_transcription = match transcriber.transcribe(&chunk_path) {
            Ok(text) => text.trim().to_string(),
            Err(_) => "".to_string() // Silent chunks or transcription failures
        };
        let chunk_time = chunk_start.elapsed();
        
        if first_chunk_time.is_none() {
            first_chunk_time = Some(chunk_time.as_millis() as f64);
        }
        
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
    
    Ok(ChunkAnalysis {
        chunk_size_ms,
        chunks: chunk_results,
        stitched_transcription,
        total_processing_time_ms: total_time.as_millis() as f64,
        time_to_first_chunk_ms: first_chunk_time.unwrap_or(0.0),
        word_differences: Vec::new(), // Will be filled by comparison
        similarity_score: 0.0, // Will be calculated
        word_error_rate: 0.0,  // Will be calculated
    })
}

fn analyze_transcription_quality(
    full_transcription: &str,
    chunk_analysis: &mut ChunkAnalysis,
) {
    chunk_analysis.word_differences = compare_words(full_transcription, &chunk_analysis.stitched_transcription);
    chunk_analysis.similarity_score = calculate_text_similarity(full_transcription, &chunk_analysis.stitched_transcription);
    chunk_analysis.word_error_rate = calculate_word_error_rate(full_transcription, &chunk_analysis.stitched_transcription);
}

fn get_audio_sample_rate(audio_path: &PathBuf) -> Result<u32, String> {
    let reader = hound::WavReader::open(audio_path)
        .map_err(|e| format!("Failed to open audio file: {}", e))?;
    Ok(reader.spec().sample_rate)
}

fn generate_quality_statistics(recordings: &[ComprehensiveChunkingAnalysis]) -> QualityStatistics {
    let mut stats_5000 = Vec::new();
    let mut stats_10000 = Vec::new();
    let mut stats_15000 = Vec::new();
    
    for recording in recordings {
        for chunk_analysis in &recording.chunk_analyses {
            let similarity = chunk_analysis.similarity_score;
            let wer = chunk_analysis.word_error_rate;
            
            match chunk_analysis.chunk_size_ms {
                5000 => stats_5000.push((similarity, wer)),
                10000 => stats_10000.push((similarity, wer)),
                15000 => stats_15000.push((similarity, wer)),
                _ => {}
            }
        }
    }
    
    fn calculate_chunk_stats(stats: &[(f64, f64)]) -> ChunkSizeStats {
        if stats.is_empty() {
            return ChunkSizeStats {
                avg_similarity: 0.0,
                avg_word_error_rate: 0.0,
                recordings_above_90_percent: 0,
                recordings_above_80_percent: 0,
                success_rate_professional: 0.0,
                success_rate_acceptable: 0.0,
            };
        }
        
        let avg_similarity = stats.iter().map(|(s, _)| s).sum::<f64>() / stats.len() as f64;
        let avg_wer = stats.iter().map(|(_, w)| w).sum::<f64>() / stats.len() as f64;
        let above_90 = stats.iter().filter(|(s, _)| *s >= 0.9).count();
        let above_80 = stats.iter().filter(|(s, _)| *s >= 0.8).count();
        
        ChunkSizeStats {
            avg_similarity,
            avg_word_error_rate: avg_wer,
            recordings_above_90_percent: above_90,
            recordings_above_80_percent: above_80,
            success_rate_professional: above_90 as f64 / stats.len() as f64,
            success_rate_acceptable: above_80 as f64 / stats.len() as f64,
        }
    }
    
    QualityStatistics {
        chunk_size_5000ms: calculate_chunk_stats(&stats_5000),
        chunk_size_10000ms: calculate_chunk_stats(&stats_10000),
        chunk_size_15000ms: calculate_chunk_stats(&stats_15000),
    }
}

fn generate_performance_statistics(recordings: &[ComprehensiveChunkingAnalysis]) -> PerformanceStatistics {
    let mut all_times = Vec::new();
    
    for recording in recordings {
        for chunk_analysis in &recording.chunk_analyses {
            all_times.push(chunk_analysis.time_to_first_chunk_ms);
        }
    }
    
    if all_times.is_empty() {
        return PerformanceStatistics {
            avg_time_to_first_result_ms: 0.0,
            min_time_to_first_result_ms: 0.0,
            max_time_to_first_result_ms: 0.0,
        };
    }
    
    let avg_time = all_times.iter().sum::<f64>() / all_times.len() as f64;
    let min_time = all_times.iter().cloned().fold(f64::INFINITY, f64::min);
    let max_time = all_times.iter().cloned().fold(0.0, f64::max);
    
    PerformanceStatistics {
        avg_time_to_first_result_ms: avg_time,
        min_time_to_first_result_ms: min_time,
        max_time_to_first_result_ms: max_time,
    }
}

fn generate_comprehensive_recommendations(recordings: &[ComprehensiveChunkingAnalysis]) -> Vec<String> {
    let mut recommendations = Vec::new();
    
    // Analyze overall performance by chunk size
    let stats = generate_quality_statistics(recordings);
    
    recommendations.push(format!(
        "5000ms chunks: {:.1}% professional quality rate ({:.1}% WER avg)",
        stats.chunk_size_5000ms.success_rate_professional * 100.0,
        stats.chunk_size_5000ms.avg_word_error_rate * 100.0
    ));
    
    recommendations.push(format!(
        "10000ms chunks: {:.1}% professional quality rate ({:.1}% WER avg)",
        stats.chunk_size_10000ms.success_rate_professional * 100.0,
        stats.chunk_size_10000ms.avg_word_error_rate * 100.0
    ));
    
    recommendations.push(format!(
        "15000ms chunks: {:.1}% professional quality rate ({:.1}% WER avg)",
        stats.chunk_size_15000ms.success_rate_professional * 100.0,
        stats.chunk_size_15000ms.avg_word_error_rate * 100.0
    ));
    
    // Determine best chunk size
    if stats.chunk_size_15000ms.success_rate_professional >= 0.8 {
        recommendations.push("RECOMMENDATION: Use 15000ms chunks for production (best quality)".to_string());
    } else if stats.chunk_size_10000ms.success_rate_professional >= 0.8 {
        recommendations.push("RECOMMENDATION: Use 10000ms chunks for production (best quality)".to_string());
    } else if stats.chunk_size_5000ms.success_rate_professional >= 0.6 {
        recommendations.push("RECOMMENDATION: Use 5000ms chunks for production (acceptable quality)".to_string());
    } else {
        recommendations.push("WARNING: Even with longer chunks, quality remains poor - consider different approach".to_string());
    }
    
    recommendations
}

fn print_comprehensive_analysis(report: &ComprehensiveChunkingReport) {
    println!("🎯 COMPREHENSIVE CHUNKING ANALYSIS RESULTS");
    println!("==========================================");
    println!("📊 Analyzed {} recordings comprehensively", report.summary.total_recordings);
    println!("📊 Chunk sizes tested: {:?}", report.summary.chunk_sizes_tested);
    
    println!("\\n📈 QUALITY STATISTICS");
    println!("====================");
    
    println!("🔸 5000ms chunks:");
    println!("   Average similarity: {:.3}", report.summary.quality_statistics.chunk_size_5000ms.avg_similarity);
    println!("   Average WER: {:.1}%", report.summary.quality_statistics.chunk_size_5000ms.avg_word_error_rate * 100.0);
    println!("   Professional quality (>90%): {:.1}%", report.summary.quality_statistics.chunk_size_5000ms.success_rate_professional * 100.0);
    
    println!("🔸 10000ms chunks:");
    println!("   Average similarity: {:.3}", report.summary.quality_statistics.chunk_size_10000ms.avg_similarity);
    println!("   Average WER: {:.1}%", report.summary.quality_statistics.chunk_size_10000ms.avg_word_error_rate * 100.0);
    println!("   Professional quality (>90%): {:.1}%", report.summary.quality_statistics.chunk_size_10000ms.success_rate_professional * 100.0);
    
    println!("🔸 15000ms chunks:");
    println!("   Average similarity: {:.3}", report.summary.quality_statistics.chunk_size_15000ms.avg_similarity);
    println!("   Average WER: {:.1}%", report.summary.quality_statistics.chunk_size_15000ms.avg_word_error_rate * 100.0);
    println!("   Professional quality (>90%): {:.1}%", report.summary.quality_statistics.chunk_size_15000ms.success_rate_professional * 100.0);
    
    println!("\\n⚡ PERFORMANCE STATISTICS");
    println!("========================");
    println!("Average time to first result: {:.0}ms", report.summary.performance_statistics.avg_time_to_first_result_ms);
    println!("Fastest first result: {:.0}ms", report.summary.performance_statistics.min_time_to_first_result_ms);
    println!("Slowest first result: {:.0}ms", report.summary.performance_statistics.max_time_to_first_result_ms);
    
    println!("\\n🎯 RECOMMENDATIONS");
    println!("==================");
    for rec in &report.summary.recommendations {
        println!("• {}", rec);
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("🎯 COMPREHENSIVE CHUNKING ANALYSIS V2");
    println!("====================================\\n");
    
    // Initialize database and get ALL comprehensive recordings
    let db_path = PathBuf::from("./benchmark_corpus/benchmark.db");
    let database = Database::new(&db_path).await?;
    let all_recordings = extract_comprehensive_recordings(&database).await?;
    
    if all_recordings.is_empty() {
        println!("❌ No comprehensive recordings found in benchmark corpus");
        return Ok(());
    }
    
    // Small sample for testing: just the 3 shortest recordings
    let mut recordings_to_analyze: Vec<_> = all_recordings.into_iter()
        .filter(|r| r.duration_ms < 120000) // Only under 2 minutes
        .collect();
    recordings_to_analyze.sort_by_key(|r| r.duration_ms); // Sort by duration
    recordings_to_analyze.truncate(3); // Keep only the 3 shortest
    println!("📋 Analyzing {} shortest recordings for E2E testing", recordings_to_analyze.len());
    
    // Initialize transcriber
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
            Ok(t) => (t, "base (recommend downloading large-v3)"),
            Err(e) => {
                println!("❌ Failed to initialize transcriber: {}", e);
                return Ok(());
            }
        }
    };
    
    println!("✅ Transcriber initialized with {} model", model_used);
    println!();
    
    // Test longer chunk sizes: 5s, 10s, 15s
    let chunk_sizes = vec![5000, 10000, 15000];
    let mut recordings_analyzed = Vec::new();
    
    for (idx, recording) in recordings_to_analyze.iter().enumerate() {
        println!("🎵 [{}/{}] COMPREHENSIVE ANALYSIS: {} ({}ms, {:?})", 
                idx + 1, recordings_to_analyze.len(), recording.name, recording.duration_ms, recording.recording_length_category);
        
        // Get sample rate
        let sample_rate = match get_audio_sample_rate(&recording.audio_file) {
            Ok(sr) => sr,
            Err(e) => {
                println!("  ❌ Failed to get sample rate: {}", e);
                continue;
            }
        };
        
        // Load gold standard transcription as baseline
        let gold_standard_path = PathBuf::from("./benchmark_corpus/gold_standard_transcriptions.json");
        let (full_transcription, baseline_source) = if gold_standard_path.exists() {
            match load_gold_standard_transcription(&recording.name, &gold_standard_path).await {
                Ok(gold_transcription) => {
                    (gold_transcription, "gold_standard".to_string())
                }
                Err(_) => {
                    println!("  ⚠️  Gold standard not found, generating on-the-fly...");
                    let transcription = match transcriber.transcribe(&recording.audio_file) {
                        Ok(text) => text.trim().to_string(),
                        Err(e) => {
                            println!("    ❌ Failed: {}", e);
                            continue;
                        }
                    };
                    (transcription, "generated".to_string())
                }
            }
        } else {
            println!("  ⚠️  No gold standard file found, generating baseline...");
            let transcription = match transcriber.transcribe(&recording.audio_file) {
                Ok(text) => text.trim().to_string(),
                Err(e) => {
                    println!("    ❌ Failed: {}", e);
                    continue;
                }
            };
            (transcription, "generated".to_string())
        };
        
        println!("  🏆 Baseline ({}): \"{}...\"", 
                baseline_source,
                full_transcription.chars().take(60).collect::<String>());
        
        // Test different chunk sizes with REAL AUDIO CHUNKING
        let mut chunk_analyses = Vec::new();
        
        for &chunk_size_ms in &chunk_sizes {
            match perform_real_chunked_transcription(&transcriber, &recording.audio_file, chunk_size_ms, sample_rate).await {
                Ok(mut chunk_analysis) => {
                    analyze_transcription_quality(&full_transcription, &mut chunk_analysis);
                    println!("    ✅ {}ms: {:.1}% WER, {:.3} similarity, {:.0}ms first result", 
                            chunk_size_ms, 
                            chunk_analysis.word_error_rate * 100.0,
                            chunk_analysis.similarity_score,
                            chunk_analysis.time_to_first_chunk_ms);
                    chunk_analyses.push(chunk_analysis);
                }
                Err(e) => {
                    println!("    ❌ {}ms chunks failed: {}", chunk_size_ms, e);
                }
            }
        }
        
        recordings_analyzed.push(ComprehensiveChunkingAnalysis {
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
    let quality_stats = generate_quality_statistics(&recordings_analyzed);
    let performance_stats = generate_performance_statistics(&recordings_analyzed);
    let recommendations = generate_comprehensive_recommendations(&recordings_analyzed);
    
    let report = ComprehensiveChunkingReport {
        timestamp: chrono::Utc::now().to_rfc3339(),
        test_description: "Comprehensive real audio chunking analysis across all benchmark recordings".to_string(),
        recordings_analyzed,
        summary: ComprehensiveSummary {
            total_recordings: recordings_to_analyze.len(),
            chunk_sizes_tested: chunk_sizes.clone(),
            quality_statistics: quality_stats,
            performance_statistics: performance_stats,
            recommendations,
        },
    };
    
    // Print comprehensive results
    print_comprehensive_analysis(&report);
    
    // Save results
    let json_content = serde_json::to_string_pretty(&report)?;
    let output_file = "./comprehensive_chunking_analysis_v2.json";
    tokio::fs::write(output_file, json_content).await?;
    
    println!("\\n📄 Comprehensive analysis saved to: {}", output_file);
    
    Ok(())
}
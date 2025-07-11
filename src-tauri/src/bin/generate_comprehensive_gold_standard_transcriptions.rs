use std::path::PathBuf;
use std::time::Instant;
use tokio;
use serde::{Serialize, Deserialize};
use sqlx::Row;
use chrono;
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

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("🏆 GENERATING COMPREHENSIVE GOLD STANDARD TRANSCRIPTIONS");
    println!("=========================================================\\n");
    
    // Initialize database and get all comprehensive recordings
    let db_path = PathBuf::from("./benchmark_corpus/benchmark.db");
    let database = Database::new(&db_path).await?;
    let all_recordings = extract_comprehensive_recordings(&database).await?;
    
    if all_recordings.is_empty() {
        println!("❌ No comprehensive recordings found");
        return Ok(());
    }
    
    println!("📋 Found {} comprehensive recordings to process", all_recordings.len());
    
    // Initialize the best available transcriber
    let large_model_path = PathBuf::from("./models/ggml-large-v3.en.bin");
    let medium_model_path = PathBuf::from("./models/ggml-medium.en.bin");
    let base_model_path = PathBuf::from("./models/ggml-base.en.bin");
    
    let (transcriber, model_used) = if large_model_path.exists() {
        match Transcriber::new(&large_model_path) {
            Ok(t) => (t, "large-v3"),
            Err(_) => {
                println!("⚠️  Large model failed, trying medium...");
                if medium_model_path.exists() {
                    match Transcriber::new(&medium_model_path) {
                        Ok(t) => (t, "medium"),
                        Err(_) => {
                            println!("⚠️  Medium model failed, using base...");
                            (Transcriber::new(&base_model_path)?, "base")
                        }
                    }
                } else {
                    println!("⚠️  No medium model, using base...");
                    (Transcriber::new(&base_model_path)?, "base")
                }
            }
        }
    } else if medium_model_path.exists() {
        match Transcriber::new(&medium_model_path) {
            Ok(t) => (t, "medium"),
            Err(_) => {
                println!("⚠️  Medium model failed, using base...");
                (Transcriber::new(&base_model_path)?, "base")
            }
        }
    } else {
        (Transcriber::new(&base_model_path)?, "base")
    };
    
    println!("✅ Using {} model for gold standard transcriptions", model_used);
    
    if model_used == "base" {
        println!("💡 For best gold standard quality, consider downloading better models:");
        println!("   wget https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin -O ./models/ggml-large-v3.en.bin");
        println!("   wget https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin -O ./models/ggml-medium.en.bin");
    }
    
    println!("\\n🎯 Generating gold standard transcriptions...\\n");
    
    let mut gold_transcriptions = Vec::new();
    let mut processing_times = Vec::new();
    let total_start = Instant::now();
    
    for (idx, recording) in all_recordings.iter().enumerate() {
        println!("📝 [{}/{}] Processing: {} ({}ms, {:?}, {} words)", 
                idx + 1, all_recordings.len(), recording.name, recording.duration_ms, 
                recording.recording_length_category, recording.word_count);
        
        let start_time = Instant::now();
        
        match transcriber.transcribe(&recording.audio_file) {
            Ok(transcription) => {
                let processing_time = start_time.elapsed();
                let processing_ms = processing_time.as_millis() as f64;
                processing_times.push(processing_ms);
                
                let preview = transcription.chars().take(60).collect::<String>() + 
                             if transcription.len() > 60 { "..." } else { "" };
                println!("    ✅ \"{}\" ({}ms)", preview, processing_ms);
                
                gold_transcriptions.push(GoldStandardTranscription {
                    recording_name: recording.name.clone(),
                    audio_file_path: recording.audio_file.to_string_lossy().to_string(),
                    duration_ms: recording.duration_ms,
                    category: format!("{:?}", recording.recording_length_category),
                    gold_standard_transcription: transcription.trim().to_string(),
                    model_used: model_used.to_string(),
                    processing_time_ms: processing_ms,
                    generated_at: chrono::Utc::now().to_rfc3339(),
                });
            }
            Err(e) => {
                println!("    ❌ Failed: {}", e);
            }
        }
    }
    
    let total_time = total_start.elapsed();
    
    // Calculate processing statistics
    let total_time_ms = total_time.as_millis() as f64;
    let avg_time_ms = if !processing_times.is_empty() { 
        processing_times.iter().sum::<f64>() / processing_times.len() as f64 
    } else { 0.0 };
    let fastest_ms = processing_times.iter().cloned().fold(f64::INFINITY, f64::min);
    let slowest_ms = processing_times.iter().cloned().fold(0.0, f64::max);
    
    let report = GoldStandardReport {
        timestamp: chrono::Utc::now().to_rfc3339(),
        model_used: model_used.to_string(),
        total_recordings: gold_transcriptions.len(),
        transcriptions: gold_transcriptions,
        processing_summary: ProcessingSummary {
            total_time_ms,
            avg_time_per_recording_ms: avg_time_ms,
            fastest_ms,
            slowest_ms,
        },
    };
    
    // Save the gold standard transcriptions
    let json_content = serde_json::to_string_pretty(&report)?;
    let output_file = "./benchmark_corpus/gold_standard_transcriptions.json";
    tokio::fs::write(output_file, json_content).await?;
    
    println!("\\n🏆 COMPREHENSIVE GOLD STANDARD GENERATION COMPLETE");
    println!("==================================================");
    println!("📊 Generated {} gold standard transcriptions", report.total_recordings);
    println!("🎯 Model used: {}", report.model_used);
    println!("⏱️  Total time: {:.1}s", total_time_ms / 1000.0);
    println!("📈 Average per recording: {:.0}ms", avg_time_ms);
    println!("⚡ Fastest: {:.0}ms, Slowest: {:.0}ms", fastest_ms, slowest_ms);
    println!("💾 Saved to: {}", output_file);
    
    Ok(())
}
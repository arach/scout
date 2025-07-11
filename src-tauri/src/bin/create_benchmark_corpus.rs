use std::path::PathBuf;
use std::fs;
use tokio;
use serde::{Serialize, Deserialize};
use chrono;
use scout_lib::db::Database;
use scout_lib::benchmarking::{TestDataExtractor, RecordingLength};

#[derive(Debug, Serialize, Deserialize)]
struct BenchmarkCorpus {
    metadata: CorpusMetadata,
    recordings: Vec<BenchmarkRecording>,
}

#[derive(Debug, Serialize, Deserialize)]
struct CorpusMetadata {
    created_at: String,
    total_recordings: usize,
    source_database: String,
    description: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct BenchmarkRecording {
    id: String,
    name: String,
    text: String,
    duration_ms: u32,
    category: String,
    audio_filename: String,
    original_audio_path: Option<String>,
    file_size: Option<i64>,
    created_at: String,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("🏗️ Creating Scout Benchmark Corpus");
    println!("====================================\n");
    
    // Create benchmark directory structure
    let benchmark_dir = PathBuf::from("./benchmark_corpus");
    let audio_dir = benchmark_dir.join("audio");
    let db_path = benchmark_dir.join("benchmark.db");
    
    println!("📁 Creating benchmark directory: {}", benchmark_dir.display());
    fs::create_dir_all(&audio_dir)?;
    
    // Connect to source database (real app data)
    let source_db_path = PathBuf::from("/Users/arach/Library/Application Support/com.scout.app/scout.db");
    println!("📊 Connecting to source database: {}", source_db_path.display());
    let source_database = Database::new(&source_db_path).await?;
    
    // Extract representative test recordings
    let extractor = TestDataExtractor::new(std::sync::Arc::new(source_database));
    let all_tests = extractor.extract_test_recordings().await?;
    
    if all_tests.is_empty() {
        println!("❌ No test recordings found in source database");
        return Ok(());
    }
    
    println!("📋 Found {} total recordings", all_tests.len());
    
    // Select diverse sample for benchmark corpus
    let mut selected_recordings = Vec::new();
    
    // Get 3 from each category for good coverage
    for category in [RecordingLength::UltraShort, RecordingLength::Short, RecordingLength::Medium, RecordingLength::Long] {
        let category_recordings: Vec<_> = all_tests
            .iter()
            .filter(|r| std::mem::discriminant(&r.recording_length_category) == std::mem::discriminant(&category))
            .take(3)
            .collect();
        
        println!("📊 Selected {} recordings from {:?} category", category_recordings.len(), category);
        selected_recordings.extend(category_recordings);
    }
    
    if selected_recordings.is_empty() {
        println!("❌ No recordings selected for corpus");
        return Ok(());
    }
    
    println!("✅ Total selected for corpus: {} recordings\n", selected_recordings.len());
    
    // Create benchmark database
    println!("💾 Creating benchmark database...");
    let benchmark_database = Database::new(&db_path).await?;
    
    // Copy recordings and audio files
    let mut corpus_recordings = Vec::new();
    let mut successful_copies = 0;
    
    for (index, recording) in selected_recordings.iter().enumerate() {
        let benchmark_id = format!("benchmark_{:03}", index + 1);
        let audio_filename = format!("{}.wav", benchmark_id);
        let target_audio_path = audio_dir.join(&audio_filename);
        
        println!("🎵 Processing: {} -> {}", recording.name, benchmark_id);
        
        // Copy audio file if it exists
        let audio_copied = if recording.audio_file.exists() {
            match fs::copy(&recording.audio_file, &target_audio_path) {
                Ok(_) => {
                    println!("   ✅ Audio copied: {}", audio_filename);
                    true
                }
                Err(e) => {
                    println!("   ⚠️ Audio copy failed: {}", e);
                    false
                }
            }
        } else {
            println!("   ⚠️ Source audio file not found: {}", recording.audio_file.display());
            false
        };
        
        // Save transcript to benchmark database
        let audio_path_str = if audio_copied {
            Some(target_audio_path.to_string_lossy().to_string())
        } else {
            None
        };
        
        match benchmark_database.save_transcript(
            &recording.expected_transcript.as_ref().unwrap_or(&"No transcript available".to_string()),
            recording.duration_ms as i32,
            Some(&format!("category:{:?},original_id:{}", recording.recording_length_category, recording.name)),
            audio_path_str.as_deref(),
            None, // file_size not available in BenchmarkTest
        ).await {
            Ok(saved_transcript) => {
                corpus_recordings.push(BenchmarkRecording {
                    id: benchmark_id.clone(),
                    name: benchmark_id,
                    text: recording.expected_transcript.as_ref().unwrap_or(&"No transcript available".to_string()).clone(),
                    duration_ms: recording.duration_ms,
                    category: format!("{:?}", recording.recording_length_category),
                    audio_filename,
                    original_audio_path: Some(recording.audio_file.to_string_lossy().to_string()),
                    file_size: None, // file_size not available in BenchmarkTest
                    created_at: saved_transcript.created_at,
                });
                
                if audio_copied {
                    successful_copies += 1;
                }
                println!("   ✅ Transcript saved to benchmark DB");
            }
            Err(e) => {
                println!("   ❌ Failed to save transcript: {}", e);
            }
        }
        
        println!();
    }
    
    // Create corpus metadata
    let corpus = BenchmarkCorpus {
        metadata: CorpusMetadata {
            created_at: chrono::Utc::now().to_rfc3339(),
            total_recordings: corpus_recordings.len(),
            source_database: source_db_path.to_string_lossy().to_string(),
            description: "Scout benchmark corpus with representative recordings across all duration categories".to_string(),
        },
        recordings: corpus_recordings,
    };
    
    // Save corpus manifest
    let manifest_path = benchmark_dir.join("corpus_manifest.json");
    let manifest_json = serde_json::to_string_pretty(&corpus)?;
    fs::write(&manifest_path, manifest_json)?;
    
    // Create .gitignore for benchmark corpus
    let gitignore_path = benchmark_dir.join(".gitignore");
    fs::write(&gitignore_path, "# Benchmark corpus - do not commit\n*\n!.gitignore\n")?;
    
    // Print summary
    println!("🎉 BENCHMARK CORPUS CREATED SUCCESSFULLY");
    println!("==========================================");
    println!("📂 Location: {}", benchmark_dir.display());
    println!("💾 Database: {}", db_path.display());
    println!("🎵 Audio files: {} successfully copied", successful_copies);
    println!("📄 Manifest: {}", manifest_path.display());
    println!("📋 Total recordings: {}", corpus.metadata.total_recordings);
    println!("🚫 .gitignore created (corpus won't be committed)");
    
    println!("\n📊 CORPUS BREAKDOWN:");
    let mut category_counts = std::collections::HashMap::new();
    for recording in &corpus.recordings {
        *category_counts.entry(&recording.category).or_insert(0) += 1;
    }
    
    for (category, count) in category_counts {
        println!("   {}: {} recordings", category, count);
    }
    
    println!("\n💡 USAGE:");
    println!("   Update benchmarks to use: {}", db_path.display());
    println!("   Audio files available in: {}", audio_dir.display());
    
    Ok(())
}
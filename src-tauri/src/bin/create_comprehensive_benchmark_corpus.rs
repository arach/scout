use std::path::PathBuf;
use std::fs;
use tokio;
use serde::{Serialize, Deserialize};
use sqlx::Row;
use scout_lib::db::Database;
use scout_lib::benchmarking::RecordingLength;

#[derive(Debug, Serialize, Deserialize)]
struct ComprehensiveRecording {
    pub id: i64,
    pub name: String,
    pub audio_file: PathBuf,
    pub duration_ms: u32,
    pub transcript: String,
    pub word_count: usize,
    pub recording_length_category: RecordingLength,
    pub created_at: String,
}

async fn extract_comprehensive_recordings(database: &Database) -> Result<Vec<ComprehensiveRecording>, String> {
    println!("📊 Querying comprehensive recording dataset...");
    
    // Get recordings with substantial content, focusing on longer recordings
    let query = r#"
        SELECT id, text, duration_ms, audio_path, created_at
        FROM transcripts 
        WHERE audio_path IS NOT NULL 
        AND LENGTH(text) > 10  -- meaningful content
        AND duration_ms >= 2000  -- minimum 2 seconds
        ORDER BY 
            CASE 
                WHEN duration_ms >= 30000 THEN 1  -- very long first
                WHEN duration_ms >= 15000 THEN 2  -- long second  
                WHEN duration_ms >= 8000 THEN 3   -- medium third
                ELSE 4                            -- short last
            END,
            LENGTH(text) DESC,  -- prefer longer transcripts
            duration_ms DESC
        LIMIT 25  -- comprehensive but manageable corpus
    "#;
    
    let rows = sqlx::query(query)
        .fetch_all(database.get_pool())
        .await
        .map_err(|e| format!("Database query failed: {}", e))?;
    
    let mut recordings = Vec::new();
    
    for (idx, row) in rows.iter().enumerate() {
        let id: i64 = row.get("id");
        let text: String = row.get("text");
        let duration_ms: i64 = row.get("duration_ms");
        let audio_path: String = row.get("audio_path");
        let created_at: String = row.get("created_at");
        
        let audio_file = PathBuf::from(&audio_path);
        
        // Skip if audio file doesn't exist
        if !audio_file.exists() {
            println!("⚠️  Skipping {}: audio file not found", audio_path);
            continue;
        }
        
        let duration_ms_u32 = duration_ms as u32;
        let word_count = text.split_whitespace().count();
        
        // Skip recordings that are too short or have too little content
        if duration_ms_u32 < 2000 || word_count < 3 {
            continue;
        }
        
        let category = match duration_ms_u32 {
            2000..=4999 => RecordingLength::Short,
            5000..=14999 => RecordingLength::Medium,
            15000..=59999 => RecordingLength::Long,
            60000.. => RecordingLength::Extended,
            _ => continue, // Skip anything under 2s
        };
        
        let name = format!("{:?}_recording_{:02}", category, idx + 1);
        
        recordings.push(ComprehensiveRecording {
            id,
            name,
            audio_file,
            duration_ms: duration_ms_u32,
            transcript: text.trim().to_string(),
            word_count,
            recording_length_category: category.clone(),
            created_at,
        });
        
        println!("✅ {}: {}ms, {} words, {:?}", 
                recordings.last().unwrap().name, 
                duration_ms_u32, 
                word_count, 
                category);
    }
    
    println!("📋 Extracted {} comprehensive recordings", recordings.len());
    Ok(recordings)
}

async fn create_comprehensive_corpus(recordings: Vec<ComprehensiveRecording>) -> Result<(), String> {
    let corpus_dir = PathBuf::from("./benchmark_corpus");
    let audio_dir = corpus_dir.join("audio");
    let db_path = corpus_dir.join("benchmark.db");
    
    // Create directories
    tokio::fs::create_dir_all(&audio_dir).await
        .map_err(|e| format!("Failed to create audio directory: {}", e))?;
    
    println!("🏗️  Creating comprehensive benchmark database...");
    
    // Create fresh database
    if db_path.exists() {
        tokio::fs::remove_file(&db_path).await
            .map_err(|e| format!("Failed to remove old database: {}", e))?;
    }
    
    let database = Database::new(&db_path).await
        .map_err(|e| format!("Failed to create database: {}", e))?;
    
    // Create recordings table with enhanced schema
    let create_table_sql = r#"
        CREATE TABLE recordings (
            id INTEGER PRIMARY KEY,
            name TEXT UNIQUE NOT NULL,
            duration_ms INTEGER NOT NULL,
            transcript TEXT NOT NULL,
            word_count INTEGER NOT NULL,
            recording_length_category TEXT NOT NULL,
            audio_file TEXT NOT NULL,
            file_size INTEGER,
            created_at TEXT NOT NULL,
            original_id INTEGER
        )
    "#;
    
    sqlx::query(create_table_sql)
        .execute(database.get_pool())
        .await
        .map_err(|e| format!("Failed to create table: {}", e))?;
    
    println!("📁 Copying audio files and inserting records...");
    
    for (idx, recording) in recordings.iter().enumerate() {
        let audio_filename = format!("benchmark_{:03}.wav", idx + 1);
        let target_audio_path = audio_dir.join(&audio_filename);
        
        // Copy audio file
        let audio_copied = if recording.audio_file.exists() {
            match fs::copy(&recording.audio_file, &target_audio_path) {
                Ok(size) => {
                    println!("   📄 Audio copied: {} ({} bytes)", audio_filename, size);
                    true
                }
                Err(e) => {
                    println!("   ❌ Failed to copy audio {}: {}", audio_filename, e);
                    false
                }
            }
        } else {
            println!("   ⚠️  Original audio not found: {:?}", recording.audio_file);
            false
        };
        
        if !audio_copied {
            continue;
        }
        
        // Get file size
        let file_size = match fs::metadata(&target_audio_path) {
            Ok(metadata) => metadata.len() as i64,
            Err(_) => 0,
        };
        
        // Insert record
        let insert_sql = r#"
            INSERT INTO recordings (
                name, duration_ms, transcript, word_count, 
                recording_length_category, audio_file, file_size, 
                created_at, original_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#;
        
        sqlx::query(insert_sql)
            .bind(&recording.name)
            .bind(recording.duration_ms as i64)
            .bind(&recording.transcript)
            .bind(recording.word_count as i64)
            .bind(format!("{:?}", recording.recording_length_category))
            .bind(target_audio_path.to_string_lossy().to_string())
            .bind(file_size)
            .bind(&recording.created_at)
            .bind(recording.id)
            .execute(database.get_pool())
            .await
            .map_err(|e| format!("Failed to insert recording: {}", e))?;
        
        println!("   ✅ Record inserted: {}", recording.name);
    }
    
    // Print summary
    let count_query = "SELECT COUNT(*) as total, 
                      COUNT(CASE WHEN recording_length_category = 'Short' THEN 1 END) as short,
                      COUNT(CASE WHEN recording_length_category = 'Medium' THEN 1 END) as medium, 
                      COUNT(CASE WHEN recording_length_category = 'Long' THEN 1 END) as long,
                      COUNT(CASE WHEN recording_length_category = 'Extended' THEN 1 END) as extended
                      FROM recordings";
    
    let summary = sqlx::query(count_query)
        .fetch_one(database.get_pool())
        .await
        .map_err(|e| format!("Failed to get summary: {}", e))?;
    
    let total: i64 = summary.get("total");
    let short: i64 = summary.get("short");
    let medium: i64 = summary.get("medium");
    let long: i64 = summary.get("long");
    let extended: i64 = summary.get("extended");
    
    println!("\n🎯 COMPREHENSIVE CORPUS CREATED");
    println!("================================");
    println!("📊 Total recordings: {}", total);
    println!("📊 Short (2-5s): {}", short);
    println!("📊 Medium (5-15s): {}", medium);
    println!("📊 Long (15-60s): {}", long);
    println!("📊 Extended (60s+): {}", extended);
    println!("💾 Database: ./benchmark_corpus/benchmark.db");
    println!("📁 Audio files: ./benchmark_corpus/audio/");
    
    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("🚀 CREATING COMPREHENSIVE BENCHMARK CORPUS");
    println!("==========================================\n");
    
    // Connect to live database
    let live_db_path = PathBuf::from("/Users/arach/Library/Application Support/com.scout.app/scout.db");
    let database = Database::new(&live_db_path).await?;
    
    // Extract comprehensive recordings (focusing on longer, substantial content)
    let recordings = extract_comprehensive_recordings(&database).await?;
    
    if recordings.is_empty() {
        println!("❌ No suitable recordings found for corpus");
        return Ok(());
    }
    
    // Create comprehensive corpus
    create_comprehensive_corpus(recordings).await?;
    
    println!("\n✅ Comprehensive benchmark corpus ready!");
    println!("💡 Next: Run 'cargo run --bin generate_gold_standard_transcriptions'");
    println!("💡 Then: Run 'cargo run --bin comprehensive_chunking_analysis'");
    
    Ok(())
}
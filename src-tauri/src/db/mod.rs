use sqlx::{migrate::MigrateDatabase, Pool, Sqlite, SqlitePool};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct Transcript {
    pub id: i64,
    pub text: String,
    pub duration_ms: i32,
    pub created_at: String,
    pub metadata: Option<String>,
    pub audio_path: Option<String>,
    pub file_size: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct PerformanceMetrics {
    pub id: i64,
    pub transcript_id: Option<i64>,
    pub recording_duration_ms: i32,
    pub transcription_time_ms: i32,
    pub user_perceived_latency_ms: Option<i32>,
    pub processing_queue_time_ms: Option<i32>,
    pub model_used: Option<String>,
    pub audio_file_size_bytes: Option<i64>,
    pub audio_format: Option<String>,
    pub success: bool,
    pub error_message: Option<String>,
    pub created_at: String,
    pub metadata: Option<String>,
}

pub struct Database {
    pool: Pool<Sqlite>,
}

impl Database {
    pub async fn new(db_path: &Path) -> Result<Self, String> {
        let db_url = format!("sqlite:{}", db_path.display());

        // Create database if it doesn't exist
        if !Sqlite::database_exists(&db_url)
            .await
            .map_err(|e| format!("Failed to check database existence: {}", e))?
        {
            Sqlite::create_database(&db_url)
                .await
                .map_err(|e| format!("Failed to create database: {}", e))?;
        }

        // Connect to database
        let pool = SqlitePool::connect(&db_url)
            .await
            .map_err(|e| format!("Failed to connect to database: {}", e))?;

        
        // Create tables and run migrations
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS transcripts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                text TEXT NOT NULL,
                duration_ms INTEGER NOT NULL,
                created_at TEXT DEFAULT (datetime('now')),
                metadata TEXT,
                audio_path TEXT,
                file_size INTEGER
            );
            
            CREATE INDEX IF NOT EXISTS idx_transcripts_created_at ON transcripts(created_at);
            CREATE INDEX IF NOT EXISTS idx_transcripts_text ON transcripts(text);
            "#
        )
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to create tables: {}", e))?;

        // Add columns if they don't exist (for existing databases)
        let _ = sqlx::query("ALTER TABLE transcripts ADD COLUMN audio_path TEXT")
            .execute(&pool)
            .await;
        let _ = sqlx::query("ALTER TABLE transcripts ADD COLUMN file_size INTEGER")
            .execute(&pool)
            .await;

        // Create performance metrics table
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS performance_metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                transcript_id INTEGER,
                recording_duration_ms INTEGER NOT NULL,
                transcription_time_ms INTEGER NOT NULL,
                user_perceived_latency_ms INTEGER,
                processing_queue_time_ms INTEGER,
                model_used TEXT,
                audio_file_size_bytes INTEGER,
                audio_format TEXT,
                success BOOLEAN NOT NULL DEFAULT 1,
                error_message TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                metadata TEXT,
                FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE
            );
            
            CREATE INDEX IF NOT EXISTS idx_performance_metrics_created_at ON performance_metrics(created_at);
            CREATE INDEX IF NOT EXISTS idx_performance_metrics_transcript_id ON performance_metrics(transcript_id);
            CREATE INDEX IF NOT EXISTS idx_performance_metrics_success ON performance_metrics(success);
            "#
        )
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to create performance_metrics table: {}", e))?;

        Ok(Self { pool })
    }

    pub async fn save_transcript(
        &self,
        text: &str,
        duration_ms: i32,
        metadata: Option<&str>,
        audio_path: Option<&str>,
        file_size: Option<i64>,
    ) -> Result<Transcript, String> {
        let result = sqlx::query(
            r#"
            INSERT INTO transcripts (text, duration_ms, metadata, audio_path, file_size)
            VALUES (?1, ?2, ?3, ?4, ?5)
            "#
        )
        .bind(text)
        .bind(duration_ms)
        .bind(metadata)
        .bind(audio_path)
        .bind(file_size)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to save transcript: {}", e))?;

        let id = result.last_insert_rowid();
        
        // Fetch the newly created transcript to return it
        self.get_transcript(id)
            .await?
            .ok_or_else(|| "Failed to fetch newly created transcript".to_string())
    }

    pub async fn get_transcript(&self, id: i64) -> Result<Option<Transcript>, String> {
        let transcript = sqlx::query_as::<_, Transcript>(
            r#"
            SELECT id, text, duration_ms, created_at, metadata, audio_path, file_size
            FROM transcripts
            WHERE id = ?1
            "#
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| format!("Failed to get transcript: {}", e))?;

        Ok(transcript)
    }

    pub async fn get_recent_transcripts(&self, limit: i32) -> Result<Vec<Transcript>, String> {
        let transcripts = sqlx::query_as::<_, Transcript>(
            r#"
            SELECT id, text, duration_ms, created_at, metadata, audio_path, file_size
            FROM transcripts
            ORDER BY created_at DESC
            LIMIT ?1
            "#
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("Failed to get recent transcripts: {}", e))?;

        Ok(transcripts)
    }

    pub async fn search_transcripts(&self, query: &str) -> Result<Vec<Transcript>, String> {
        let search_pattern = format!("%{}%", query);
        let transcripts = sqlx::query_as::<_, Transcript>(
            r#"
            SELECT id, text, duration_ms, created_at, metadata, audio_path, file_size
            FROM transcripts
            WHERE text LIKE ?1
            ORDER BY created_at DESC
            "#
        )
        .bind(search_pattern)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("Failed to search transcripts: {}", e))?;

        Ok(transcripts)
    }

    pub async fn delete_transcript(&self, id: i64) -> Result<(), String> {
        sqlx::query("DELETE FROM transcripts WHERE id = ?1")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("Failed to delete transcript: {}", e))?;
        
        Ok(())
    }

    pub async fn delete_transcripts(&self, ids: &[i64]) -> Result<(), String> {
        if ids.is_empty() {
            return Ok(());
        }

        // Build placeholders for the query
        let placeholders: Vec<String> = ids.iter().map(|_| "?".to_string()).collect();
        let query = format!("DELETE FROM transcripts WHERE id IN ({})", placeholders.join(", "));
        
        let mut query_builder = sqlx::query(&query);
        for id in ids {
            query_builder = query_builder.bind(id);
        }
        
        query_builder
            .execute(&self.pool)
            .await
            .map_err(|e| format!("Failed to delete transcripts: {}", e))?;
        
        Ok(())
    }

    pub async fn save_performance_metrics(
        &self,
        transcript_id: Option<i64>,
        recording_duration_ms: i32,
        transcription_time_ms: i32,
        user_perceived_latency_ms: Option<i32>,
        processing_queue_time_ms: Option<i32>,
        model_used: Option<&str>,
        audio_file_size_bytes: Option<i64>,
        audio_format: Option<&str>,
        success: bool,
        error_message: Option<&str>,
        metadata: Option<&str>,
    ) -> Result<i64, String> {
        let result = sqlx::query(
            r#"
            INSERT INTO performance_metrics (
                transcript_id, recording_duration_ms, transcription_time_ms,
                user_perceived_latency_ms, processing_queue_time_ms, model_used,
                audio_file_size_bytes, audio_format, success, error_message, metadata
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            "#
        )
        .bind(transcript_id)
        .bind(recording_duration_ms)
        .bind(transcription_time_ms)
        .bind(user_perceived_latency_ms)
        .bind(processing_queue_time_ms)
        .bind(model_used)
        .bind(audio_file_size_bytes)
        .bind(audio_format)
        .bind(success)
        .bind(error_message)
        .bind(metadata)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to save performance metrics: {}", e))?;

        Ok(result.last_insert_rowid())
    }

    pub async fn get_recent_performance_metrics(&self, limit: i32) -> Result<Vec<PerformanceMetrics>, String> {
        let metrics = sqlx::query_as::<_, PerformanceMetrics>(
            r#"
            SELECT * FROM performance_metrics
            ORDER BY created_at DESC
            LIMIT ?1
            "#
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("Failed to get performance metrics: {}", e))?;

        Ok(metrics)
    }
}
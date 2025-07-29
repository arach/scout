use sqlx::{migrate::MigrateDatabase, Pool, Sqlite, SqlitePool, Row};
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
    pub transcription_strategy: Option<String>,
    pub audio_file_size_bytes: Option<i64>,
    pub audio_format: Option<String>,
    pub success: bool,
    pub error_message: Option<String>,
    pub created_at: String,
    pub metadata: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct LLMOutput {
    pub id: i64,
    pub transcript_id: i64,
    pub prompt_id: String,
    pub prompt_name: String,
    pub prompt_template: String,
    pub input_text: String,
    pub output_text: String,
    pub model_used: String,
    pub processing_time_ms: i32,
    pub temperature: f32,
    pub max_tokens: i32,
    pub created_at: String,
    pub metadata: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct LLMPromptTemplate {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub template: String,
    pub category: String,
    pub enabled: bool,
    pub is_custom: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct DictionaryEntry {
    pub id: i64,
    pub original_text: String,
    pub replacement_text: String,
    pub match_type: String,
    pub is_case_sensitive: bool,
    pub phonetic_pattern: Option<String>,
    pub category: Option<String>,
    pub description: Option<String>,
    pub usage_count: i32,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DictionaryMatch {
    pub entry_id: i64,
    pub matched_text: String,
    pub replaced_with: String,
    pub position_start: usize,
    pub position_end: usize,
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

        // Check if performance_metrics table exists and handle migration properly
        let table_exists = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='performance_metrics'"
        )
        .fetch_one(&pool)
        .await
        .map_err(|e| format!("Failed to check table existence: {}", e))?;

        if table_exists == 0 {
            // Create new table with all columns
            sqlx::query(
                r#"
                CREATE TABLE performance_metrics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    transcript_id INTEGER,
                    recording_duration_ms INTEGER NOT NULL,
                    transcription_time_ms INTEGER NOT NULL,
                    user_perceived_latency_ms INTEGER,
                    processing_queue_time_ms INTEGER,
                    model_used TEXT,
                    transcription_strategy TEXT,
                    audio_file_size_bytes INTEGER,
                    audio_format TEXT,
                    success BOOLEAN NOT NULL DEFAULT 1,
                    error_message TEXT,
                    created_at TEXT DEFAULT (datetime('now')),
                    metadata TEXT,
                    FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE
                );
                "#
            )
            .execute(&pool)
            .await
            .map_err(|e| format!("Failed to create performance_metrics table: {}", e))?;
        } else {
            // Table exists, check if transcription_strategy column exists
            let column_exists = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM pragma_table_info('performance_metrics') WHERE name='transcription_strategy'"
            )
            .fetch_one(&pool)
            .await
            .map_err(|e| format!("Failed to check column existence: {}", e))?;

            if column_exists == 0 {
                // Add missing column
                sqlx::query("ALTER TABLE performance_metrics ADD COLUMN transcription_strategy TEXT")
                    .execute(&pool)
                    .await
                    .map_err(|e| format!("Failed to add transcription_strategy column: {}", e))?;
            }
        }

        // Create indexes (these are safe to run multiple times)
        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_performance_metrics_created_at ON performance_metrics(created_at);
            CREATE INDEX IF NOT EXISTS idx_performance_metrics_transcript_id ON performance_metrics(transcript_id);
            CREATE INDEX IF NOT EXISTS idx_performance_metrics_success ON performance_metrics(success);
            CREATE INDEX IF NOT EXISTS idx_performance_metrics_strategy ON performance_metrics(transcription_strategy);
            "#
        )
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to create performance_metrics indexes: {}", e))?;

        // Create LLM tables
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS llm_outputs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                transcript_id INTEGER NOT NULL,
                prompt_id TEXT NOT NULL,
                prompt_name TEXT NOT NULL,
                prompt_template TEXT NOT NULL,
                input_text TEXT NOT NULL,
                output_text TEXT NOT NULL,
                model_used TEXT NOT NULL,
                processing_time_ms INTEGER NOT NULL,
                temperature REAL NOT NULL,
                max_tokens INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                metadata TEXT,
                FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE
            );
            
            CREATE INDEX IF NOT EXISTS idx_llm_outputs_transcript_id ON llm_outputs(transcript_id);
            CREATE INDEX IF NOT EXISTS idx_llm_outputs_prompt_id ON llm_outputs(prompt_id);
            CREATE INDEX IF NOT EXISTS idx_llm_outputs_created_at ON llm_outputs(created_at);
            
            CREATE TABLE IF NOT EXISTS llm_prompt_templates (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                template TEXT NOT NULL,
                category TEXT NOT NULL,
                enabled BOOLEAN DEFAULT 1,
                is_custom BOOLEAN DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            "#
        )
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to create LLM tables: {}", e))?;

        // Insert default prompt templates
        sqlx::query(
            r#"
            INSERT OR IGNORE INTO llm_prompt_templates (id, name, description, template, category, enabled, is_custom) VALUES
                ('summarize', 'Summarize', 'Create a concise summary of the transcript', 'Please provide a concise summary of the following transcript in 2-3 sentences:

{transcript}', 'summarization', 1, 0),
                ('bullet_points', 'Bullet Points', 'Convert transcript to bullet points', 'Convert the following transcript into clear bullet points:

{transcript}', 'formatting', 1, 0),
                ('action_items', 'Extract Action Items', 'Extract actionable tasks from the transcript', 'Extract all action items and tasks from the following transcript. List each one as a checkbox:

{transcript}', 'extraction', 1, 0),
                ('fix_grammar', 'Fix Grammar', 'Correct grammar and punctuation errors', 'Please correct any grammar, spelling, and punctuation errors in the following transcript while preserving the original meaning:

{transcript}', 'formatting', 1, 0),
                ('meeting_notes', 'Meeting Notes', 'Format as structured meeting notes', 'Format the following transcript as structured meeting notes with sections for: Key Topics, Decisions Made, Action Items, and Next Steps:

{transcript}', 'formatting', 0, 0),
                ('key_points', 'Key Points', 'Extract the most important points', 'Identify and list the 3-5 most important points from the following transcript:

{transcript}', 'extraction', 0, 0);
            "#
        )
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to insert default prompt templates: {}", e))?;

        // Create whisper_logs table
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS whisper_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                transcript_id INTEGER,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                level TEXT NOT NULL CHECK (level IN ('DEBUG', 'INFO', 'WARN', 'ERROR')),
                component TEXT NOT NULL,
                message TEXT NOT NULL,
                metadata TEXT, -- JSON field for additional data
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE
            );
            "#
        )
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to create whisper_logs table: {}", e))?;

        // Create dictionary tables
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS dictionary_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                original_text TEXT NOT NULL COLLATE NOCASE,
                replacement_text TEXT NOT NULL,
                match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'word', 'phrase', 'regex')),
                is_case_sensitive BOOLEAN DEFAULT 0,
                phonetic_pattern TEXT,
                category TEXT,
                description TEXT,
                usage_count INTEGER DEFAULT 0,
                enabled BOOLEAN DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE INDEX IF NOT EXISTS idx_dictionary_original ON dictionary_entries(original_text);
            CREATE INDEX IF NOT EXISTS idx_dictionary_enabled ON dictionary_entries(enabled);
            CREATE INDEX IF NOT EXISTS idx_dictionary_category ON dictionary_entries(category);
            
            CREATE TABLE IF NOT EXISTS dictionary_match_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                transcript_id INTEGER NOT NULL,
                entry_id INTEGER NOT NULL,
                matched_text TEXT NOT NULL,
                replaced_with TEXT NOT NULL,
                position_start INTEGER NOT NULL,
                position_end INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE,
                FOREIGN KEY (entry_id) REFERENCES dictionary_entries(id) ON DELETE CASCADE
            );
            
            CREATE INDEX IF NOT EXISTS idx_match_history_transcript ON dictionary_match_history(transcript_id);
            CREATE INDEX IF NOT EXISTS idx_match_history_entry ON dictionary_match_history(entry_id);
            "#
        )
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to create dictionary tables: {}", e))?;

        // Create indexes for whisper_logs
        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_whisper_logs_session_id ON whisper_logs(session_id);
            CREATE INDEX IF NOT EXISTS idx_whisper_logs_transcript_id ON whisper_logs(transcript_id);
            CREATE INDEX IF NOT EXISTS idx_whisper_logs_timestamp ON whisper_logs(timestamp);
            CREATE INDEX IF NOT EXISTS idx_whisper_logs_level ON whisper_logs(level);
            "#
        )
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to create whisper_logs indexes: {}", e))?;

        Ok(Self { pool })
    }

    pub fn get_pool(&self) -> &Pool<Sqlite> {
        &self.pool
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

    pub async fn save_transcript_with_timestamp(
        &self,
        text: &str,
        duration_ms: i32,
        metadata: Option<&str>,
        audio_path: Option<&str>,
        created_at: &str,
    ) -> Result<Transcript, String> {
        let result = sqlx::query(
            r#"
            INSERT INTO transcripts (text, duration_ms, metadata, audio_path, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5)
            "#
        )
        .bind(text)
        .bind(duration_ms)
        .bind(metadata)
        .bind(audio_path)
        .bind(created_at)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to save transcript with timestamp: {}", e))?;

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
        transcription_strategy: Option<&str>,
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
                transcription_strategy, audio_file_size_bytes, audio_format, 
                success, error_message, metadata
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
            "#
        )
        .bind(transcript_id)
        .bind(recording_duration_ms)
        .bind(transcription_time_ms)
        .bind(user_perceived_latency_ms)
        .bind(processing_queue_time_ms)
        .bind(model_used)
        .bind(transcription_strategy)
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

    pub async fn get_performance_metrics_for_transcript(&self, transcript_id: i64) -> Result<Option<PerformanceMetrics>, String> {
        let metrics = sqlx::query_as::<_, PerformanceMetrics>(
            r#"
            SELECT * FROM performance_metrics
            WHERE transcript_id = ?1
            ORDER BY created_at DESC
            LIMIT 1
            "#
        )
        .bind(transcript_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| format!("Failed to get performance metrics for transcript: {}", e))?;

        Ok(metrics)
    }

    // Whisper log methods
    pub async fn insert_whisper_logs(&self, entries: Vec<(String, Option<i64>, crate::whisper_logger::WhisperLogEntry)>) -> Result<(), String> {
        let mut tx = self.pool.begin()
            .await
            .map_err(|e| format!("Failed to begin transaction: {}", e))?;

        for (session_id, transcript_id, entry) in entries {
            let metadata_json = entry.metadata.map(|m| serde_json::to_string(&m).ok()).flatten();
            
            sqlx::query(
                r#"
                INSERT INTO whisper_logs (session_id, transcript_id, timestamp, level, component, message, metadata)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                "#
            )
            .bind(&session_id)
            .bind(transcript_id)
            .bind(entry.timestamp)
            .bind(&entry.level)
            .bind(&entry.component)
            .bind(&entry.message)
            .bind(metadata_json)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed to insert whisper log: {}", e))?;
        }

        tx.commit()
            .await
            .map_err(|e| format!("Failed to commit transaction: {}", e))?;

        Ok(())
    }

    pub async fn get_whisper_logs_for_transcript(&self, transcript_id: i64, limit: Option<i32>) -> Result<Vec<serde_json::Value>, String> {
        let query = if let Some(limit) = limit {
            sqlx::query(
                r#"
                SELECT id, session_id, transcript_id, timestamp, level, component, message, metadata
                FROM whisper_logs
                WHERE transcript_id = ?1
                ORDER BY timestamp ASC
                LIMIT ?2
                "#
            )
            .bind(transcript_id)
            .bind(limit)
        } else {
            sqlx::query(
                r#"
                SELECT id, session_id, transcript_id, timestamp, level, component, message, metadata
                FROM whisper_logs
                WHERE transcript_id = ?1
                ORDER BY timestamp ASC
                "#
            )
            .bind(transcript_id)
        };
        
        let rows = query
            .fetch_all(&self.pool)
            .await
            .map_err(|e| format!("Failed to get whisper logs: {}", e))?;
        
        let logs: Vec<serde_json::Value> = rows.into_iter().map(|row| {
            serde_json::json!({
                "id": row.get::<i64, _>("id"),
                "session_id": row.get::<String, _>("session_id"),
                "transcript_id": row.get::<Option<i64>, _>("transcript_id"),
                "timestamp": row.get::<String, _>("timestamp"),
                "level": row.get::<String, _>("level"),
                "component": row.get::<String, _>("component"),
                "message": row.get::<String, _>("message"),
                "metadata": row.get::<Option<String>, _>("metadata").and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok()),
            })
        }).collect();
        
        Ok(logs)
    }
    
    pub async fn get_whisper_logs_for_session(&self, session_id: &str, limit: Option<i32>) -> Result<Vec<serde_json::Value>, String> {
        let query = if let Some(limit) = limit {
            sqlx::query(
                r#"
                SELECT id, session_id, transcript_id, timestamp, level, component, message, metadata
                FROM whisper_logs
                WHERE session_id = ?1
                ORDER BY timestamp DESC
                LIMIT ?2
                "#
            )
            .bind(session_id)
            .bind(limit)
        } else {
            sqlx::query(
                r#"
                SELECT id, session_id, transcript_id, timestamp, level, component, message, metadata
                FROM whisper_logs
                WHERE session_id = ?1
                ORDER BY timestamp DESC
                "#
            )
            .bind(session_id)
        };

        let rows = query
            .fetch_all(&self.pool)
            .await
            .map_err(|e| format!("Failed to get whisper logs: {}", e))?;

        let logs: Vec<serde_json::Value> = rows.into_iter().map(|row| {
            serde_json::json!({
                "id": row.get::<i64, _>("id"),
                "session_id": row.get::<String, _>("session_id"),
                "transcript_id": row.get::<Option<i64>, _>("transcript_id"),
                "timestamp": row.get::<String, _>("timestamp"),
                "level": row.get::<String, _>("level"),
                "component": row.get::<String, _>("component"),
                "message": row.get::<String, _>("message"),
                "metadata": row.get::<Option<String>, _>("metadata").and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok()),
            })
        }).collect();

        Ok(logs)
    }

    // Performance Timeline methods
    pub async fn save_performance_timeline_events(
        &self,
        transcript_id: i64,
        session_id: &str,
        events: Vec<(String, String, String, Option<i64>)>, // (timestamp, event_type, details, duration_from_start_ms)
    ) -> Result<(), String> {
        let mut tx = self.pool.begin()
            .await
            .map_err(|e| format!("Failed to begin transaction: {}", e))?;
        
        for (timestamp, event_type, details, duration_from_start_ms) in events {
            sqlx::query(
                r#"
                INSERT INTO performance_timeline_events (transcript_id, session_id, timestamp, event_type, details, duration_from_start_ms)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                "#
            )
            .bind(transcript_id)
            .bind(session_id)
            .bind(&timestamp)
            .bind(&event_type)
            .bind(&details)
            .bind(duration_from_start_ms)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed to insert performance event: {}", e))?;
        }
        
        tx.commit()
            .await
            .map_err(|e| format!("Failed to commit transaction: {}", e))?;
        
        Ok(())
    }
    
    pub async fn get_performance_timeline_for_transcript(&self, transcript_id: i64) -> Result<Vec<serde_json::Value>, String> {
        let rows = sqlx::query(
            r#"
            SELECT session_id, timestamp, event_type, details, duration_from_start_ms
            FROM performance_timeline_events
            WHERE transcript_id = ?1
            ORDER BY timestamp ASC
            "#
        )
        .bind(transcript_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("Failed to get performance timeline: {}", e))?;
        
        let events: Vec<serde_json::Value> = rows.into_iter().map(|row| {
            serde_json::json!({
                "session_id": row.get::<String, _>("session_id"),
                "timestamp": row.get::<String, _>("timestamp"),
                "event_type": row.get::<String, _>("event_type"),
                "details": row.get::<String, _>("details"),
                "duration_from_start_ms": row.get::<Option<i64>, _>("duration_from_start_ms"),
            })
        }).collect();
        
        Ok(events)
    }
    
    // LLM Output methods
    pub async fn save_llm_output(
        &self,
        transcript_id: i64,
        prompt_id: &str,
        prompt_name: &str,
        prompt_template: &str,
        input_text: &str,
        output_text: &str,
        model_used: &str,
        processing_time_ms: i32,
        temperature: f32,
        max_tokens: i32,
        metadata: Option<&str>,
    ) -> Result<i64, String> {
        let result = sqlx::query(
            r#"
            INSERT INTO llm_outputs (
                transcript_id, prompt_id, prompt_name, prompt_template,
                input_text, output_text, model_used, processing_time_ms,
                temperature, max_tokens, metadata
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            "#
        )
        .bind(transcript_id)
        .bind(prompt_id)
        .bind(prompt_name)
        .bind(prompt_template)
        .bind(input_text)
        .bind(output_text)
        .bind(model_used)
        .bind(processing_time_ms)
        .bind(temperature)
        .bind(max_tokens)
        .bind(metadata)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to save LLM output: {}", e))?;

        Ok(result.last_insert_rowid())
    }

    pub async fn get_llm_outputs_for_transcript(&self, transcript_id: i64) -> Result<Vec<LLMOutput>, String> {
        let outputs = sqlx::query_as::<_, LLMOutput>(
            r#"
            SELECT * FROM llm_outputs
            WHERE transcript_id = ?1
            ORDER BY created_at ASC
            "#
        )
        .bind(transcript_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("Failed to get LLM outputs: {}", e))?;

        Ok(outputs)
    }

    pub async fn get_llm_prompt_templates(&self) -> Result<Vec<LLMPromptTemplate>, String> {
        let templates = sqlx::query_as::<_, LLMPromptTemplate>(
            r#"
            SELECT * FROM llm_prompt_templates
            ORDER BY category, name
            "#
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("Failed to get LLM prompt templates: {}", e))?;

        Ok(templates)
    }

    pub async fn get_enabled_llm_prompt_templates(&self) -> Result<Vec<LLMPromptTemplate>, String> {
        let templates = sqlx::query_as::<_, LLMPromptTemplate>(
            r#"
            SELECT * FROM llm_prompt_templates
            WHERE enabled = 1
            ORDER BY category, name
            "#
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("Failed to get enabled LLM prompt templates: {}", e))?;

        Ok(templates)
    }

    pub async fn save_llm_prompt_template(
        &self,
        id: &str,
        name: &str,
        description: Option<&str>,
        template: &str,
        category: &str,
        enabled: bool,
    ) -> Result<(), String> {
        sqlx::query(
            r#"
            INSERT OR REPLACE INTO llm_prompt_templates 
            (id, name, description, template, category, enabled, is_custom, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, CURRENT_TIMESTAMP)
            "#
        )
        .bind(id)
        .bind(name)
        .bind(description)
        .bind(template)
        .bind(category)
        .bind(enabled)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to save LLM prompt template: {}", e))?;

        Ok(())
    }

    pub async fn delete_llm_prompt_template(&self, id: &str) -> Result<(), String> {
        sqlx::query(
            r#"
            DELETE FROM llm_prompt_templates 
            WHERE id = ?1 AND is_custom = 1
            "#
        )
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to delete LLM prompt template: {}", e))?;

        Ok(())
    }

    // Dictionary methods
    pub async fn get_enabled_dictionary_entries(&self) -> Result<Vec<DictionaryEntry>, String> {
        let entries = sqlx::query_as::<_, DictionaryEntry>(
            r#"
            SELECT * FROM dictionary_entries
            WHERE enabled = 1
            ORDER BY original_text
            "#
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("Failed to get dictionary entries: {}", e))?;

        Ok(entries)
    }

    pub async fn get_all_dictionary_entries(&self) -> Result<Vec<DictionaryEntry>, String> {
        let entries = sqlx::query_as::<_, DictionaryEntry>(
            r#"
            SELECT * FROM dictionary_entries
            ORDER BY category, original_text
            "#
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("Failed to get all dictionary entries: {}", e))?;

        Ok(entries)
    }

    pub async fn save_dictionary_entry(
        &self,
        original_text: &str,
        replacement_text: &str,
        match_type: &str,
        is_case_sensitive: bool,
        phonetic_pattern: Option<&str>,
        category: Option<&str>,
        description: Option<&str>,
    ) -> Result<i64, String> {
        let result = sqlx::query(
            r#"
            INSERT INTO dictionary_entries (
                original_text, replacement_text, match_type, is_case_sensitive,
                phonetic_pattern, category, description
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            "#
        )
        .bind(original_text)
        .bind(replacement_text)
        .bind(match_type)
        .bind(is_case_sensitive)
        .bind(phonetic_pattern)
        .bind(category)
        .bind(description)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to save dictionary entry: {}", e))?;

        Ok(result.last_insert_rowid())
    }

    pub async fn update_dictionary_entry(
        &self,
        id: i64,
        original_text: &str,
        replacement_text: &str,
        match_type: &str,
        is_case_sensitive: bool,
        phonetic_pattern: Option<&str>,
        category: Option<&str>,
        description: Option<&str>,
        enabled: bool,
    ) -> Result<(), String> {
        sqlx::query(
            r#"
            UPDATE dictionary_entries 
            SET original_text = ?1, replacement_text = ?2, match_type = ?3,
                is_case_sensitive = ?4, phonetic_pattern = ?5, category = ?6,
                description = ?7, enabled = ?8, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?9
            "#
        )
        .bind(original_text)
        .bind(replacement_text)
        .bind(match_type)
        .bind(is_case_sensitive)
        .bind(phonetic_pattern)
        .bind(category)
        .bind(description)
        .bind(enabled)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to update dictionary entry: {}", e))?;

        Ok(())
    }

    pub async fn delete_dictionary_entry(&self, id: i64) -> Result<(), String> {
        sqlx::query("DELETE FROM dictionary_entries WHERE id = ?1")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("Failed to delete dictionary entry: {}", e))?;

        Ok(())
    }

    pub async fn increment_dictionary_usage(&self, entry_id: i64) -> Result<(), String> {
        sqlx::query(
            r#"
            UPDATE dictionary_entries 
            SET usage_count = usage_count + 1
            WHERE id = ?1
            "#
        )
        .bind(entry_id)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to increment dictionary usage: {}", e))?;

        Ok(())
    }

    pub async fn save_dictionary_matches(
        &self,
        transcript_id: i64,
        matches: &[DictionaryMatch],
    ) -> Result<(), String> {
        let mut tx = self.pool.begin()
            .await
            .map_err(|e| format!("Failed to begin transaction: {}", e))?;

        for m in matches {
            sqlx::query(
                r#"
                INSERT INTO dictionary_match_history (
                    transcript_id, entry_id, matched_text, replaced_with,
                    position_start, position_end
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                "#
            )
            .bind(transcript_id)
            .bind(m.entry_id)
            .bind(&m.matched_text)
            .bind(&m.replaced_with)
            .bind(m.position_start as i64)
            .bind(m.position_end as i64)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed to save dictionary match: {}", e))?;

            // Increment usage count
            sqlx::query(
                r#"
                UPDATE dictionary_entries 
                SET usage_count = usage_count + 1
                WHERE id = ?1
                "#
            )
            .bind(m.entry_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed to increment usage count: {}", e))?;
        }

        tx.commit()
            .await
            .map_err(|e| format!("Failed to commit transaction: {}", e))?;

        Ok(())
    }

    pub async fn get_dictionary_matches_for_transcript(&self, transcript_id: i64) -> Result<Vec<serde_json::Value>, String> {
        let rows = sqlx::query(
            r#"
            SELECT dmh.*, de.original_text, de.replacement_text, de.category
            FROM dictionary_match_history dmh
            JOIN dictionary_entries de ON dmh.entry_id = de.id
            WHERE dmh.transcript_id = ?1
            ORDER BY dmh.position_start
            "#
        )
        .bind(transcript_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("Failed to get dictionary matches: {}", e))?;

        let matches: Vec<serde_json::Value> = rows.into_iter().map(|row| {
            serde_json::json!({
                "id": row.get::<i64, _>("id"),
                "entry_id": row.get::<i64, _>("entry_id"),
                "matched_text": row.get::<String, _>("matched_text"),
                "replaced_with": row.get::<String, _>("replaced_with"),
                "position_start": row.get::<i64, _>("position_start"),
                "position_end": row.get::<i64, _>("position_end"),
                "original_text": row.get::<String, _>("original_text"),
                "replacement_text": row.get::<String, _>("replacement_text"),
                "category": row.get::<Option<String>, _>("category"),
                "created_at": row.get::<String, _>("created_at"),
            })
        }).collect();

        Ok(matches)
    }
}
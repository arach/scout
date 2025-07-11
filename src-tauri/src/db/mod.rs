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
}
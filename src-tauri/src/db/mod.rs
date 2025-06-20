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

        Ok(Self { pool })
    }

    pub async fn save_transcript(
        &self,
        text: &str,
        duration_ms: i32,
        metadata: Option<&str>,
        audio_path: Option<&str>,
        file_size: Option<i64>,
    ) -> Result<i64, String> {
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

        Ok(result.last_insert_rowid())
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
}
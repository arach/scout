use crate::benchmarking::{BenchmarkTest, ContentType, RecordingLength};
use crate::db::Database;
use crate::logger::{error, info, Component};
use sqlx::Row;
use std::path::PathBuf;
use std::sync::Arc;

pub struct TestDataExtractor {
    database: Arc<Database>,
}

impl TestDataExtractor {
    pub fn new(database: Arc<Database>) -> Self {
        Self { database }
    }

    /// Extract test recordings from the database categorized by length
    pub async fn extract_test_recordings(&self) -> Result<Vec<BenchmarkTest>, String> {
        info(
            Component::Processing,
            "📊 Extracting test recordings from database",
        );

        let mut tests = Vec::new();

        // Get recordings from different length categories
        tests.extend(
            self.extract_by_length_category(RecordingLength::UltraShort, 500, 2000)
                .await?,
        );
        tests.extend(
            self.extract_by_length_category(RecordingLength::Short, 2000, 5000)
                .await?,
        );
        tests.extend(
            self.extract_by_length_category(RecordingLength::Medium, 5000, 15000)
                .await?,
        );
        tests.extend(
            self.extract_by_length_category(RecordingLength::Long, 15000, 60000)
                .await?,
        );

        info(
            Component::Processing,
            &format!("📋 Extracted {} test recordings", tests.len()),
        );
        Ok(tests)
    }

    async fn extract_by_length_category(
        &self,
        category: RecordingLength,
        min_duration_ms: u32,
        max_duration_ms: u32,
    ) -> Result<Vec<BenchmarkTest>, String> {
        let query = "
            SELECT id, text, duration_ms, audio_path, created_at
            FROM transcripts
            WHERE duration_ms >= ? AND duration_ms <= ?
            AND audio_path IS NOT NULL
            ORDER BY created_at DESC
            LIMIT 5
        ";

        let pool = self.database.get_pool();
        let rows = sqlx::query(query)
            .bind(min_duration_ms as i32)
            .bind(max_duration_ms as i32)
            .fetch_all(pool)
            .await
            .map_err(|e| format!("Database query failed: {}", e))?;

        let mut tests = Vec::new();
        for row in rows {
            let id: i64 = row.get("id");
            let text: String = row.get("text");
            let duration_ms: i32 = row.get("duration_ms");
            let audio_path: Option<String> = row.get("audio_path");

            if let Some(path) = audio_path {
                let audio_file = PathBuf::from(path.clone());

                // Check if file exists
                if audio_file.exists() {
                    let test = BenchmarkTest {
                        name: format!("{:?}_recording_{}", category, id),
                        audio_file,
                        expected_transcript: Some(text.clone()),
                        duration_ms: duration_ms as u32,
                        content_type: self.classify_content_type(&text),
                        recording_length_category: category.clone(),
                    };
                    tests.push(test);
                } else {
                    error(
                        Component::Processing,
                        &format!("❌ Audio file not found: {}", path),
                    );
                }
            }
        }

        info(
            Component::Processing,
            &format!("📊 Found {} {:?} recordings", tests.len(), category),
        );
        Ok(tests)
    }

    fn classify_content_type(&self, text: &str) -> ContentType {
        let lower_text = text.to_lowercase();

        // Simple heuristic-based classification
        if lower_text.contains("function")
            || lower_text.contains("variable")
            || lower_text.contains("api")
            || lower_text.contains("code")
            || lower_text.contains("rust")
            || lower_text.contains("javascript")
        {
            ContentType::Technical
        } else if lower_text.contains("hello")
            || lower_text.contains("how are you")
            || lower_text.contains("thanks")
            || lower_text.contains("yeah")
        {
            ContentType::Conversational
        } else if lower_text.chars().filter(|c| c.is_numeric()).count() > 3 {
            ContentType::Numbers
        } else if lower_text.len() > 100 {
            ContentType::Formal
        } else {
            ContentType::Mixed
        }
    }

    /// Create synthetic test cases for specific scenarios
    pub async fn create_synthetic_tests(&self) -> Result<Vec<BenchmarkTest>, String> {
        info(Component::Processing, "🧪 Creating synthetic test cases");

        let mut tests = Vec::new();

        // We'll create placeholder tests for now
        // TODO: Generate actual synthetic audio files
        tests.push(BenchmarkTest {
            name: "synthetic_short_command".to_string(),
            audio_file: PathBuf::from("test_data/synthetic_short.wav"),
            expected_transcript: Some("Save file".to_string()),
            duration_ms: 1000,
            content_type: ContentType::Conversational,
            recording_length_category: RecordingLength::UltraShort,
        });

        tests.push(BenchmarkTest {
            name: "synthetic_technical_medium".to_string(),
            audio_file: PathBuf::from("test_data/synthetic_technical.wav"),
            expected_transcript: Some(
                "Define a function called process data that takes a vector of integers".to_string(),
            ),
            duration_ms: 5000,
            content_type: ContentType::Technical,
            recording_length_category: RecordingLength::Short,
        });

        info(
            Component::Processing,
            &format!("🧪 Created {} synthetic test cases", tests.len()),
        );
        Ok(tests)
    }
}

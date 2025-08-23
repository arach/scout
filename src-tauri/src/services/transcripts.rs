use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;

use crate::db;
use crate::logger::Component;
use crate::monitoring::performance_tracker;

// Helper function to format duration
fn format_duration_ms(ms: i32) -> String {
    let seconds = ms / 1000;
    let minutes = seconds / 60;
    let remaining_seconds = seconds % 60;
    if minutes > 0 {
        format!("{}m {}s", minutes, remaining_seconds)
    } else {
        format!("{}s", seconds)
    }
}

pub struct TranscriptsService {
    pub database: Arc<db::Database>,
    pub performance_tracker: Arc<performance_tracker::PerformanceTracker>,
}

impl TranscriptsService {
    pub async fn get_recent_transcripts(&self, limit: i32) -> Result<Vec<db::Transcript>, String> {
        self.database.get_recent_transcripts(limit).await
    }

    pub async fn get_transcript(&self, transcript_id: i64) -> Result<Option<db::Transcript>, String> {
        self.database.get_transcript(transcript_id).await
    }

    // TranscriptWithAudioDetails is handled at the command layer
    // pub async fn get_transcript_with_audio_details(
    //     &self,
    //     transcript_id: i64,
    // ) -> Result<Option<super::transcripts::TranscriptWithAudioDetails>, String> {
    //     // This struct is defined in lib.rs; we'll keep a mirror here or return components.
    //     // For minimal change, we'll build the same struct in the command layer; here we just supply parts.
    //     Err("Use command layer to compose details".to_string())
    // }

    pub async fn search_transcripts(&self, query: String) -> Result<Vec<db::Transcript>, String> {
        self.database.search_transcripts(&query).await
    }

    pub async fn delete_transcript(&self, id: i64) -> Result<(), String> {
        self.database.delete_transcript(id).await
    }

    pub async fn delete_transcripts(&self, ids: Vec<i64>) -> Result<(), String> {
        self.database.delete_transcripts(&ids).await
    }

    pub fn export_transcripts_json(&self, transcripts: &[db::Transcript]) -> Result<String, String> {
        serde_json::to_string_pretty(transcripts).map_err(|e| format!("Failed to serialize to JSON: {}", e))
    }

    pub fn export_transcripts_markdown(&self, transcripts: &[db::Transcript]) -> Result<String, String> {
        let mut output = String::from("# Scout Transcripts\n\n");
        for transcript in transcripts {
            output.push_str(&format!(
                "## {}\n\n{}\n\n*Duration: {}*\n\n---\n\n",
                transcript.created_at,
                transcript.text,
                format_duration_ms(transcript.duration_ms)
            ));
        }
        Ok(output)
    }

    pub fn export_transcripts_text(&self, transcripts: &[db::Transcript]) -> Result<String, String> {
        let mut output = String::new();
        for transcript in transcripts {
            output.push_str(&format!(
                "[{}] ({}):\n{}\n\n",
                transcript.created_at,
                format_duration_ms(transcript.duration_ms),
                transcript.text
            ));
        }
        Ok(output)
    }

    pub fn export_audio_file(&self, source_path: &str, destination_path: &str) -> Result<(), String> {
        let source = Path::new(source_path);
        if !source.exists() {
            return Err("Source audio file not found".to_string());
        }
        std::fs::copy(source_path, destination_path).map_err(|e| format!("Failed to copy audio file: {}", e))?;
        Ok(())
    }
}


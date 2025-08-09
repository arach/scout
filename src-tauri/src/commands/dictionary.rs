use tauri::State;

use crate::db;
use crate::AppState;

#[tauri::command]
pub async fn get_dictionary_entries(state: State<'_, AppState>, enabled_only: bool) -> Result<Vec<db::DictionaryEntry>, String> {
    if enabled_only { state.database.get_enabled_dictionary_entries().await } else { state.database.get_all_dictionary_entries().await }
}

#[tauri::command]
pub async fn save_dictionary_entry(
    state: State<'_, AppState>,
    original_text: String,
    replacement_text: String,
    match_type: String,
    is_case_sensitive: bool,
    phonetic_pattern: Option<String>,
    category: Option<String>,
    description: Option<String>,
) -> Result<i64, String> {
    state
        .database
        .save_dictionary_entry(
            &original_text,
            &replacement_text,
            &match_type,
            is_case_sensitive,
            phonetic_pattern.as_deref(),
            category.as_deref(),
            description.as_deref(),
        )
        .await
}

#[tauri::command]
pub async fn update_dictionary_entry(
    state: State<'_, AppState>,
    id: i64,
    original_text: String,
    replacement_text: String,
    match_type: String,
    is_case_sensitive: bool,
    phonetic_pattern: Option<String>,
    category: Option<String>,
    description: Option<String>,
    enabled: bool,
) -> Result<(), String> {
    state
        .database
        .update_dictionary_entry(
            id,
            &original_text,
            &replacement_text,
            &match_type,
            is_case_sensitive,
            phonetic_pattern.as_deref(),
            category.as_deref(),
            description.as_deref(),
            enabled,
        )
        .await
}

#[tauri::command]
pub async fn delete_dictionary_entry(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    state.database.delete_dictionary_entry(id).await
}

#[tauri::command]
pub async fn get_dictionary_matches_for_transcript(state: State<'_, AppState>, transcript_id: i64) -> Result<Vec<serde_json::Value>, String> {
    state.database.get_dictionary_matches_for_transcript(transcript_id).await
}

#[tauri::command]
pub async fn test_dictionary_replacement(state: State<'_, AppState>, text: String) -> Result<String, String> {
    let dictionary_processor = crate::dictionary_processor::DictionaryProcessor::new(state.database.clone());
    let (processed_text, _matches) = dictionary_processor.process_transcript(&text, None).await?;
    Ok(processed_text)
}


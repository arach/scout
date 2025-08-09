use tauri::{Emitter, Manager, State};

use crate::db;
use crate::llm;
use crate::settings;
use crate::AppState;

#[tauri::command]
pub async fn get_available_llm_models(state: State<'_, AppState>) -> Result<Vec<llm::models::LLMModel>, String> {
    let models_dir = state.models_dir.join("llm");
    let settings = state.settings.lock().await;
    let active_model_id = &settings.get().llm.model_id;
    let model_manager = llm::models::ModelManager::new(models_dir);
    Ok(model_manager.list_models(active_model_id))
}

#[tauri::command]
pub async fn get_llm_model_info(state: State<'_, AppState>, model_id: String) -> Result<Option<llm::models::LLMModel>, String> {
    let models_dir = state.models_dir.join("llm");
    let model_manager = llm::models::ModelManager::new(models_dir);
    Ok(model_manager.list_models(&model_id).into_iter().find(|m| m.id == model_id))
}

#[tauri::command]
pub async fn download_llm_model(state: State<'_, AppState>, model_id: String, app: tauri::AppHandle) -> Result<(), String> {
    let models_dir = state.models_dir.join("llm");
    let model_manager = llm::models::ModelManager::new(models_dir);
    let models = model_manager.list_models(&model_id);
    let model = models
        .into_iter()
        .find(|m| m.id == model_id)
        .ok_or_else(|| format!("Model {} not found", model_id))?;
    model_manager
        .download_model_with_progress(&model, Some(&app))
        .await
        .map_err(|e| format!("Failed to download model: {}", e))?;
    app.emit("llm-model-downloaded", serde_json::json!({ "model_id": model_id }))
        .map_err(|e| format!("Failed to emit event: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn set_active_llm_model(state: State<'_, AppState>, model_id: String) -> Result<(), String> {
    let mut settings = state.settings.lock().await;
    settings
        .update(|s| s.llm.model_id = model_id.clone())
        .map_err(|e| format!("Failed to save settings: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn get_llm_outputs_for_transcript(state: State<'_, AppState>, transcript_id: i64) -> Result<Vec<db::LLMOutput>, String> {
    state.database.get_llm_outputs_for_transcript(transcript_id).await
}

#[tauri::command]
pub async fn get_whisper_logs_for_session(state: State<'_, AppState>, session_id: String, limit: Option<i32>) -> Result<Vec<serde_json::Value>, String> {
    state.database.get_whisper_logs_for_session(&session_id, limit).await
}

#[tauri::command]
pub async fn get_whisper_logs_for_transcript(state: State<'_, AppState>, transcript_id: i64, limit: Option<i32>) -> Result<Vec<serde_json::Value>, String> {
    state.database.get_whisper_logs_for_transcript(transcript_id, limit).await
}

#[tauri::command]
pub async fn get_llm_prompt_templates(state: State<'_, AppState>) -> Result<Vec<db::LLMPromptTemplate>, String> {
    state.database.get_llm_prompt_templates().await
}

#[tauri::command]
pub async fn save_llm_prompt_template(
    state: State<'_, AppState>,
    id: String,
    name: String,
    description: Option<String>,
    template: String,
    category: String,
    enabled: bool,
) -> Result<(), String> {
    state
        .database
        .save_llm_prompt_template(&id, &name, description.as_deref(), &template, &category, enabled)
        .await
}

#[tauri::command]
pub async fn delete_llm_prompt_template(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.database.delete_llm_prompt_template(&id).await
}

#[tauri::command]
pub async fn update_llm_settings(
    state: State<'_, AppState>,
    enabled: bool,
    model_id: String,
    temperature: f32,
    max_tokens: u32,
    enabled_prompts: Vec<String>,
) -> Result<(), String> {
    let mut settings = state.settings.lock().await;
    settings
        .update(|s| {
            s.llm.enabled = enabled;
            s.llm.model_id = model_id;
            s.llm.temperature = temperature;
            s.llm.max_tokens = max_tokens;
            s.llm.enabled_prompts = enabled_prompts;
        })
        .map_err(|e| format!("Failed to save settings: {}", e))?;
    Ok(())
}


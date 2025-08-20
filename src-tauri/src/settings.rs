use crate::logger::{error, Component};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppSettings {
    // Audio settings
    pub audio: AudioSettings,

    // Model settings
    pub models: ModelSettings,

    // UI settings
    pub ui: UISettings,

    // Processing settings
    pub processing: ProcessingSettings,

    // LLM settings
    pub llm: LLMSettings,
    
    // External service settings
    pub external_service: ExternalServiceConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AudioSettings {
    pub sample_rate: u32,
    pub channels: u16,
    pub buffer_size: usize,
    pub min_recording_duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ModelSettings {
    pub active_model_id: String,
    pub fallback_model_id: String,
    pub auto_download_models: Vec<String>,
    pub model_preferences: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct UISettings {
    pub hotkey: String,
    pub push_to_talk_hotkey: String,
    pub overlay_position: String,
    pub overlay_treatment: String,
    pub theme: String,
    pub sound_enabled: bool,
    pub start_sound: String,
    pub stop_sound: String,
    pub success_sound: String,
    pub completion_sound_threshold_ms: u64,
    pub auto_copy: bool,
    pub auto_paste: bool,
    pub profanity_filter_enabled: bool,
    pub profanity_filter_aggressive: bool,
    pub foundation_models_enabled: Option<bool>,
    pub foundation_models_mode: Option<String>,
    pub foundation_models_temperature: Option<f64>,
    pub foundation_models_aggressiveness: Option<String>,
    pub foundation_models_auto_processing: Option<String>,
    pub foundation_models_min_words: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ProcessingSettings {
    pub max_queue_size: usize,
    pub max_retries: u32,
    pub retry_delay_ms: u64,
    pub auto_cleanup_temp_files: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct LLMSettings {
    pub enabled: bool,
    pub model_id: String,
    pub temperature: f32,
    pub max_tokens: u32,
    pub auto_download_model: bool,
    pub enabled_prompts: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ExternalServiceConfig {
    pub enabled: bool,
    pub binary_path: Option<String>,
    pub use_zeromq: bool,
    pub zmq_push_port: u16,
    pub zmq_pull_port: u16,
    pub zmq_control_port: u16,
    pub workers: usize,
    pub model: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            audio: AudioSettings::default(),
            models: ModelSettings::default(),
            ui: UISettings::default(),
            processing: ProcessingSettings::default(),
            llm: LLMSettings::default(),
            external_service: ExternalServiceConfig::default(),
        }
    }
}

impl Default for AudioSettings {
    fn default() -> Self {
        Self {
            sample_rate: 16000,
            channels: 1,
            buffer_size: 1024,
            min_recording_duration_ms: 500,
        }
    }
}

impl Default for ModelSettings {
    fn default() -> Self {
        Self {
            active_model_id: "base.en".to_string(),
            fallback_model_id: "tiny.en".to_string(),
            auto_download_models: vec!["tiny.en".to_string(), "base.en".to_string()],
            model_preferences: serde_json::json!({}),
        }
    }
}

impl Default for UISettings {
    fn default() -> Self {
        Self {
            hotkey: "CmdOrCtrl+Shift+Space".to_string(),
            push_to_talk_hotkey: "CmdOrCtrl+Shift+P".to_string(),
            overlay_position: "top-center".to_string(),
            overlay_treatment: "particles".to_string(),
            theme: "dark".to_string(),
            sound_enabled: true,
            start_sound: "Glass".to_string(),
            stop_sound: "Glass".to_string(),
            success_sound: "Pop".to_string(),
            completion_sound_threshold_ms: 1000,
            auto_copy: false,
            auto_paste: false,
            profanity_filter_enabled: true,
            profanity_filter_aggressive: false,
            foundation_models_enabled: Some(false), // Disabled by default
            foundation_models_mode: Some("enhance".to_string()),
            foundation_models_temperature: Some(0.1),
            foundation_models_aggressiveness: Some("moderate".to_string()),
            foundation_models_auto_processing: Some("always".to_string()),
            foundation_models_min_words: Some(10),
        }
    }
}

impl Default for ProcessingSettings {
    fn default() -> Self {
        Self {
            max_queue_size: 100,
            max_retries: 30,
            retry_delay_ms: 100,
            auto_cleanup_temp_files: true,
        }
    }
}

impl Default for LLMSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            model_id: "tinyllama-1.1b".to_string(),
            temperature: 0.2,
            max_tokens: 500,
            auto_download_model: true,
            enabled_prompts: vec![
                "summarize".to_string(),
                "bullet_points".to_string(),
                "action_items".to_string(),
            ],
        }
    }
}

impl Default for ExternalServiceConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            binary_path: Some("scout-transcriber".to_string()),
            use_zeromq: true,
            zmq_push_port: 5555,
            zmq_pull_port: 5556,
            zmq_control_port: 5557,
            workers: 2,
            model: "whisper".to_string(),
        }
    }
}

pub struct SettingsManager {
    settings_path: PathBuf,
    settings: AppSettings,
}

impl SettingsManager {
    pub fn new(app_data_dir: &Path) -> Result<Self, String> {
        let settings_path = app_data_dir.join("settings.json");

        // Load settings or create default
        let settings = match fs::read_to_string(&settings_path) {
            Ok(contents) => serde_json::from_str(&contents).unwrap_or_else(|e| {
                error(
                    Component::UI,
                    &format!("Failed to parse settings.json: {}, using defaults", e),
                );
                AppSettings::default()
            }),
            Err(_) => {
                let default_settings = AppSettings::default();

                // Save default settings
                if let Ok(json) = serde_json::to_string_pretty(&default_settings) {
                    let _ = fs::write(&settings_path, json);
                }

                default_settings
            }
        };

        Ok(Self {
            settings_path,
            settings,
        })
    }

    pub fn get(&self) -> &AppSettings {
        &self.settings
    }

    pub fn update<F>(&mut self, updater: F) -> Result<(), String>
    where
        F: FnOnce(&mut AppSettings),
    {
        updater(&mut self.settings);
        self.save()
    }

    pub fn save(&self) -> Result<(), String> {
        crate::logger::info(crate::logger::Component::Settings, &format!("Saving settings to: {:?}", self.settings_path));
        crate::logger::info(crate::logger::Component::Settings, &format!("Current auto_copy: {}, auto_paste: {}", 
            self.settings.ui.auto_copy, self.settings.ui.auto_paste));
        
        let json = serde_json::to_string_pretty(&self.settings)
            .map_err(|e| format!("Failed to serialize settings: {}", e))?;

        fs::write(&self.settings_path, json)
            .map_err(|e| format!("Failed to save settings: {}", e))?;

        crate::logger::info(crate::logger::Component::Settings, "✅ Settings saved successfully");
        Ok(())
    }

    pub fn reload(&mut self) -> Result<(), String> {
        match fs::read_to_string(&self.settings_path) {
            Ok(contents) => {
                self.settings = serde_json::from_str(&contents)
                    .map_err(|e| format!("Failed to parse settings: {}", e))?;
                Ok(())
            }
            Err(e) => Err(format!("Failed to read settings: {}", e)),
        }
    }
}

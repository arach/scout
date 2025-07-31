use crate::logger::{warn, Component};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

// Simple beep/notification sounds using system commands
pub struct SoundPlayer;

static SOUND_ENABLED: OnceLock<bool> = OnceLock::new();
static START_SOUND: OnceLock<Mutex<String>> = OnceLock::new();
static STOP_SOUND: OnceLock<Mutex<String>> = OnceLock::new();
static SUCCESS_SOUND: OnceLock<Mutex<String>> = OnceLock::new();
// Cache resolved sound paths to avoid repeated file system checks
static SOUND_PATH_CACHE: OnceLock<Mutex<std::collections::HashMap<String, String>>> =
    OnceLock::new();

impl SoundPlayer {
    fn init_defaults() {
        let _ = START_SOUND.get_or_init(|| Mutex::new("Glass".to_string()));
        let _ = STOP_SOUND.get_or_init(|| Mutex::new("Glass".to_string()));
        let _ = SUCCESS_SOUND.get_or_init(|| Mutex::new("Pop".to_string())); // Pop is short and snappy
    }

    fn resolve_sound_path(sound_name: &str) -> String {
        // Check cache first
        let cache = SOUND_PATH_CACHE.get_or_init(|| Mutex::new(std::collections::HashMap::new()));
        if let Ok(cache_guard) = cache.lock() {
            if let Some(cached_path) = cache_guard.get(sound_name) {
                return cached_path.clone();
            }
        }

        let resolved_path = Self::resolve_sound_path_uncached(sound_name);

        // Store in cache
        if let Ok(mut cache_guard) = cache.lock() {
            cache_guard.insert(sound_name.to_string(), resolved_path.clone());
        }

        resolved_path
    }

    fn resolve_sound_path_uncached(sound_name: &str) -> String {
        // If it's already a full path, use it directly
        if sound_name.starts_with('/') {
            return sound_name.to_string();
        }

        // Check if it's a custom Scout sound
        if sound_name.starts_with("scout-") {
            // Try absolute path first (during development)
            let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));

            // When running from src-tauri, go up one directory
            let dev_path = if cwd.ends_with("src-tauri") {
                cwd.join("../src/assets/sounds/custom")
                    .join(format!("{}.wav", sound_name))
            } else {
                cwd.join("src/assets/sounds/custom")
                    .join(format!("{}.wav", sound_name))
            };

            // Try to canonicalize the path
            if let Ok(canonical_path) = dev_path.canonicalize() {
                if canonical_path.exists() {
                    return canonical_path.to_string_lossy().to_string();
                }
            }

            // Also try a direct path from project root
            let direct_path = PathBuf::from("/Users/arach/dev/scout/src/assets/sounds/custom")
                .join(format!("{}.wav", sound_name));

            if direct_path.exists() {
                return direct_path.to_string_lossy().to_string();
            }

            // Try relative to the binary location
            if let Ok(exe_path) = std::env::current_exe() {
                if let Some(exe_dir) = exe_path.parent() {
                    let relative_path = exe_dir
                        .join("../../../src/assets/sounds/custom")
                        .join(format!("{}.wav", sound_name));
                    if relative_path.exists() {
                        return relative_path.to_string_lossy().to_string();
                    }
                }
            }

            // Fallback to system sound
            warn(
                Component::UI,
                &format!(
                    "Custom sound {} not found, falling back to system sound",
                    sound_name
                ),
            );
            return "/System/Library/Sounds/Tink.aiff".to_string();
        }

        // Default to system sounds
        format!("/System/Library/Sounds/{}.aiff", sound_name)
    }

    /// Preload sounds on app startup to avoid first-play delays
    pub fn preload_sounds() {
        Self::init_defaults();

        // Resolve all sound paths to populate cache
        if let Some(start_sound_mutex) = START_SOUND.get() {
            if let Ok(start_sound) = start_sound_mutex.lock() {
                let _ = Self::resolve_sound_path(&start_sound);
            }
        }
        if let Some(stop_sound_mutex) = STOP_SOUND.get() {
            if let Ok(stop_sound) = stop_sound_mutex.lock() {
                let _ = Self::resolve_sound_path(&stop_sound);
            }
        }
        if let Some(success_sound_mutex) = SUCCESS_SOUND.get() {
            if let Ok(success_sound) = success_sound_mutex.lock() {
                let _ = Self::resolve_sound_path(&success_sound);
            }
        }

        // On macOS, do a silent pre-run of afplay to warm it up
        #[cfg(target_os = "macos")]
        {
            let _ = std::process::Command::new("afplay")
                .arg("-v")
                .arg("0") // Volume 0 for silent
                .arg("/System/Library/Sounds/Tink.aiff")
                .spawn();
        }
    }

    pub fn play_start() {
        if !Self::is_enabled() {
            return;
        }

        #[cfg(target_os = "macos")]
        {
            Self::init_defaults();
            if let Some(start_sound_mutex) = START_SOUND.get() {
                if let Ok(sound_name) = start_sound_mutex.lock() {
                    let sound_path = Self::resolve_sound_path(&sound_name);

                    let _ = std::process::Command::new("afplay")
                        .arg(&sound_path)
                        .spawn();
                }
            }
        }

        #[cfg(target_os = "windows")]
        {
            // Play a beep on Windows
            let _ = std::process::Command::new("powershell")
                .arg("-Command")
                .arg("[console]::beep(800, 200)")
                .spawn();
        }

        #[cfg(target_os = "linux")]
        {
            // Try to play a beep using paplay or beep command
            let _ = std::process::Command::new("paplay")
                .arg("/usr/share/sounds/freedesktop/stereo/message.oga")
                .spawn()
                .or_else(|_| {
                    std::process::Command::new("beep")
                        .arg("-f")
                        .arg("800")
                        .arg("-l")
                        .arg("200")
                        .spawn()
                });
        }
    }

    pub fn play_stop() {
        if !Self::is_enabled() {
            return;
        }

        #[cfg(target_os = "macos")]
        {
            Self::init_defaults();
            let sound_name = STOP_SOUND.get().unwrap().lock().unwrap();
            let sound_path = Self::resolve_sound_path(&sound_name);

            let _ = std::process::Command::new("afplay")
                .arg(&sound_path)
                .spawn();
        }

        #[cfg(target_os = "windows")]
        {
            // Play a lower beep on Windows
            let _ = std::process::Command::new("powershell")
                .arg("-Command")
                .arg("[console]::beep(600, 200)")
                .spawn();
        }

        #[cfg(target_os = "linux")]
        {
            // Try to play a completion sound
            let _ = std::process::Command::new("paplay")
                .arg("/usr/share/sounds/freedesktop/stereo/complete.oga")
                .spawn()
                .or_else(|_| {
                    std::process::Command::new("beep")
                        .arg("-f")
                        .arg("600")
                        .arg("-l")
                        .arg("200")
                        .spawn()
                });
        }
    }

    pub fn play_error() {
        if !Self::is_enabled() {
            return;
        }

        #[cfg(target_os = "macos")]
        {
            // Try custom error sound first
            let error_sound = Self::resolve_sound_path("scout-error");

            let _ = std::process::Command::new("afplay")
                .arg(&error_sound)
                .spawn();
        }

        #[cfg(target_os = "windows")]
        {
            // Play error beep pattern on Windows
            let _ = std::process::Command::new("powershell")
                .arg("-Command")
                .arg("[console]::beep(400, 300); [console]::beep(300, 300)")
                .spawn();
        }

        #[cfg(target_os = "linux")]
        {
            // Try to play an error sound
            let _ = std::process::Command::new("paplay")
                .arg("/usr/share/sounds/freedesktop/stereo/dialog-error.oga")
                .spawn()
                .or_else(|_| {
                    std::process::Command::new("beep")
                        .arg("-f")
                        .arg("400")
                        .arg("-l")
                        .arg("300")
                        .spawn()
                });
        }
    }

    pub fn play_success() {
        if !Self::is_enabled() {
            return;
        }

        #[cfg(target_os = "macos")]
        {
            Self::init_defaults();
            let sound_name = SUCCESS_SOUND.get().unwrap().lock().unwrap();
            let sound_path = Self::resolve_sound_path(&sound_name);

            let _ = std::process::Command::new("afplay")
                .arg(&sound_path)
                .spawn();
        }

        #[cfg(target_os = "windows")]
        {
            // Play success beep pattern on Windows
            let _ = std::process::Command::new("powershell")
                .arg("-Command")
                .arg("[console]::beep(1000, 150); [console]::beep(1200, 150)")
                .spawn();
        }

        #[cfg(target_os = "linux")]
        {
            // Try to play a success sound
            let _ = std::process::Command::new("paplay")
                .arg("/usr/share/sounds/freedesktop/stereo/complete.oga")
                .spawn()
                .or_else(|_| {
                    std::process::Command::new("beep")
                        .arg("-f")
                        .arg("1000")
                        .arg("-l")
                        .arg("150")
                        .spawn()
                });
        }
    }

    pub fn set_enabled(enabled: bool) {
        let _ = SOUND_ENABLED.set(enabled);
    }

    pub fn is_enabled() -> bool {
        *SOUND_ENABLED.get().unwrap_or(&true)
    }

    pub fn set_start_sound(sound_name: String) {
        Self::init_defaults();
        if let Ok(mut sound) = START_SOUND.get().unwrap().lock() {
            *sound = sound_name;
        }
    }

    pub fn set_stop_sound(sound_name: String) {
        Self::init_defaults();
        if let Ok(mut sound) = STOP_SOUND.get().unwrap().lock() {
            *sound = sound_name;
        }
    }

    pub fn set_success_sound(sound_name: String) {
        Self::init_defaults();
        if let Ok(mut sound) = SUCCESS_SOUND.get().unwrap().lock() {
            *sound = sound_name;
        }
    }

    pub fn get_start_sound() -> String {
        Self::init_defaults();
        START_SOUND.get().unwrap().lock().unwrap().clone()
    }

    pub fn get_stop_sound() -> String {
        Self::init_defaults();
        STOP_SOUND.get().unwrap().lock().unwrap().clone()
    }

    pub fn get_success_sound() -> String {
        Self::init_defaults();
        SUCCESS_SOUND.get().unwrap().lock().unwrap().clone()
    }

    pub async fn preview_sound_flow() {
        use tokio::time::{sleep, Duration};

        if !Self::is_enabled() {
            return;
        }

        // Play start sound
        Self::play_start();

        // Wait 1 second
        sleep(Duration::from_millis(1000)).await;

        // Play stop sound
        Self::play_stop();

        // Wait 0.5 seconds
        sleep(Duration::from_millis(500)).await;

        // Play success sound
        Self::play_success();
    }

    #[cfg(target_os = "macos")]
    pub fn get_available_sounds() -> Vec<String> {
        use std::fs;

        let mut sounds = Vec::new();

        // Add custom Scout sounds first
        sounds.push("scout-start".to_string());
        sounds.push("scout-stop".to_string());
        sounds.push("scout-error".to_string());
        sounds.push("scout-success".to_string());
        sounds.push("---".to_string()); // Separator

        // Add system sounds
        if let Ok(entries) = fs::read_dir("/System/Library/Sounds") {
            for entry in entries.flatten() {
                if let Some(filename) = entry.file_name().to_str() {
                    if filename.ends_with(".aiff") {
                        if let Some(name) = filename.strip_suffix(".aiff") {
                            sounds.push(name.to_string());
                        }
                    }
                }
            }
        }

        sounds
    }

    #[cfg(not(target_os = "macos"))]
    pub fn get_available_sounds() -> Vec<String> {
        // Return custom sounds for non-macOS platforms
        vec![
            "scout-start".to_string(),
            "scout-stop".to_string(),
            "scout-error".to_string(),
            "scout-success".to_string(),
        ]
    }
}

use std::sync::{OnceLock, Mutex};

// Simple beep/notification sounds using system commands
pub struct SoundPlayer;

static SOUND_ENABLED: OnceLock<bool> = OnceLock::new();
static START_SOUND: OnceLock<Mutex<String>> = OnceLock::new();
static STOP_SOUND: OnceLock<Mutex<String>> = OnceLock::new();

impl SoundPlayer {
    fn init_defaults() {
        let _ = START_SOUND.get_or_init(|| Mutex::new("Tink".to_string()));
        let _ = STOP_SOUND.get_or_init(|| Mutex::new("Pop".to_string()));
    }
    
    pub fn play_start() {
        if !Self::is_enabled() { return; }
        
        #[cfg(target_os = "macos")]
        {
            Self::init_defaults();
            let sound_path = START_SOUND.get().unwrap().lock().unwrap();
            
            // If it's a full path (starts with /), use it directly
            // Otherwise, treat it as a system sound name
            let sound_file = if sound_path.starts_with('/') {
                sound_path.clone()
            } else {
                format!("/System/Library/Sounds/{}.aiff", sound_path)
            };
            
            let _ = std::process::Command::new("afplay")
                .arg(&sound_file)
                .spawn();
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
                        .arg("-f").arg("800")
                        .arg("-l").arg("200")
                        .spawn()
                });
        }
    }
    
    pub fn play_stop() {
        if !Self::is_enabled() { return; }
        
        #[cfg(target_os = "macos")]
        {
            Self::init_defaults();
            let sound_path = STOP_SOUND.get().unwrap().lock().unwrap();
            
            // If it's a full path (starts with /), use it directly
            // Otherwise, treat it as a system sound name
            let sound_file = if sound_path.starts_with('/') {
                sound_path.clone()
            } else {
                format!("/System/Library/Sounds/{}.aiff", sound_path)
            };
            
            let _ = std::process::Command::new("afplay")
                .arg(&sound_file)
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
                        .arg("-f").arg("600")
                        .arg("-l").arg("200")
                        .spawn()
                });
        }
    }
    
    pub fn play_error() {
        if !Self::is_enabled() { return; }
        
        #[cfg(target_os = "macos")]
        {
            // Play error sound
            let _ = std::process::Command::new("afplay")
                .arg("/System/Library/Sounds/Sosumi.aiff")
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
                        .arg("-f").arg("400")
                        .arg("-l").arg("300")
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
    
    pub fn get_start_sound() -> String {
        Self::init_defaults();
        START_SOUND.get().unwrap().lock().unwrap().clone()
    }
    
    pub fn get_stop_sound() -> String {
        Self::init_defaults();
        STOP_SOUND.get().unwrap().lock().unwrap().clone()
    }
    
    #[cfg(target_os = "macos")]
    pub fn get_available_sounds() -> Vec<String> {
        use std::fs;
        
        let mut sounds = Vec::new();
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
        sounds.sort();
        sounds
    }
    
    #[cfg(not(target_os = "macos"))]
    pub fn get_available_sounds() -> Vec<String> {
        // Return empty for non-macOS platforms for now
        vec![]
    }
}
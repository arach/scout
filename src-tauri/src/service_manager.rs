use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use serde::{Serialize, Deserialize};
use crate::settings::ExternalServiceConfig;

const SERVICE_LABEL: &str = "com.scout.transcriber";
const PID_FILE: &str = "/tmp/transcriber.pid";

#[derive(Debug, Serialize)]
pub struct ServiceStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub healthy: bool,
    pub error: Option<String>,
}

/// Transcriber service configuration that gets written to JSON file
#[derive(Debug, Serialize, Deserialize)]
pub struct TranscriberConfig {
    pub workers: usize,
    pub model: String,
    pub use_zeromq: bool,
    pub zmq_push_port: u16,
    pub zmq_pull_port: u16,
    pub zmq_control_port: u16,
}

impl From<&ExternalServiceConfig> for TranscriberConfig {
    fn from(config: &ExternalServiceConfig) -> Self {
        Self {
            workers: config.workers,
            model: config.model.clone(),
            use_zeromq: config.use_zeromq,
            zmq_push_port: config.zmq_push_port,
            zmq_pull_port: config.zmq_pull_port,
            zmq_control_port: config.zmq_control_port,
        }
    }
}

pub struct ServiceManager;

impl ServiceManager {
    /// Get the path to the transcriber config directory
    fn config_dir() -> PathBuf {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("com.scout.transcriber")
    }
    
    /// Get the path to the transcriber config file
    fn config_path() -> PathBuf {
        Self::config_dir().join("config.json")
    }
    
    /// Write the transcriber configuration to a JSON file
    fn write_config(config: &ExternalServiceConfig) -> Result<(), String> {
        let config_dir = Self::config_dir();
        let config_path = Self::config_path();
        
        // Ensure the directory exists
        fs::create_dir_all(&config_dir)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
        
        // Convert to transcriber config format
        let transcriber_config = TranscriberConfig::from(config);
        
        // Write the config as JSON
        let json = serde_json::to_string_pretty(&transcriber_config)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;
        
        fs::write(&config_path, json)
            .map_err(|e| format!("Failed to write config file: {}", e))?;
        
        Ok(())
    }
    
    /// Generate launchd plist content for the transcriber service
    fn generate_plist(config: &ExternalServiceConfig) -> String {
        // Use transcriber as the binary name, with full path
        let binary_path = config.binary_path.as_ref()
            .map(|p| p.to_string())
            .unwrap_or_else(|| "/usr/local/bin/transcriber".to_string());
        
        // Simple plist - just run the transcriber binary
        // It will load its config from the default location
        let program_args = format!("        <string>{}</string>", binary_path);
        
        format!(r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{}</string>
    <key>ProgramArguments</key>
    <array>
{}
    </array>
    <key>RunAtLoad</key>
    <false/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>/tmp/transcriber.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/transcriber.error.log</string>
    <key>WorkingDirectory</key>
    <string>/Users/arach/dev/scout/transcriber</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/Users/arach/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
</dict>
</plist>"#, SERVICE_LABEL, program_args)
    }
    
    /// Get the path to the launchd plist file
    fn plist_path() -> PathBuf {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        PathBuf::from(home)
            .join("Library")
            .join("LaunchAgents")
            .join(format!("{}.plist", SERVICE_LABEL))
    }
    
    /// Start the transcriber service using launchctl
    pub async fn start_service(config: &ExternalServiceConfig) -> Result<String, String> {
        let plist_path = Self::plist_path();
        let config_path = Self::config_path();
        let mut output_log = Vec::new();
        
        // Write the config file
        Self::write_config(config)?;
        output_log.push(format!("✓ Wrote config to {}", config_path.display()));
        
        // Ensure LaunchAgents directory exists
        if let Some(parent) = plist_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create LaunchAgents directory: {}", e))?;
        }
        
        // Write the plist file
        let plist_content = Self::generate_plist(config);
        fs::write(&plist_path, plist_content)
            .map_err(|e| format!("Failed to write plist file: {}", e))?;
        output_log.push(format!("✓ Created launchd plist"));
        
        // Silently unload if already loaded
        let _ = Command::new("launchctl")
            .arg("unload")
            .arg(&plist_path)
            .output();
        
        // Load the service
        let output = Command::new("launchctl")
            .arg("load")
            .arg(&plist_path)
            .output()
            .map_err(|e| format!("Failed to run launchctl: {}", e))?;
        
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Failed to load service: {}", stderr.trim()));
        }
        
        // Start the service
        let _ = Command::new("launchctl")
            .arg("start")
            .arg(SERVICE_LABEL)
            .output();
        
        output_log.push(format!("✓ Started transcriber service"));
        
        // Wait a moment for the service to initialize
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        
        // Check the actual status
        let status = Self::check_status().await;
        if status.running {
            output_log.push(format!("✓ Service running (PID: {})", 
                status.pid.map_or("unknown".to_string(), |p| p.to_string())));
            
            if status.healthy {
                output_log.push(format!("✓ All ZeroMQ ports responding"));
                
                // Run a quick transcription test
                output_log.push("Running transcription test...".to_string());
                match Self::run_transcription_test().await {
                    Ok(result) => {
                        output_log.push(format!("✓ Transcription test successful: \"{}\"", result));
                    }
                    Err(e) => {
                        output_log.push(format!("⚠ Transcription test failed: {}", e));
                    }
                }
            } else {
                output_log.push(format!("⚠ Service running but ports not responding"));
                if let Some(error) = status.error {
                    output_log.push(format!("  Error: {}", error));
                }
            }
        } else {
            output_log.push(format!("⚠ Service not running - check /tmp/transcriber.error.log"));
        }
        
        Ok(output_log.join("\n"))
    }
    
    /// Run a quick transcription test using the test_audio.py script
    async fn run_transcription_test() -> Result<String, String> {
        use tokio::time::{timeout, Duration};
        
        // Check if test_audio.py exists
        let test_script = PathBuf::from("/Users/arach/dev/scout/transcriber/test_audio.py");
        if !test_script.exists() {
            return Err("test_audio.py not found".to_string());
        }
        
        // Run the test script with timeout
        let output_future = tokio::process::Command::new("uv")
            .arg("run")
            .arg("test_audio.py")
            .current_dir("/Users/arach/dev/scout/transcriber")
            .output();
            
        let output = timeout(Duration::from_secs(10), output_future)
            .await
            .map_err(|_| "Test timed out after 10 seconds".to_string())?
            .map_err(|e| format!("Failed to run test: {}", e))?;
        
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            // Extract the transcription result from the output
            if let Some(line) = stdout.lines().find(|l| l.contains("Transcription:")) {
                if let Some(result) = line.split(':').nth(1) {
                    return Ok(result.trim().to_string());
                }
            }
            Ok("Test completed".to_string())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!("Test failed: {}", stderr.trim()))
        }
    }
    
    /// Stop the transcriber service using launchctl
    pub async fn stop_service() -> Result<(), String> {
        let plist_path = Self::plist_path();
        
        // Stop the service
        let _ = Command::new("launchctl")
            .arg("stop")
            .arg(SERVICE_LABEL)
            .output();
        
        // Unload the service
        let output = Command::new("launchctl")
            .arg("unload")
            .arg(&plist_path)
            .output()
            .map_err(|e| format!("Failed to run launchctl: {}", e))?;
        
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            // Ignore "not loaded" errors
            if !stderr.contains("Could not find specified service") && !stderr.contains("No such file") {
                return Err(format!("Failed to unload service: {}", stderr));
            }
        }
        
        // Clean up PID file if it exists
        let _ = fs::remove_file(PID_FILE);
        
        Ok(())
    }
    
    /// Check if the service is running and get its status
    pub async fn check_status() -> ServiceStatus {
        let mut status = ServiceStatus {
            running: false,
            pid: None,
            healthy: false,
            error: None,
        };
        
        // Use launchctl list to check status
        let output = Command::new("sh")
            .arg("-c")
            .arg(format!("launchctl list | grep {}", SERVICE_LABEL))
            .output();
        
        if let Ok(output) = output {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                // Parse output: "PID Status Label" or "- Status Label" if not running
                let parts: Vec<&str> = stdout.split_whitespace().collect();
                if parts.len() >= 2 {
                    // First field is PID or "-"
                    if let Ok(pid) = parts[0].parse::<u32>() {
                        status.pid = Some(pid);
                        status.running = true;
                        
                        // Now check if ZeroMQ ports are actually listening
                        // This verifies the service is not just running but actually functional
                        let ports_healthy = Self::check_zeromq_ports().await;
                        status.healthy = ports_healthy;
                        
                        if !ports_healthy {
                            status.error = Some("Service running but ZeroMQ ports not responding".to_string());
                        }
                    }
                    // If first field is "-", service exited
                    // Second field is exit code
                }
            }
        }
        
        status
    }
    
    /// Check if ZeroMQ ports are listening
    async fn check_zeromq_ports() -> bool {
        use std::net::{TcpStream, SocketAddr};
        use std::time::Duration;
        
        let ports = [5555, 5556, 5557];
        let timeout = Duration::from_millis(500);
        
        for port in &ports {
            let addr_str = format!("127.0.0.1:{}", port);
            if let Ok(addr) = addr_str.parse::<SocketAddr>() {
                match TcpStream::connect_timeout(&addr, timeout) {
                    Ok(_) => {
                        // Port is open, connection succeeded
                        continue;
                    }
                    Err(_) => {
                        // Port is not accessible
                        return false;
                    }
                }
            } else {
                // Failed to parse address
                return false;
            }
        }
        
        // All ports are accessible
        true
    }
    
    /// Check if transcriber binary is installed
    pub async fn check_installed() -> bool {
        // Check if transcriber is in PATH
        let output = Command::new("which")
            .arg("transcriber")
            .output();
        
        if let Ok(output) = output {
            if output.status.success() {
                return true;
            }
        }
        
        // Check common installation paths
        let paths = [
            "/usr/local/bin/transcriber",
            "/opt/homebrew/bin/transcriber",
            "~/.local/bin/transcriber",
        ];
        
        for path in &paths {
            let expanded = shellexpand::tilde(path);
            if Path::new(expanded.as_ref()).exists() {
                return true;
            }
        }
        
        false
    }
}
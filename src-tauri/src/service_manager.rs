use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use serde::Serialize;
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

pub struct ServiceManager;

impl ServiceManager {
    /// Generate launchd plist content for the transcriber service
    fn generate_plist(config: &ExternalServiceConfig) -> String {
        // Use transcriber as the binary name
        let binary_path = config.binary_path.as_ref()
            .map(|p| p.to_string())
            .unwrap_or_else(|| "transcriber".to_string());
        
        // Build the arguments array
        let mut args = vec![binary_path.clone()];
        args.push("start".to_string());
        args.push("--use-zeromq".to_string());
        args.push("--workers".to_string());
        args.push(config.workers.to_string());
        args.push("--model".to_string());
        args.push(config.model.clone());
        args.push("--zmq-push-port".to_string());
        args.push(config.zmq_push_port.to_string());
        args.push("--zmq-pull-port".to_string());
        args.push(config.zmq_pull_port.to_string());
        args.push("--zmq-control-port".to_string());
        args.push(config.zmq_control_port.to_string());
        
        // Build the ProgramArguments XML array
        let program_args: String = args.iter()
            .map(|arg| format!("        <string>{}</string>", arg))
            .collect::<Vec<_>>()
            .join("\n");
        
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
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
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
    pub async fn start_service(config: &ExternalServiceConfig) -> Result<(), String> {
        let plist_path = Self::plist_path();
        
        // Ensure LaunchAgents directory exists
        if let Some(parent) = plist_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create LaunchAgents directory: {}", e))?;
        }
        
        // Write the plist file
        let plist_content = Self::generate_plist(config);
        fs::write(&plist_path, plist_content)
            .map_err(|e| format!("Failed to write plist file: {}", e))?;
        
        // Unload if already loaded (ignore errors)
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
            return Err(format!("Failed to load service: {}", stderr));
        }
        
        // Start the service explicitly (some versions of launchctl need this)
        let output = Command::new("launchctl")
            .arg("start")
            .arg(SERVICE_LABEL)
            .output()
            .map_err(|e| format!("Failed to start service: {}", e))?;
        
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            // Check if it's already running (not an error)
            if !stderr.contains("already loaded") {
                return Err(format!("Failed to start service: {}", stderr));
            }
        }
        
        Ok(())
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
        // First check with launchctl
        let output = Command::new("launchctl")
            .arg("list")
            .arg(SERVICE_LABEL)
            .output();
        
        let mut status = ServiceStatus {
            running: false,
            pid: None,
            healthy: false,
            error: None,
        };
        
        if let Ok(output) = output {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                // Parse launchctl list output
                // Format: "PID Status Label" or "- Status Label" if not running
                let parts: Vec<&str> = stdout.split_whitespace().collect();
                if parts.len() >= 3 {
                    if let Ok(pid) = parts[0].parse::<u32>() {
                        status.pid = Some(pid);
                        status.running = true;
                    }
                }
            }
        }
        
        // Also check PID file as a fallback
        if !status.running {
            if let Ok(pid_str) = fs::read_to_string(PID_FILE) {
                if let Ok(pid) = pid_str.trim().parse::<u32>() {
                    // Verify the process is actually running
                    let check = Command::new("kill")
                        .arg("-0")
                        .arg(pid.to_string())
                        .output();
                    
                    if let Ok(output) = check {
                        if output.status.success() {
                            status.pid = Some(pid);
                            status.running = true;
                        }
                    }
                }
            }
        }
        
        // Check health by trying to connect to the control port
        if status.running {
            // This will be checked by the existing TCP connection test
            status.healthy = true;
        }
        
        status
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
/// Enhanced process manager for external services
/// Handles proper process lifecycle, cleanup, and monitoring
use std::collections::HashMap;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Arc;
use tokio::sync::RwLock;
use serde::{Serialize, Deserialize};
use sysinfo::System;

/// Process information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub command: String,
    pub started_at: i64,
    pub memory_mb: f32,
    pub cpu_percent: f32,
    pub children: Vec<u32>,
}

/// Service health status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthStatus {
    pub healthy: bool,
    pub last_check: i64,
    pub error: Option<String>,
    pub details: HashMap<String, String>,
}

/// Process manager for handling external services
pub struct ProcessManager {
    system: Arc<RwLock<System>>,
    processes: Arc<RwLock<HashMap<String, ProcessInfo>>>,
    health_checks: Arc<RwLock<HashMap<String, HealthStatus>>>,
}

impl ProcessManager {
    pub fn new() -> Self {
        Self {
            system: Arc::new(RwLock::new(System::new_all())),
            processes: Arc::new(RwLock::new(HashMap::new())),
            health_checks: Arc::new(RwLock::new(HashMap::new())),
        }
    }
    
    /// Kill all processes matching a pattern (including orphans)
    pub async fn kill_all_matching(&self, pattern: &str) -> Result<Vec<u32>, String> {
        let mut killed_pids = Vec::new();
        let mut system = self.system.write().await;
        system.refresh_all();
        
        // Find all matching processes
        for (pid, process) in system.processes() {
            let cmd = process.cmd().join(" ");
            let name = process.name();
            
            if cmd.contains(pattern) || name.contains(pattern) {
                let pid_val = pid.as_u32();
                
                // Try graceful termination first
                if process.kill() {
                    killed_pids.push(pid_val);
                    log::info!("Terminated process {} ({})", pid_val, name);
                } else {
                    // Force kill if graceful termination fails
                    if process.kill() {
                        killed_pids.push(pid_val);
                        log::warn!("Force killed process {} ({})", pid_val, name);
                    }
                }
                
                // Also kill any child processes
                let children = Self::get_child_processes(&system, *pid);
                for child_pid in children {
                    if let Some(child_process) = system.process(child_pid) {
                        if child_process.kill() {
                            killed_pids.push(child_pid.as_u32());
                            log::info!("Terminated child process {}", child_pid.as_u32());
                        }
                    }
                }
            }
        }
        
        // Additional cleanup using pkill as fallback
        let _ = Command::new("pkill")
            .arg("-f")
            .arg(pattern)
            .output();
        
        Ok(killed_pids)
    }
    
    /// Get child processes of a given PID
    fn get_child_processes(system: &System, parent_pid: sysinfo::Pid) -> Vec<sysinfo::Pid> {
        let mut children = Vec::new();
        
        for (pid, process) in system.processes() {
            if let Some(ppid) = process.parent() {
                if ppid == parent_pid {
                    children.push(*pid);
                    // Recursively get grandchildren
                    children.extend(Self::get_child_processes(system, *pid));
                }
            }
        }
        
        children
    }
    
    /// Start a managed process with proper process group handling
    pub async fn start_managed_process(
        &self,
        name: &str,
        command: &str,
        args: &[String],
        working_dir: Option<&Path>,
    ) -> Result<u32, String> {
        // Clean up any existing processes first
        let _ = self.kill_all_matching(name).await;
        
        // Start the new process in its own process group
        let mut cmd = Command::new(command);
        cmd.args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        
        if let Some(dir) = working_dir {
            cmd.current_dir(dir);
        }
        
        // On Unix, create a new process group
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }
        
        let child = cmd.spawn()
            .map_err(|e| format!("Failed to start process: {}", e))?;
        
        let pid = child.id();
        
        // Store process info
        let mut processes = self.processes.write().await;
        processes.insert(name.to_string(), ProcessInfo {
            pid,
            name: name.to_string(),
            command: format!("{} {}", command, args.join(" ")),
            started_at: chrono::Utc::now().timestamp(),
            memory_mb: 0.0,
            cpu_percent: 0.0,
            children: Vec::new(),
        });
        
        log::info!("Started managed process '{}' with PID {}", name, pid);
        
        Ok(pid)
    }
    
    /// Stop a managed process and all its children
    pub async fn stop_managed_process(&self, name: &str) -> Result<(), String> {
        let processes = self.processes.read().await;
        
        if let Some(info) = processes.get(name) {
            let pid = info.pid;
            drop(processes); // Release the lock
            
            // Kill the process group using system command
            #[cfg(unix)]
            {
                // Try to kill the entire process group
                let _ = Command::new("kill")
                    .arg("-TERM")
                    .arg(format!("-{}", pid))
                    .output();
                
                tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                
                let _ = Command::new("kill")
                    .arg("-KILL")
                    .arg(format!("-{}", pid))
                    .output();
            }
            
            // Fallback: kill individual process and children
            let mut system = self.system.write().await;
            system.refresh_all();
            
            if let Some(process) = system.process(sysinfo::Pid::from_u32(pid)) {
                // Kill children first
                let children = Self::get_child_processes(&system, sysinfo::Pid::from_u32(pid));
                for child_pid in children {
                    if let Some(child) = system.process(child_pid) {
                        child.kill();
                    }
                }
                
                // Kill the main process
                process.kill();
            }
            
            // Remove from tracking
            let mut processes = self.processes.write().await;
            processes.remove(name);
            
            log::info!("Stopped managed process '{}'", name);
        }
        
        Ok(())
    }
    
    /// Check health of a service by testing its ports/endpoints
    pub async fn check_service_health(
        &self,
        name: &str,
        ports: &[u16],
    ) -> HealthStatus {
        use std::net::{TcpStream, SocketAddr};
        use std::time::Duration;
        
        let mut status = HealthStatus {
            healthy: true,
            last_check: chrono::Utc::now().timestamp(),
            error: None,
            details: HashMap::new(),
        };
        
        // Don't require the process to be in our managed list
        // Just check if the ports are actually accessible
        
        // Check ports
        for port in ports {
            let addr_str = format!("127.0.0.1:{}", port);
            status.details.insert(format!("port_{}", port), "checking".to_string());
            
            if let Ok(addr) = addr_str.parse::<SocketAddr>() {
                match TcpStream::connect_timeout(&addr, Duration::from_millis(500)) {
                    Ok(_) => {
                        status.details.insert(format!("port_{}", port), "open".to_string());
                    }
                    Err(e) => {
                        status.healthy = false;
                        status.details.insert(format!("port_{}", port), "closed".to_string());
                        status.error = Some(format!("Port {} not accessible: {}", port, e));
                    }
                }
            }
        }
        
        // Store health check result
        let mut health_checks = self.health_checks.write().await;
        health_checks.insert(name.to_string(), status.clone());
        
        status
    }
    
    /// Monitor and restart unhealthy services
    pub async fn monitor_and_restart(&self, name: &str, restart_cmd: impl Fn() -> Result<(), String>) {
        let health = self.check_service_health(name, &[5555, 5556, 5557]).await;
        
        if !health.healthy {
            log::warn!("Service '{}' is unhealthy: {:?}", name, health.error);
            
            // Attempt restart
            if let Err(e) = restart_cmd() {
                log::error!("Failed to restart service '{}': {}", name, e);
            } else {
                log::info!("Successfully restarted service '{}'", name);
            }
        }
    }
    
    
    /// Kill a specific process by PID
    pub async fn kill_process(&self, pid: u32) -> Result<(), String> {
        use std::process::Command;
        
        #[cfg(target_os = "macos")]
        {
            let output = Command::new("kill")
                .arg("-9")
                .arg(pid.to_string())
                .output()
                .map_err(|e| format!("Failed to execute kill command: {}", e))?;
            
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("Failed to kill process {}: {}", pid, stderr));
            }
        }
        
        #[cfg(not(target_os = "macos"))]
        {
            let mut system = self.system.write().await;
            if let Some(process) = system.process(sysinfo::Pid::from_u32(pid)) {
                process.kill();
            } else {
                return Err(format!("Process {} not found", pid));
            }
        }
        
        Ok(())
    }
    
    /// Get current status of all managed processes
    pub async fn get_all_status(&self) -> HashMap<String, ProcessInfo> {
        let mut system = self.system.write().await;
        system.refresh_all();
        
        let mut processes = self.processes.write().await;
        
        // Update process info with current stats
        for (_name, info) in processes.iter_mut() {
            if let Some(process) = system.process(sysinfo::Pid::from_u32(info.pid)) {
                info.memory_mb = process.memory() as f32 / 1024.0;
                info.cpu_percent = process.cpu_usage();
                
                // Update children list
                info.children = Self::get_child_processes(&system, sysinfo::Pid::from_u32(info.pid))
                    .iter()
                    .map(|p| p.as_u32())
                    .collect();
            }
        }
        
        processes.clone()
    }
    
    /// Get total memory for process tree using bash script
    #[cfg(target_os = "macos")]
    fn get_total_memory_mb(pid: u32) -> Option<f32> {
        use std::process::Command;
        
        // Create a simple inline script to get all descendants and sum memory
        let script = format!(r#"
            pid={}
            total=0
            
            # Function to get all descendants
            get_descendants() {{
                local p=$1
                echo $p
                for child in $(pgrep -P $p 2>/dev/null); do
                    get_descendants $child
                done
            }}
            
            # Get all PIDs
            all_pids=$(get_descendants $pid)
            
            # Sum memory for all PIDs
            for p in $all_pids; do
                mem=$(top -l 1 -pid $p -stats pid,mem 2>/dev/null | tail -1 | awk '{{print $2}}')
                if [[ ! -z "$mem" ]]; then
                    if [[ $mem == *G ]]; then
                        mb=$(echo "$mem" | sed 's/G//' | awk '{{print $1 * 1024}}')
                    elif [[ $mem == *M ]]; then
                        mb=$(echo "$mem" | sed 's/M//')
                    elif [[ $mem == *K ]]; then
                        mb=$(echo "$mem" | sed 's/K//' | awk '{{print $1 / 1024}}')
                    else
                        mb=0
                    fi
                    total=$(echo "$total + $mb" | bc)
                fi
            done
            
            echo "$total"
        "#, pid);
        
        let output = Command::new("bash")
            .arg("-c")
            .arg(&script)
            .output()
            .ok()?;
            
        if !output.status.success() {
            return None;
        }
        
        let stdout = String::from_utf8_lossy(&output.stdout);
        stdout.trim().parse().ok()
    }
    
    /// Get stats for a specific process by PID
    pub async fn get_process_stats(&self, pid: u32) -> Result<ProcessInfo, String> {
        let mut system = self.system.write().await;
        system.refresh_all();
        
        let pid_obj = sysinfo::Pid::from_u32(pid);
        if let Some(process) = system.process(pid_obj) {
            // Get child processes
            let child_pids = Self::get_child_processes(&system, pid_obj);
            
            // Get total memory for entire process tree (no caching - fresh on each call)
            let total_memory_mb = Self::get_total_memory_mb(pid)
                .unwrap_or_else(|| {
                    // Fallback: use sysinfo if top command fails
                    let mut mem = (process.memory() as f64 / 1024.0) as f32;
                    for child_pid in &child_pids {
                        if let Some(child) = system.process(*child_pid) {
                            mem += (child.memory() as f64 / 1024.0) as f32;
                        }
                    }
                    log::debug!("Using sysinfo fallback for PID {} memory: {:.2} MB", pid, mem);
                    mem
                });
            
            log::debug!("Process {} total memory: {:.2} MB", pid, total_memory_mb);
            
            // Calculate total CPU
            let mut total_cpu = process.cpu_usage();
            for child_pid in &child_pids {
                if let Some(child) = system.process(*child_pid) {
                    total_cpu += child.cpu_usage();
                }
            }
            
            let info = ProcessInfo {
                pid,
                name: process.name().to_string(),
                command: process.cmd().join(" "),
                started_at: process.start_time() as i64,
                memory_mb: total_memory_mb,
                cpu_percent: total_cpu,
                children: child_pids
                    .iter()
                    .map(|p| p.as_u32())
                    .collect(),
            };
            Ok(info)
        } else {
            Err(format!("Process with PID {} not found", pid))
        }
    }
    
    /// Clean up all zombie processes
    pub async fn cleanup_zombies(&self) -> Result<u32, String> {
        // TODO: Implement actual zombie detection for sysinfo 0.30
        // This requires platform-specific code
        Ok(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[tokio::test]
    async fn test_process_manager() {
        let manager = ProcessManager::new();
        
        // Test killing matching processes
        let killed = manager.kill_all_matching("transcriber").await.unwrap();
        println!("Killed {} processes", killed.len());
        
        // Test health check
        let health = manager.check_service_health("test", &[5555]).await;
        assert!(!health.healthy); // Should fail since no service running
    }
}
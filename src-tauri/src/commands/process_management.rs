use crate::services::{ServiceManager, ProcessManager, control_plane_monitor};
use crate::AppState;
use serde_json::json;
use tauri::State;

/// Kill all orphaned transcriber processes
#[tauri::command]
pub async fn kill_orphaned_processes() -> Result<String, String> {
    log::info!("Killing orphaned processes");
    
    let manager = ProcessManager::new();
    
    // Kill transcriber processes
    let mut total_killed = 0;
    let killed_transcriber = manager.kill_all_matching("transcriber").await?;
    total_killed += killed_transcriber.len();
    
    // Kill Python worker processes
    let killed_python = manager.kill_all_matching("zmq_server_worker").await?;
    total_killed += killed_python.len();
    
    // Kill any whisper-related processes
    let killed_whisper = manager.kill_all_matching("whisper").await?;
    total_killed += killed_whisper.len();
    
    // Clean up zombies
    let zombies = manager.cleanup_zombies().await?;
    
    Ok(format!(
        "Cleaned up {} processes ({} transcriber, {} Python workers, {} whisper, {} zombies)",
        total_killed + zombies as usize,
        killed_transcriber.len(),
        killed_python.len(),
        killed_whisper.len(),
        zombies
    ))
}

/// Get detailed process information
#[tauri::command]
pub async fn get_process_status() -> Result<serde_json::Value, String> {
    let manager = ProcessManager::new();
    let processes = manager.get_all_status().await;
    
    let mut result = Vec::new();
    for (name, info) in processes {
        result.push(json!({
            "name": name,
            "pid": info.pid,
            "command": info.command,
            "memory_mb": info.memory_mb,
            "cpu_percent": info.cpu_percent,
            "children": info.children,
            "started_at": info.started_at,
        }));
    }
    
    Ok(json!({
        "processes": result,
        "count": result.len(),
        "timestamp": chrono::Utc::now().timestamp(),
    }))
}

/// Check health of external services
#[tauri::command]
pub async fn check_service_health() -> Result<serde_json::Value, String> {
    // Get launchctl status first
    let service_status = ServiceManager::check_status().await;
    
    // Get process stats if service is running
    let mut process_stats = None;
    if let Some(pid) = service_status.pid {
        let manager = ProcessManager::new();
        process_stats = manager.get_process_stats(pid).await.ok();
    }
    
    // Check port binding status using lsof
    let mut port_details = std::collections::HashMap::new();
    let ports = [5555, 5556, 5557];
    
    for port in &ports {
        // Use lsof to check if port is bound
        let output = std::process::Command::new("lsof")
            .arg("-i")
            .arg(format!(":{}", port))
            .output();
        
        let status = if let Ok(output) = output {
            if output.status.success() && !output.stdout.is_empty() {
                "listening".to_string()
            } else {
                "not bound".to_string()
            }
        } else {
            "unknown".to_string()
        };
        
        port_details.insert(format!("port_{}", port), status);
    }
    
    // Get control plane health information
    let control_plane_health = if let Some(monitor) = control_plane_monitor::get_control_plane_monitor().await {
        let health = monitor.get_health().await;
        json!({
            "connected": true,
            "is_healthy": health.is_healthy,
            "last_heartbeat_seconds_ago": health.last_heartbeat_seconds_ago,
            "messages_processed": health.messages_processed,
            "errors": health.errors,
            "uptime_seconds": health.uptime_seconds,
            "worker_id": health.worker_id,
            "last_error": health.last_error,
        })
    } else {
        json!({
            "connected": false,
            "error": "Control plane monitor not initialized"
        })
    };
    
    // Determine overall health based on multiple factors
    let all_ports_listening = port_details.values().all(|s| s == "listening");
    let control_plane_healthy = control_plane_health["is_healthy"].as_bool().unwrap_or(false);
    
    // Service is healthy if:
    // 1. LaunchCtl says it's running AND
    // 2. All ports are bound AND  
    // 3. Control plane is receiving heartbeats (if available)
    let healthy = service_status.running && all_ports_listening && 
        (control_plane_healthy || !control_plane_health["connected"].as_bool().unwrap_or(false));
    
    let error = if !service_status.running {
        Some("Service not running".to_string())
    } else if !all_ports_listening {
        Some("Some ports are not bound".to_string())
    } else if control_plane_health["connected"].as_bool().unwrap_or(false) && !control_plane_healthy {
        Some("Worker not sending heartbeats".to_string())
    } else {
        None
    };
    
    Ok(json!({
        "transcriber": {
            "healthy": healthy,
            "error": error,
            "details": port_details,
            "last_check": chrono::Utc::now().timestamp(),
        },
        "launchctl": {
            "running": service_status.running,
            "pid": service_status.pid,
            "healthy": service_status.healthy,
            "error": service_status.error,
        },
        "process_stats": process_stats,
        "control_plane": control_plane_health,
        "timestamp": chrono::Utc::now().timestamp(),
    }))
}

/// Get control plane status
#[tauri::command]
pub async fn get_control_plane_status() -> Result<serde_json::Value, String> {
    if let Some(monitor) = control_plane_monitor::get_control_plane_monitor().await {
        let health = monitor.get_health().await;
        let history = monitor.get_status_history().await;
        
        // Get recent status counts
        let mut status_counts = std::collections::HashMap::new();
        for msg in &history {
            *status_counts.entry(msg.status.status_type.clone()).or_insert(0) += 1;
        }
        
        Ok(json!({
            "connected": true,
            "health": {
                "is_healthy": health.is_healthy,
                "last_heartbeat_seconds_ago": health.last_heartbeat_seconds_ago,
                "messages_processed": health.messages_processed,
                "errors": health.errors,
                "uptime_seconds": health.uptime_seconds,
                "worker_id": health.worker_id,
                "last_error": health.last_error,
            },
            "recent_statuses": status_counts,
            "history_count": history.len(),
        }))
    } else {
        Ok(json!({
            "connected": false,
            "error": "Control plane monitor not initialized"
        }))
    }
}

/// Restart unhealthy services
#[tauri::command]
pub async fn restart_unhealthy_services(state: State<'_, AppState>) -> Result<String, String> {
    let manager = ProcessManager::new();
    let health = manager.check_service_health("transcriber", &[5555, 5556, 5557]).await;
    
    if !health.healthy {
        log::warn!("Service unhealthy, restarting: {:?}", health.error);
        
        // Stop the service completely
        ServiceManager::stop_service().await?;
        
        // Wait a moment
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        
        // Get current config from settings
        let settings = state.settings.lock().await;
        let config = settings.get().external_service.clone();
        drop(settings);
        
        // Start the service
        let result = ServiceManager::start_service(&config).await?;
        
        Ok(format!("Service restarted: {}", result))
    } else {
        Ok("Service is healthy, no restart needed".to_string())
    }
}
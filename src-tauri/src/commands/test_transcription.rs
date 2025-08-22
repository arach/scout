use serde_json::json;
use tauri::State;
use crate::AppState;
use std::time::{SystemTime, UNIX_EPOCH};

/// Generate a simple test audio file (3 seconds of speech-like audio)
fn generate_test_audio() -> Vec<f32> {
    const SAMPLE_RATE: f32 = 16000.0;
    const DURATION_SECS: f32 = 3.0;
    
    let num_samples = (SAMPLE_RATE * DURATION_SECS) as usize;
    let mut samples = Vec::with_capacity(num_samples);
    
    // Generate a more speech-like waveform similar to the Python test
    for i in 0..num_samples {
        let t = i as f32 / SAMPLE_RATE;
        
        // Varying pitch to simulate speech (85-255 Hz is typical for speech)
        let fundamental = 120.0 + 50.0 * (2.0 * std::f32::consts::PI * 0.5 * t).sin();
        
        // Simple approximation of the phase accumulation
        let phase = 2.0 * std::f32::consts::PI * fundamental * t;
        
        // Add harmonics
        let mut sample = phase.sin();
        sample += 0.5 * (2.0 * phase).sin();  // Second harmonic
        sample += 0.3 * (3.0 * phase).sin();  // Third harmonic
        
        // Add envelope to simulate words/syllables
        let envelope = 0.5 + 0.5 * (2.0 * std::f32::consts::PI * 3.0 * t).sin();
        sample *= envelope;
        
        // Normalize
        sample *= 0.3;
        
        samples.push(sample);
    }
    
    samples
}

#[tauri::command]
pub async fn test_external_service_with_audio(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    // Get service configuration
    let settings = state.settings.lock().await;
    let external_config = settings.get().external_service.clone();
    drop(settings);
    
    if !external_config.enabled {
        return Ok(json!({
            "success": false,
            "message": "External service is not enabled"
        }));
    }
    
    // Initialize ZeroMQ context
    let ctx = zmq::Context::new();
    
    // Connect to the transcriber service
    let push_socket = ctx.socket(zmq::PUSH).map_err(|e| format!("Failed to create push socket: {}", e))?;
    let pull_socket = ctx.socket(zmq::PULL).map_err(|e| format!("Failed to create pull socket: {}", e))?;
    
    // Set socket timeouts
    push_socket.set_sndtimeo(5000).map_err(|e| format!("Failed to set send timeout: {}", e))?;
    pull_socket.set_rcvtimeo(10000).map_err(|e| format!("Failed to set receive timeout: {}", e))?;
    
    // Connect to service endpoints (note: connect, not bind)
    let push_endpoint = format!("tcp://127.0.0.1:{}", external_config.zmq_push_port);
    let pull_endpoint = format!("tcp://127.0.0.1:{}", external_config.zmq_pull_port);
    
    push_socket.connect(&push_endpoint).map_err(|e| format!("Failed to connect to push endpoint {}: {}", push_endpoint, e))?;
    pull_socket.connect(&pull_endpoint).map_err(|e| format!("Failed to connect to pull endpoint {}: {}", pull_endpoint, e))?;
    
    // Generate test audio
    let audio_data = generate_test_audio();
    
    // Create chunk ID (UUID as bytes)
    let chunk_id = uuid::Uuid::new_v4();
    
    // Get current timestamp
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("Time error: {}", e))?
        .as_secs_f64();
    
    // Create the message structure exactly as Python expects
    // Using serde_json::Value to build the structure, then serialize to MessagePack
    let audio_chunk = json!({
        "id": chunk_id.as_bytes().to_vec(),
        "audio": audio_data,
        "sample_rate": 16000,
        "timestamp": timestamp,
    });
    
    let queue_item = json!({
        "data": audio_chunk,
        "priority": 0,
        "timestamp": timestamp,
    });
    
    // Serialize to MessagePack
    let message = rmp_serde::to_vec(&queue_item).map_err(|e| format!("Failed to serialize message: {}", e))?;
    
    // Send audio to transcriber
    push_socket.send(&message, 0).map_err(|e| format!("Failed to send audio: {}", e))?;
    
    // Wait for transcription result
    match pull_socket.recv_msg(0) {
        Ok(msg) => {
            // The result should be MessagePack encoded
            // It will be either {"Ok": transcript} or {"Err": error}
            let result: serde_json::Value = rmp_serde::from_slice(&msg)
                .map_err(|e| format!("Failed to deserialize response: {}", e))?;
            
            if let Some(ok_value) = result.get("Ok") {
                // Extract transcript fields
                let text = ok_value.get("text")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                    
                let confidence = ok_value.get("confidence")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0) as f32;
                    
                let empty_metadata = json!({});
                let metadata = ok_value.get("metadata")
                    .unwrap_or(&empty_metadata);
                    
                let processing_time_ms = metadata.get("processing_time_ms")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0);
                    
                let worker_id = metadata.get("worker_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                    
                let model = metadata.get("model")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| external_config.model.clone());
                
                Ok(json!({
                    "success": true,
                    "message": "Test transcription successful!",
                    "transcription": text,
                    "details": {
                        "audio_duration": "3.0 seconds",
                        "sample_rate": 16000,
                        "confidence": confidence,
                        "processing_time_ms": processing_time_ms,
                        "worker_id": worker_id,
                        "model": model,
                        "service": "external"
                    }
                }))
            } else if let Some(err_value) = result.get("Err") {
                Ok(json!({
                    "success": false,
                    "message": format!("Transcription error: {:?}", err_value)
                }))
            } else {
                Ok(json!({
                    "success": false,
                    "message": format!("Unknown response format: {:?}", result)
                }))
            }
        }
        Err(e) => {
            // If timeout or connection error, provide helpful message
            if e == zmq::Error::EAGAIN {
                Ok(json!({
                    "success": false,
                    "message": "Timeout waiting for transcription. The service may be busy or not processing messages correctly."
                }))
            } else {
                Ok(json!({
                    "success": false,
                    "message": format!("Failed to receive transcription: {}", e)
                }))
            }
        }
    }
}
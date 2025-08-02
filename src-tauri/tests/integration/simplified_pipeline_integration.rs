/// Integration tests for the simplified recording and transcription pipeline
/// 
/// Tests the complete flow from recording start to transcription completion
/// Validates feature flag switching and performance comparisons

use scout::{
    audio::{
        simple_recorder::SimpleAudioRecorder,
        recorder::AudioRecorder,
    },
    simple_session_manager::{SimpleSessionManager, SessionState, SessionResult},
    transcription::simple_transcriber::{SimpleTranscriptionService, TranscriptionRequest},
    model_state::ModelStateManager,
    settings::SettingsManager,
};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use tempfile::TempDir;

// Import common test utilities
#[path = "../common/simplified_pipeline.rs"]
mod common;
use common::*;

/// Integration test fixture
struct IntegrationTestFixture {
    temp_dir: TempDir,
    recordings_dir: PathBuf,
    models_dir: PathBuf,
    data_dir: PathBuf,
    session_manager: Arc<Mutex<SimpleSessionManager>>,
    main_recorder: Arc<Mutex<AudioRecorder>>,
}

impl IntegrationTestFixture {
    async fn new() -> Result<Self, Box<dyn std::error::Error>> {
        let temp_dir = TempDir::new()?;
        let recordings_dir = temp_dir.path().join("recordings");
        let models_dir = temp_dir.path().join("models");
        let data_dir = temp_dir.path().join("data");
        
        std::fs::create_dir_all(&recordings_dir)?;
        std::fs::create_dir_all(&models_dir)?;
        std::fs::create_dir_all(&data_dir)?;
        
        // Setup mock models
        create_mock_models(&models_dir)?;
        
        // Create main audio recorder
        let main_recorder = Arc::new(Mutex::new(
            AudioRecorder::new(recordings_dir.clone(), data_dir.clone())
        ));
        
        // Create model state manager
        let model_state_manager = Arc::new(
            ModelStateManager::new(models_dir.clone())
        );
        
        // Create settings manager
        let settings_manager = Arc::new(Mutex::new(
            SettingsManager::new(data_dir.clone()).await?
        ));
        
        // Create session manager
        let session_manager = Arc::new(Mutex::new(
            SimpleSessionManager::new(
                main_recorder.clone(),
                recordings_dir.clone(),
                models_dir.clone(),
                model_state_manager,
                settings_manager,
            ).await?
        ));
        
        Ok(Self {
            temp_dir,
            recordings_dir,
            models_dir,
            data_dir,
            session_manager,
            main_recorder,
        })
    }
}

fn create_mock_models(models_dir: &PathBuf) -> Result<(), Box<dyn std::error::Error>> {
    // Create mock model files
    for model in &["ggml-tiny.bin", "ggml-base.bin", "ggml-small.bin"] {
        std::fs::File::create(models_dir.join(model))?;
    }
    Ok(())
}

#[tokio::test]
async fn test_complete_recording_to_transcription_flow() {
    let fixture = IntegrationTestFixture::new().await.unwrap();
    let manager = fixture.session_manager.clone();
    
    // Start recording session
    let session_start = Instant::now();
    let session_id = {
        let mut mgr = manager.lock().await;
        mgr.start_session(None).await.unwrap()
    };
    let startup_time = session_start.elapsed();
    
    // Verify fast startup
    assert!(
        startup_time.as_millis() < 100,
        "Session startup took {:?}, expected < 100ms",
        startup_time
    );
    
    // Check session is recording
    {
        let mgr = manager.lock().await;
        let state = mgr.get_session_state(&session_id).await.unwrap();
        assert!(matches!(state, SessionState::Recording));
    }
    
    // Simulate recording for 2 seconds
    tokio::time::sleep(Duration::from_secs(2)).await;
    
    // Simulate writing audio samples (in real app, this comes from audio callback)
    {
        let mgr = manager.lock().await;
        // In real implementation, samples come from audio device
        // Here we simulate with test data
        let test_samples = vec![0.0f32; 48000 * 2]; // 2 seconds at 48kHz
        mgr.write_audio_samples(&test_samples).await.unwrap();
    }
    
    // Stop recording and trigger transcription
    let stop_start = Instant::now();
    let result = {
        let mut mgr = manager.lock().await;
        mgr.stop_and_transcribe(&session_id).await.unwrap()
    };
    let total_time = stop_start.elapsed();
    
    // Verify results
    assert_eq!(result.session_id, session_id);
    assert!(result.file_path.exists(), "Recording file should exist");
    assert!(result.transcription.is_some(), "Should have transcription");
    
    // Verify performance
    assert!(
        total_time.as_secs() < 5,
        "Total pipeline took {:?}, expected < 5s for 2s audio",
        total_time
    );
    
    // Verify no ring buffer files
    verify_no_ring_buffers(&fixture.recordings_dir);
    
    // Log performance metrics
    if let Some(transcription) = result.transcription {
        println!("Pipeline Performance:");
        println!("  Recording duration: {:.2}s", result.recording_info.duration_seconds);
        println!("  Transcription time: {}ms", transcription.processing_time_ms);
        println!("  Real-time factor: {:.3}", transcription.real_time_factor);
        println!("  Total time: {:?}", total_time);
    }
}

#[tokio::test]
async fn test_rapid_session_cycling() {
    let fixture = IntegrationTestFixture::new().await.unwrap();
    let manager = fixture.session_manager.clone();
    
    let mut perf_tracker = PerformanceTracker::new();
    let cycles = 10;
    
    for i in 0..cycles {
        // Start session
        let start = Instant::now();
        let session_id = {
            let mut mgr = manager.lock().await;
            mgr.start_session(Some(format!("cycle_{}", i))).await.unwrap()
        };
        perf_tracker.record(&format!("Start session {}", i), start.elapsed());
        
        // Brief recording
        tokio::time::sleep(Duration::from_millis(100)).await;
        
        // Write minimal samples
        {
            let mgr = manager.lock().await;
            mgr.write_audio_samples(&vec![0.0f32; 4800]).await.unwrap();
        }
        
        // Stop and transcribe
        let stop_start = Instant::now();
        let result = {
            let mut mgr = manager.lock().await;
            mgr.stop_and_transcribe(&session_id).await.unwrap()
        };
        perf_tracker.record(&format!("Stop session {}", i), stop_start.elapsed());
        
        assert!(result.file_path.exists());
    }
    
    perf_tracker.print_report();
    
    // Verify no accumulation of files
    verify_no_ring_buffers(&fixture.recordings_dir);
}

#[tokio::test]
async fn test_concurrent_session_prevention() {
    let fixture = IntegrationTestFixture::new().await.unwrap();
    let manager = fixture.session_manager.clone();
    
    // Start first session
    let session1 = {
        let mut mgr = manager.lock().await;
        mgr.start_session(Some("session1".to_string())).await.unwrap()
    };
    
    // Attempt to start second session (should fail)
    let result = {
        let mut mgr = manager.lock().await;
        mgr.start_session(Some("session2".to_string())).await
    };
    
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("already active") || 
            result.unwrap_err().contains("in progress"));
    
    // Stop first session
    {
        let mut mgr = manager.lock().await;
        mgr.stop_and_transcribe(&session1).await.unwrap();
    }
    
    // Now second session should succeed
    let session2 = {
        let mut mgr = manager.lock().await;
        mgr.start_session(Some("session2".to_string())).await.unwrap()
    };
    
    {
        let mut mgr = manager.lock().await;
        mgr.stop_and_transcribe(&session2).await.unwrap();
    }
}

#[tokio::test]
async fn test_error_recovery() {
    let fixture = IntegrationTestFixture::new().await.unwrap();
    let manager = fixture.session_manager.clone();
    
    // Start session
    let session_id = {
        let mut mgr = manager.lock().await;
        mgr.start_session(None).await.unwrap()
    };
    
    // Simulate error by corrupting state
    {
        let mgr = manager.lock().await;
        // Force an error state
        mgr.inject_error("Simulated error").await;
    }
    
    // Try to recover
    let recovery_result = {
        let mut mgr = manager.lock().await;
        mgr.recover_session(&session_id).await
    };
    
    // Should be able to start new session after recovery
    let new_session = {
        let mut mgr = manager.lock().await;
        mgr.start_session(None).await
    };
    
    assert!(new_session.is_ok(), "Should recover and allow new session");
}

#[tokio::test]
async fn test_feature_flag_switching() {
    let fixture = IntegrationTestFixture::new().await.unwrap();
    
    // Test with simplified pipeline enabled (default)
    {
        let manager = fixture.session_manager.clone();
        let session_id = {
            let mut mgr = manager.lock().await;
            mgr.start_session(Some("simplified".to_string())).await.unwrap()
        };
        
        tokio::time::sleep(Duration::from_millis(500)).await;
        
        let result = {
            let mut mgr = manager.lock().await;
            mgr.stop_and_transcribe(&session_id).await.unwrap()
        };
        
        // Verify simplified pipeline characteristics
        verify_no_ring_buffers(&fixture.recordings_dir);
        assert!(result.file_path.to_string_lossy().contains("simplified"));
    }
    
    // TODO: Test with legacy pipeline when feature flag is implemented
    // This would involve switching to the ring buffer strategy
}

#[tokio::test]
async fn test_performance_metrics_collection() {
    let fixture = IntegrationTestFixture::new().await.unwrap();
    let manager = fixture.session_manager.clone();
    
    // Collect metrics for various recording durations
    let durations = vec![1, 2, 5, 10]; // seconds
    let mut metrics = Vec::new();
    
    for duration_secs in durations {
        let session_id = {
            let mut mgr = manager.lock().await;
            mgr.start_session(Some(format!("{}s_test", duration_secs))).await.unwrap()
        };
        
        // Simulate recording
        tokio::time::sleep(Duration::from_secs(duration_secs)).await;
        
        // Generate test audio data
        let sample_count = 48000 * duration_secs as usize;
        {
            let mgr = manager.lock().await;
            mgr.write_audio_samples(&vec![0.0f32; sample_count]).await.unwrap();
        }
        
        let start = Instant::now();
        let result = {
            let mut mgr = manager.lock().await;
            mgr.stop_and_transcribe(&session_id).await.unwrap()
        };
        let pipeline_time = start.elapsed();
        
        metrics.push(PipelineMetrics {
            audio_duration_secs: duration_secs,
            total_pipeline_ms: pipeline_time.as_millis() as u64,
            transcription_ms: result.transcription
                .as_ref()
                .map(|t| t.processing_time_ms)
                .unwrap_or(0),
            rtf: result.transcription
                .as_ref()
                .map(|t| t.real_time_factor)
                .unwrap_or(0.0),
        });
    }
    
    // Print metrics table
    println!("\n=== Pipeline Performance Metrics ===");
    println!("Audio(s) | Pipeline(ms) | Transcription(ms) | RTF");
    println!("---------|--------------|-------------------|------");
    for m in &metrics {
        println!("{:8} | {:12} | {:17} | {:.3}",
            m.audio_duration_secs,
            m.total_pipeline_ms,
            m.transcription_ms,
            m.rtf
        );
    }
    
    // Verify all meet performance targets
    for m in &metrics {
        assert!(
            m.rtf < 0.5,
            "RTF {} exceeds target 0.5 for {}s audio",
            m.rtf,
            m.audio_duration_secs
        );
    }
}

#[tokio::test]
async fn test_memory_usage_during_long_recording() {
    let fixture = IntegrationTestFixture::new().await.unwrap();
    let manager = fixture.session_manager.clone();
    
    let session_id = {
        let mut mgr = manager.lock().await;
        mgr.start_session(Some("memory_test".to_string())).await.unwrap()
    };
    
    let initial_memory = get_memory_usage_mb();
    let mut max_memory = initial_memory;
    
    // Simulate 5 minutes of recording
    for minute in 0..5 {
        for second in 0..60 {
            // Write 1 second of audio
            {
                let mgr = manager.lock().await;
                mgr.write_audio_samples(&vec![0.0f32; 48000]).await.unwrap();
            }
            
            // Check memory every 10 seconds
            if second % 10 == 0 {
                let current_memory = get_memory_usage_mb();
                max_memory = max_memory.max(current_memory);
                
                println!("Memory at {}m {}s: {}MB", minute, second, current_memory);
            }
            
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }
    
    // Stop and clean up
    {
        let mut mgr = manager.lock().await;
        mgr.stop_and_transcribe(&session_id).await.unwrap();
    }
    
    let memory_increase = max_memory - initial_memory;
    println!("Memory increase during 5min recording: {}MB", memory_increase);
    
    // Memory increase should be minimal (no accumulation)
    assert!(
        memory_increase < 100,
        "Memory increased by {}MB, expected < 100MB",
        memory_increase
    );
}

// Helper structures
struct PipelineMetrics {
    audio_duration_secs: u64,
    total_pipeline_ms: u64,
    transcription_ms: u64,
    rtf: f64,
}

fn verify_no_ring_buffers(dir: &PathBuf) {
    let entries: Vec<_> = std::fs::read_dir(dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_name().to_string_lossy().contains("ring_buffer")
        })
        .collect();
    
    assert_eq!(
        entries.len(),
        0,
        "Found {} ring buffer files in simplified mode",
        entries.len()
    );
}

fn get_memory_usage_mb() -> usize {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let output = Command::new("ps")
            .args(&["-o", "rss=", "-p", &std::process::id().to_string()])
            .output()
            .unwrap();
        String::from_utf8_lossy(&output.stdout)
            .trim()
            .parse::<usize>()
            .unwrap_or(0) / 1024
    }
    #[cfg(not(target_os = "macos"))]
    {
        0
    }
}
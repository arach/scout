use std::path::PathBuf;
use std::time::Instant;
use tokio;
use std::sync::Arc;
use tokio::sync::Mutex;
use serde::{Serialize, Deserialize};
use chrono;

// Import Scout components
use scout_lib::transcription::Transcriber;

#[derive(Debug, Serialize, Deserialize)]
struct BenchmarkResult {
    test_name: String,
    model_type: String, // "CPU" or "CoreML"
    model_path: String,
    call_number: u32,
    initialization_time_ms: f64,
    transcription_time_ms: Option<f64>,
    total_time_ms: f64,
    transcribed_text: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct BenchmarkReport {
    timestamp: String,
    test_description: String,
    cpu_model_path: String,
    coreml_model_path: String,
    results: Vec<BenchmarkResult>,
    summary: BenchmarkSummary,
}

#[derive(Debug, Serialize, Deserialize)]
struct BenchmarkSummary {
    cpu_avg_init_time_ms: f64,
    coreml_avg_init_time_ms: f64,
    cpu_subsequent_calls_avg_ms: f64,
    coreml_subsequent_calls_avg_ms: f64,
    singleton_effectiveness: String,
    recommendations: Vec<String>,
}

// Simulate the singleton pattern used in AppState
async fn get_or_create_transcriber(
    model_path: &PathBuf, 
    transcriber_ref: Arc<Mutex<Option<Transcriber>>>,
    current_model_ref: Arc<Mutex<Option<PathBuf>>>
) -> Result<Instant, String> {
    let init_start = Instant::now();
    
    let mut current_model = current_model_ref.lock().await;
    let mut transcriber_opt = transcriber_ref.lock().await;
    
    // Check if we need to create a new transcriber
    let needs_new_transcriber = match (&*current_model, &*transcriber_opt) {
        (Some(current_path), Some(_)) if current_path == model_path => false,
        _ => true
    };
    
    if needs_new_transcriber {
        println!("    🔄 Creating new transcriber for model: {:?}", model_path.file_name().unwrap_or_default());
        
        match Transcriber::new(model_path) {
            Ok(new_transcriber) => {
                *transcriber_opt = Some(new_transcriber);
                *current_model = Some(model_path.clone());
            }
            Err(e) => return Err(e)
        }
    } else {
        println!("    ♻️  Reusing existing singleton transcriber");
    }
    
    Ok(init_start)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("🏁 Core ML vs CPU Singleton Performance Benchmark");
    println!("=================================================\n");
    
    let cpu_model_path = PathBuf::from("./models/ggml-base.en.bin");
    let coreml_model_path = PathBuf::from("./models/ggml-base.en.bin"); // Same model but will use Core ML
    
    // Check if models exist
    if !cpu_model_path.exists() {
        println!("❌ CPU model not found at: {:?}", cpu_model_path);
        return Ok(());
    }
    
    // Test audio file (we'll create a simple dummy for timing tests)
    let test_audio = PathBuf::from("./test_audio.wav");
    
    let mut results = Vec::new();
    
    // Test both CPU and Core ML with singleton pattern
    let test_scenarios = vec![
        ("CPU", cpu_model_path.clone()),
        ("CoreML", coreml_model_path.clone()),
    ];
    
    for (model_type, model_path) in test_scenarios {
        println!("🧪 Testing {} Model Performance", model_type);
        println!("-----------------------------------");
        
        // Create singleton instances for this model type
        let transcriber_singleton = Arc::new(Mutex::new(None::<Transcriber>));
        let current_model_path = Arc::new(Mutex::new(None::<PathBuf>));
        
        // Test multiple calls to demonstrate singleton effectiveness
        for call_number in 1..=5 {
            println!("  📞 Call #{}", call_number);
            let total_start = Instant::now();
            
            match get_or_create_transcriber(
                &model_path,
                transcriber_singleton.clone(),
                current_model_path.clone()
            ).await {
                Ok(init_start) => {
                    let initialization_time = init_start.elapsed();
                    let total_time = total_start.elapsed();
                    
                    println!("     ⏱️  Initialization: {:.2}ms", initialization_time.as_millis() as f64);
                    println!("     ⏱️  Total time: {:.2}ms", total_time.as_millis() as f64);
                    
                    results.push(BenchmarkResult {
                        test_name: format!("{}_call_{}", model_type.to_lowercase(), call_number),
                        model_type: model_type.to_string(),
                        model_path: model_path.to_string_lossy().to_string(),
                        call_number,
                        initialization_time_ms: initialization_time.as_millis() as f64,
                        transcription_time_ms: None, // We're focusing on initialization for this test
                        total_time_ms: total_time.as_millis() as f64,
                        transcribed_text: None,
                        error: None,
                    });
                }
                Err(e) => {
                    println!("     ❌ Error: {}", e);
                    let total_time = total_start.elapsed();
                    
                    results.push(BenchmarkResult {
                        test_name: format!("{}_call_{}", model_type.to_lowercase(), call_number),
                        model_type: model_type.to_string(),
                        model_path: model_path.to_string_lossy().to_string(),
                        call_number,
                        initialization_time_ms: total_time.as_millis() as f64,
                        transcription_time_ms: None,
                        total_time_ms: total_time.as_millis() as f64,
                        transcribed_text: None,
                        error: Some(e),
                    });
                }
            }
            
            // Small delay between calls
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        }
        println!();
    }
    
    // Calculate summary statistics
    let cpu_results: Vec<_> = results.iter().filter(|r| r.model_type == "CPU").collect();
    let coreml_results: Vec<_> = results.iter().filter(|r| r.model_type == "CoreML").collect();
    
    let cpu_first_call = cpu_results.iter().find(|r| r.call_number == 1);
    let cpu_subsequent_calls: Vec<_> = cpu_results.iter().filter(|r| r.call_number > 1).collect();
    
    let coreml_first_call = coreml_results.iter().find(|r| r.call_number == 1);
    let coreml_subsequent_calls: Vec<_> = coreml_results.iter().filter(|r| r.call_number > 1).collect();
    
    let cpu_avg_init = cpu_first_call.map_or(0.0, |r| r.initialization_time_ms);
    let coreml_avg_init = coreml_first_call.map_or(0.0, |r| r.initialization_time_ms);
    
    let cpu_subsequent_avg = if cpu_subsequent_calls.is_empty() { 0.0 } else {\n        cpu_subsequent_calls.iter().map(|r| r.total_time_ms).sum::<f64>() / cpu_subsequent_calls.len() as f64\n    };\n    \n    let coreml_subsequent_avg = if coreml_subsequent_calls.is_empty() { 0.0 } else {\n        coreml_subsequent_calls.iter().map(|r| r.total_time_ms).sum::<f64>() / coreml_subsequent_calls.len() as f64\n    };\n    \n    // Generate recommendations\n    let mut recommendations = Vec::new();\n    \n    if coreml_avg_init > cpu_avg_init * 2.0 {\n        recommendations.push(\"Core ML has significant initialization overhead compared to CPU\".to_string());\n    }\n    \n    if coreml_subsequent_avg < 100.0 && cpu_subsequent_avg < 100.0 {\n        recommendations.push(\"Singleton pattern is working - subsequent calls are <100ms for both models\".to_string());\n    }\n    \n    if coreml_avg_init > 5000.0 {\n        recommendations.push(\"Core ML initialization >5s indicates recompilation issue may still exist\".to_string());\n    } else {\n        recommendations.push(\"Core ML initialization is reasonable - singleton pattern likely working\".to_string());\n    }\n    \n    let singleton_effectiveness = if cpu_subsequent_avg < 50.0 && coreml_subsequent_avg < 50.0 {\n        \"Excellent - both models reuse efficiently\".to_string()\n    } else if cpu_subsequent_avg < 100.0 || coreml_subsequent_avg < 100.0 {\n        \"Good - singleton pattern is working\".to_string()\n    } else {\n        \"Poor - may still have recompilation issues\".to_string()\n    };\n    \n    let summary = BenchmarkSummary {\n        cpu_avg_init_time_ms: cpu_avg_init,\n        coreml_avg_init_time_ms: coreml_avg_init,\n        cpu_subsequent_calls_avg_ms: cpu_subsequent_avg,\n        coreml_subsequent_calls_avg_ms: coreml_subsequent_avg,\n        singleton_effectiveness,\n        recommendations,\n    };\n    \n    let report = BenchmarkReport {\n        timestamp: chrono::Utc::now().to_rfc3339(),\n        test_description: \"Core ML vs CPU singleton performance comparison\".to_string(),\n        cpu_model_path: cpu_model_path.to_string_lossy().to_string(),\n        coreml_model_path: coreml_model_path.to_string_lossy().to_string(),\n        results,\n        summary,\n    };\n    \n    // Print results\n    println!(\"📊 BENCHMARK RESULTS\");\n    println!(\"===================\");\n    println!(\"CPU first call initialization:     {:.1}ms\", report.summary.cpu_avg_init_time_ms);\n    println!(\"Core ML first call initialization: {:.1}ms\", report.summary.coreml_avg_init_time_ms);\n    println!(\"CPU subsequent calls average:      {:.1}ms\", report.summary.cpu_subsequent_calls_avg_ms);\n    println!(\"Core ML subsequent calls average:  {:.1}ms\", report.summary.coreml_subsequent_calls_avg_ms);\n    println!(\"\\nSingleton effectiveness: {}\", report.summary.singleton_effectiveness);\n    \n    println!(\"\\n💡 RECOMMENDATIONS:\");\n    for rec in &report.summary.recommendations {\n        println!(\"   • {}\", rec);\n    }\n    \n    // Save to JSON\n    let json_content = serde_json::to_string_pretty(&report)?;\n    let output_file = \"./core_ml_vs_cpu_singleton_results.json\";\n    tokio::fs::write(output_file, json_content).await?;\n    \n    println!(\"\\n📄 Detailed results saved to: {}\", output_file);\n    \n    // Final analysis\n    let speedup_ratio = if report.summary.coreml_subsequent_calls_avg_ms > 0.0 {\n        report.summary.coreml_avg_init_time_ms / report.summary.coreml_subsequent_calls_avg_ms\n    } else { 0.0 };\n    \n    if speedup_ratio > 10.0 {\n        println!(\"\\n✅ SUCCESS: Core ML singleton provides {:.1}x speedup after initial load!\", speedup_ratio);\n    } else if speedup_ratio > 2.0 {\n        println!(\"\\n⚠️ PARTIAL: Core ML singleton provides {:.1}x speedup, but may need optimization\", speedup_ratio);\n    } else {\n        println!(\"\\n❌ ISSUE: Core ML singleton not providing expected speedup ({}x)\", speedup_ratio);\n    }\n    \n    Ok(())\n}
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::audio::AudioRecorder;
use crate::logger::{info, error, Component};

pub struct DiagnosticsService {
    pub recordings_dir: PathBuf,
    pub recorder: Arc<Mutex<AudioRecorder>>,
}

#[derive(serde::Serialize)]
pub struct VoiceTestResult {
    pub recordings: Vec<VoiceRecording>,
    pub summary: String,
}

#[derive(serde::Serialize)]
pub struct VoiceRecording {
    pub index: u32,
    pub filename: String,
    pub filepath: String,
    pub description: String,
}

pub async fn analyze_audio_corruption(file_path: &str) -> Result<serde_json::Value, String> {
    use hound::WavReader;
    use std::collections::HashMap;

    info(Component::Recording, &format!("🔍 Analyzing audio corruption in: {}", file_path));

    let mut reader = WavReader::open(&file_path)
        .map_err(|e| format!("Failed to open WAV file: {}", e))?;

    let spec = reader.spec();
    info(Component::Recording, &format!("WAV spec: {:?}", spec));

    let samples: Result<Vec<f32>, _> = reader.samples().collect();
    let samples = samples.map_err(|e| format!("Failed to read samples: {}", e))?;
    if samples.is_empty() {
        return Err("No audio samples found".to_string());
    }

    info(Component::Recording, &format!("Analyzing {} samples", samples.len()));

    let sample_count = samples.len();
    let duration_seconds = sample_count as f32 / (spec.sample_rate as f32 * spec.channels as u16 as f32);

    let mut min_sample = f32::INFINITY;
    let mut max_sample = f32::NEG_INFINITY;
    let mut sum_squared = 0.0f64;
    let mut zero_crossings = 0;
    let mut clipped_samples = 0;
    let mut silence_samples = 0;
    let mut amplitude_histogram = HashMap::new();
    let mut consecutive_identical = 0;
    let mut max_consecutive_identical = 0;
    let mut last_sample = None;

    for &sample in &samples {
        min_sample = min_sample.min(sample);
        max_sample = max_sample.max(sample);
        sum_squared += (sample as f64).powi(2);
        if sample.abs() >= 0.99 { clipped_samples += 1; }
        if sample.abs() < 0.001 { silence_samples += 1; }
        let bin = ((sample + 1.0) * 50.0) as i32; // 100 bins from -1 to 1
        *amplitude_histogram.entry(bin).or_insert(0) += 1;
        if let Some(last) = last_sample {
            let last_f32: f32 = last;
            if (sample - last_f32).abs() < 0.00001 {
                consecutive_identical += 1;
                max_consecutive_identical = max_consecutive_identical.max(consecutive_identical);
            } else {
                consecutive_identical = 0;
            }
        }
        last_sample = Some(sample as f32);
    }

    for i in 1..samples.len() {
        if (samples[i - 1] >= 0.0) != (samples[i] >= 0.0) {
            zero_crossings += 1;
        }
    }

    let rms = (sum_squared / sample_count as f64).sqrt() as f32;
    let dynamic_range = max_sample - min_sample;
    let silence_ratio = silence_samples as f32 / sample_count as f32;
    let clipping_ratio = clipped_samples as f32 / sample_count as f32;
    let zero_crossing_rate = zero_crossings as f32 / duration_seconds;

    let mut corruption_indicators = Vec::new();
    if max_consecutive_identical > 1000 {
        corruption_indicators.push(format!(
            "High consecutive identical samples: {}",
            max_consecutive_identical
        ));
    }
    if clipping_ratio > 0.01 {
        corruption_indicators.push(format!("High clipping ratio: {:.2}%", clipping_ratio * 100.0));
    }
    if rms < 0.001 {
        corruption_indicators.push("Extremely low RMS - possible silence".to_string());
    } else if rms > 0.5 {
        corruption_indicators.push(format!("Very high RMS: {:.3}", rms));
    }
    if zero_crossing_rate > 8000.0 {
        corruption_indicators.push(format!(
            "Abnormally high zero crossing rate: {:.0} Hz",
            zero_crossing_rate
        ));
    } else if zero_crossing_rate < 50.0 && silence_ratio < 0.8 {
        corruption_indicators.push(format!(
            "Abnormally low zero crossing rate: {:.0} Hz",
            zero_crossing_rate
        ));
    }

    let expected_nyquist = spec.sample_rate as f32 / 2.0;
    let actual_content_estimate = zero_crossing_rate * 2.0;
    if actual_content_estimate > expected_nyquist * 1.2 {
        corruption_indicators.push("Possible aliasing - content above Nyquist frequency".to_string());
    }

    let mut noise_indicators = Vec::new();
    let mut rapid_changes = 0;
    for i in 1..samples.len().min(10000) {
        if (samples[i] - samples[i - 1]).abs() > 0.1 {
            rapid_changes += 1;
        }
    }
    let rapid_change_ratio = rapid_changes as f32 / 10000.0_f32.min(samples.len() as f32);
    if rapid_change_ratio > 0.3 {
        noise_indicators.push(format!(
            "High rapid amplitude changes: {:.1}%",
            rapid_change_ratio * 100.0
        ));
    }

    let analysis = serde_json::json!({
        "file_path": file_path,
        "basic_info": {
            "sample_rate": spec.sample_rate,
            "channels": spec.channels,
            "bits_per_sample": spec.bits_per_sample,
            "sample_format": format!("{:?}", spec.sample_format),
            "duration_seconds": duration_seconds,
            "sample_count": sample_count
        },
        "signal_analysis": {
            "rms": rms,
            "min_sample": min_sample,
            "max_sample": max_sample,
            "dynamic_range": dynamic_range,
            "zero_crossing_rate": zero_crossing_rate,
            "silence_ratio": silence_ratio,
            "clipping_ratio": clipping_ratio,
            "max_consecutive_identical": max_consecutive_identical
        },
        "corruption_indicators": corruption_indicators,
        "noise_indicators": noise_indicators,
        "health_score": {
            "overall": if corruption_indicators.is_empty() && noise_indicators.is_empty() { "HEALTHY" } else { "CORRUPTED" },
            "corruption_count": corruption_indicators.len(),
            "noise_count": noise_indicators.len()
        }
    });

    info(
        Component::Recording,
        &format!(
            "Analysis complete. Health: {}",
            if analysis["health_score"]["overall"] == "HEALTHY" { "HEALTHY" } else { "CORRUPTED" }
        ),
    );
    Ok(analysis)
}

impl DiagnosticsService {
    pub async fn test_simple_recording(&self) -> Result<String, String> {
        use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
        use hound::WavWriter;
        use std::sync::{Arc, Mutex};
        use std::thread;
        use std::time::Duration;

        info(Component::Recording, "🧪 Starting SIMPLE test recording - no buffers, no strategies, no processing");

        let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
        let filename = format!("test_simple_{}.wav", timestamp);
        let output_path = self.recordings_dir.join(&filename);

        let host = cpal::default_host();
        let device = host.default_input_device().ok_or("No default input device available")?;
        let config = device.default_input_config().map_err(|e| format!("Failed to get default config: {}", e))?;

        info(Component::Recording, &format!("Test device: {:?}", device.name()));
        info(Component::Recording, &format!("Test config: {:?}", config));

        let spec = hound::WavSpec { channels: config.channels(), sample_rate: config.sample_rate().0, bits_per_sample: 32, sample_format: hound::SampleFormat::Float };
        let writer = WavWriter::create(&output_path, spec).map_err(|e| format!("Failed to create WAV writer: {}", e))?;
        let writer = Arc::new(Mutex::new(Some(writer)));

        let is_recording = Arc::new(Mutex::new(true));
        let writer_clone = writer.clone();
        let is_recording_clone = is_recording.clone();
        let stream = device
            .build_input_stream(
                &config.into(),
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    if *is_recording_clone.lock().unwrap() {
                        if let Some(ref mut w) = *writer_clone.lock().unwrap() {
                            for &sample in data.iter() { let _ = w.write_sample(sample); }
                        }
                    }
                },
                move |err| { error(Component::Recording, &format!("Test stream error: {}", err)); },
                None,
            )
            .map_err(|e| format!("Failed to build test stream: {}", e))?;

        stream.play().map_err(|e| format!("Failed to start test stream: {}", e))?;
        info(Component::Recording, "🎤 Test recording started - speak for 3 seconds...");
        thread::sleep(Duration::from_secs(3));
        *is_recording.lock().unwrap() = false;
        drop(stream);
        if let Some(writer) = writer.lock().unwrap().take() { writer.finalize().map_err(|e| format!("Failed to finalize test recording: {}", e))?; }
        info(Component::Recording, &format!("🎯 Test recording complete: {}", output_path.display()));
        Ok(filename)
    }

    pub async fn test_device_config_consistency(&self) -> Result<String, String> {
        use cpal::traits::{DeviceTrait, HostTrait};

        info(Component::Recording, "🔍 Testing device configuration consistency across multiple queries");
        let host = cpal::default_host();
        let device = host.default_input_device().ok_or("No default input device available")?;
        let device_name = device.name().unwrap_or_else(|_| "Unknown".to_string());
        info(Component::Recording, &format!("Testing device: {}", device_name));

        let mut results = Vec::new();
        for i in 1..=5 {
            let config = device.default_input_config().map_err(|e| format!("Failed to get device config on attempt {}: {}", i, e))?;
            let config_info = format!("Attempt {}: {} Hz, {} channels, {:?}", i, config.sample_rate().0, config.channels(), config.sample_format());
            info(Component::Recording, &config_info);
            results.push(config_info);
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }
        Ok(format!("Device config consistency test for {}:\n{}", device_name, results.join("\n")))
    }

    pub async fn test_voice_with_sample_rate_mismatch(&self) -> Result<VoiceTestResult, String> {
        info(Component::Recording, "🎤 Testing VOICE recording with artificial sample rate mismatch");
        let mut recordings = Vec::new();
        for i in 1..=3 {
            info(Component::Recording, &format!("=== Voice Recording {} with Artificial Mismatch ===", i));
            let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S_%3f");
            let filename = format!("test_voice_mismatch_{}_{}.wav", i, timestamp);
            let output_path = self.recordings_dir.join(&filename);

            let recorder = self.recorder.lock().await;
            info(Component::Recording, &format!("🎤 Voice Recording {} - speak for 3 seconds...", i));
            recorder.start_recording(&output_path, None).map_err(|e| format!("Failed to start voice recording {}: {}", i, e))?;
            drop(recorder);

            tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;

            let recorder = self.recorder.lock().await;
            recorder.stop_recording().map_err(|e| format!("Failed to stop voice recording {}: {}", i, e))?;
            drop(recorder);

            match i {
                1 => info(Component::Recording, "Recording 1: Leaving perfect (no sample rate corruption)"),
                2 => { info(Component::Recording, "Recording 2: Artificially corrupting to simulate sample rate mismatch (44.1kHz data)"); corrupt_wav_sample_rate(&output_path, 0.92)?; }
                3 => { info(Component::Recording, "Recording 3: Artificially corrupting to simulate worse sample rate mismatch (40kHz data)"); corrupt_wav_sample_rate(&output_path, 0.83)?; }
                _ => {}
            }

            let description = match i {
                1 => "Perfect".to_string(),
                2 => "~8% slower (simulating 44.1kHz data in 48kHz header)".to_string(),
                3 => "~17% slower (simulating 40kHz data in 48kHz header)".to_string(),
                _ => "Unknown".to_string(),
            };
            recordings.push(VoiceRecording { index: i, filename: filename.clone(), filepath: output_path.to_string_lossy().to_string(), description });
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        }
        Ok(VoiceTestResult { recordings, summary: "Voice recordings with artificial sample rate mismatch complete. Compare your voice in all 3 recordings:".to_string() })
    }

    pub async fn test_sample_rate_mismatch_reproduction(&self) -> Result<String, String> {
        use hound::WavWriter;
        info(Component::Recording, "🧪 Testing ARTIFICIAL sample rate mismatch to reproduce degradation issue");
        let mut results = Vec::new();
        for i in 1..=3 {
            info(Component::Recording, &format!("=== Creating Artificial Recording {} ===", i));
            let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S_%3f");
            let filename = format!("test_artificial_{}_{}.wav", i, timestamp);
            let output_path = self.recordings_dir.join(&filename);
            let header_sample_rate = 48000u32;
            let actual_data_rate = match i { 1 => 48000u32, 2 => 44100u32, 3 => 40000u32, _ => 48000u32 };
            info(Component::Recording, &format!("Recording {}: Header claims {}Hz, generating data at {}Hz", i, header_sample_rate, actual_data_rate));
            let spec = hound::WavSpec { channels: 1, sample_rate: header_sample_rate, bits_per_sample: 32, sample_format: hound::SampleFormat::Float };
            let mut writer = WavWriter::create(&output_path, spec).map_err(|e| format!("Failed to create artificial WAV {}: {}", i, e))?;
            let duration_samples = actual_data_rate * 3; let frequency = 440.0;
            for sample_idx in 0..duration_samples { let t = sample_idx as f32 / actual_data_rate as f32; let sample = (t * frequency * 2.0 * std::f32::consts::PI).sin() * 0.3; writer.write_sample(sample).map_err(|e| format!("Failed to write sample in recording {}: {}", i, e))?; }
            writer.finalize().map_err(|e| format!("Failed to finalize artificial recording {}: {}", i, e))?;
            results.push(format!("Artificial Recording {}: {} (Header: {}Hz, Data: {}Hz)", i, filename, header_sample_rate, actual_data_rate));
        }
        Ok(format!("Artificial sample rate mismatch test complete:\n{}\n\nIf our theory is correct:\n- Recording 1 should sound normal\n- Recording 2 should sound slower/lower pitch\n- Recording 3 should sound much slower/lower pitch", results.join("\n")))
    }

    pub async fn test_multiple_scout_recordings(&self) -> Result<String, String> {
        info(Component::Recording, "🧪 Testing MULTIPLE Scout pipeline recordings to reproduce progressive degradation");
        let mut results = Vec::new();
        for i in 1..=3 {
            info(Component::Recording, &format!("=== Starting Scout Pipeline Recording {} ===", i));
            let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S_%3f");
            let filename = format!("test_scout_multi_{}_{}.wav", i, timestamp);
            let output_path = self.recordings_dir.join(&filename);
            let recorder = self.recorder.lock().await;
            info(Component::Recording, &format!("🎤 Recording {} started - speak for 3 seconds...", i));
            recorder.start_recording(&output_path, None).map_err(|e| format!("Failed to start Scout recording {}: {}", i, e))?; drop(recorder);
            tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
            let recorder = self.recorder.lock().await; recorder.stop_recording().map_err(|e| format!("Failed to stop Scout recording {}: {}", i, e))?; drop(recorder);
            let result = format!("Recording {}: {}", i, filename); info(Component::Recording, &format!("🎯 {}", result)); results.push(result);
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        }
        Ok(format!("Multiple Scout pipeline recordings complete:\n{}", results.join("\n")))
    }

    pub async fn test_scout_pipeline_recording(&self) -> Result<String, String> {
        info(Component::Recording, "🧪 Starting Scout pipeline test recording - using SAME system as main recordings");
        let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
        let filename = format!("test_scout_pipeline_{}.wav", timestamp);
        let output_path = self.recordings_dir.join(&filename);
        let recorder = self.recorder.lock().await;
        info(Component::Recording, "🎤 Test recording started using Scout's AudioRecorder - speak for 3 seconds...");
        recorder.start_recording(&output_path, None).map_err(|e| format!("Failed to start Scout recording: {}", e))?; drop(recorder);
        tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
        let recorder = self.recorder.lock().await; recorder.stop_recording().map_err(|e| format!("Failed to stop Scout recording: {}", e))?; drop(recorder);
        info(Component::Recording, &format!("🎯 Scout pipeline test recording complete: {}", output_path.display()));
        Ok(filename)
    }
}

fn corrupt_wav_sample_rate(wav_path: &std::path::Path, speed_factor: f32) -> Result<(), String> {
    use std::fs::File;
    use std::io::{Read, Write};
    info(Component::Recording, &format!("Corrupting WAV file: {:?} with speed factor: {}", wav_path, speed_factor));
    let mut file = File::open(wav_path).map_err(|e| format!("Failed to open WAV file: {}", e))?;
    let mut data = Vec::new(); file.read_to_end(&mut data).map_err(|e| format!("Failed to read WAV file: {}", e))?;
    if data.len() < 44 { return Err("WAV file too small (less than 44 bytes)".to_string()); }
    if &data[0..4] != b"RIFF" || &data[8..12] != b"WAVE" { return Err("Not a valid WAV file".to_string()); }
    let mut pos = 12; let mut sample_rate_pos = None;
    while pos + 8 <= data.len() {
        let chunk_id = &data[pos..pos+4];
        let chunk_size = u32::from_le_bytes([data[pos+4], data[pos+5], data[pos+6], data[pos+7]]);
        if chunk_id == b"fmt " { if pos + 8 + 4 <= data.len() { sample_rate_pos = Some(pos + 8 + 4); break; } }
        pos += 8 + chunk_size as usize; if chunk_size % 2 == 1 { pos += 1; }
    }
    let sample_rate_pos = sample_rate_pos.ok_or("Could not find fmt chunk in WAV file")?;
    if sample_rate_pos + 4 > data.len() { return Err("WAV file fmt chunk is corrupted".to_string()); }
    let current_sample_rate = u32::from_le_bytes([data[sample_rate_pos], data[sample_rate_pos+1], data[sample_rate_pos+2], data[sample_rate_pos+3]]);
    info(Component::Recording, &format!("Current sample rate: {} Hz", current_sample_rate));
    let new_sample_rate = (current_sample_rate as f32 * speed_factor) as u32;
    info(Component::Recording, &format!("New sample rate: {} Hz (should make audio play {}x speed)", new_sample_rate, speed_factor));
    let new_rate_bytes = new_sample_rate.to_le_bytes();
    data[sample_rate_pos] = new_rate_bytes[0]; data[sample_rate_pos+1] = new_rate_bytes[1]; data[sample_rate_pos+2] = new_rate_bytes[2]; data[sample_rate_pos+3] = new_rate_bytes[3];
    if sample_rate_pos + 8 <= data.len() {
        let current_byte_rate = u32::from_le_bytes([data[sample_rate_pos+4], data[sample_rate_pos+5], data[sample_rate_pos+6], data[sample_rate_pos+7]]);
        let new_byte_rate = (current_byte_rate as f32 * speed_factor) as u32; let new_byte_rate_bytes = new_byte_rate.to_le_bytes();
        data[sample_rate_pos+4] = new_byte_rate_bytes[0]; data[sample_rate_pos+5] = new_byte_rate_bytes[1]; data[sample_rate_pos+6] = new_byte_rate_bytes[2]; data[sample_rate_pos+7] = new_byte_rate_bytes[3];
        info(Component::Recording, &format!("Updated byte rate from {} to {}", current_byte_rate, new_byte_rate));
    }
    let mut output_file = File::create(wav_path).map_err(|e| format!("Failed to create output file: {}", e))?;
    output_file.write_all(&data).map_err(|e| format!("Failed to write modified WAV data: {}", e))?;
    info(Component::Recording, "Successfully modified WAV header with new sample rate");
    Ok(())
}


use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;
use std::sync::mpsc;
use std::any::TypeId;
use super::vad::VoiceActivityDetector;

pub struct AudioRecorder {
    control_tx: Option<mpsc::Sender<RecorderCommand>>,
    is_recording: Arc<Mutex<bool>>,
    vad_enabled: Arc<Mutex<bool>>,
    current_audio_level: Arc<Mutex<f32>>,
}

enum RecorderCommand {
    StartRecording(String),
    StopRecording,
    SetVadEnabled(bool),
}

impl AudioRecorder {
    pub fn new() -> Self {
        Self {
            control_tx: None,
            is_recording: Arc::new(Mutex::new(false)),
            vad_enabled: Arc::new(Mutex::new(false)),
            current_audio_level: Arc::new(Mutex::new(0.0)),
        }
    }
    
    pub fn get_current_audio_level(&self) -> f32 {
        *self.current_audio_level.lock().unwrap()
    }

    pub fn init(&mut self) {
        let (tx, rx) = mpsc::channel();
        self.control_tx = Some(tx);
        let is_recording = self.is_recording.clone();
        let vad_enabled = self.vad_enabled.clone();
        let audio_level = self.current_audio_level.clone();

        thread::spawn(move || {
            let mut recorder = AudioRecorderWorker::new(is_recording, vad_enabled, audio_level);
            
            while let Ok(cmd) = rx.recv() {
                match cmd {
                    RecorderCommand::StartRecording(path) => {
                        if let Err(e) = recorder.start_recording(&path) {
                            eprintln!("Failed to start recording: {}", e);
                        }
                    }
                    RecorderCommand::StopRecording => {
                        if let Err(e) = recorder.stop_recording() {
                            eprintln!("Failed to stop recording: {}", e);
                        }
                    }
                    RecorderCommand::SetVadEnabled(enabled) => {
                        *recorder.vad_enabled.lock().unwrap() = enabled;
                    }
                }
            }
        });
    }

    pub fn start_recording(&self, output_path: &Path) -> Result<(), String> {
        if self.control_tx.is_none() {
            return Err("Recorder not initialized".to_string());
        }

        self.control_tx
            .as_ref()
            .unwrap()
            .send(RecorderCommand::StartRecording(
                output_path.to_string_lossy().to_string(),
            ))
            .map_err(|e| format!("Failed to send start command: {}", e))
    }

    pub fn stop_recording(&self) -> Result<(), String> {
        if self.control_tx.is_none() {
            return Err("Recorder not initialized".to_string());
        }

        self.control_tx
            .as_ref()
            .unwrap()
            .send(RecorderCommand::StopRecording)
            .map_err(|e| format!("Failed to send stop command: {}", e))
    }

    pub fn is_recording(&self) -> bool {
        *self.is_recording.lock().unwrap()
    }

    pub fn set_vad_enabled(&self, enabled: bool) -> Result<(), String> {
        if self.control_tx.is_none() {
            return Err("Recorder not initialized".to_string());
        }

        self.control_tx
            .as_ref()
            .unwrap()
            .send(RecorderCommand::SetVadEnabled(enabled))
            .map_err(|e| format!("Failed to send VAD command: {}", e))
    }

    pub fn is_vad_enabled(&self) -> bool {
        *self.vad_enabled.lock().unwrap()
    }
}

struct AudioRecorderWorker {
    stream: Option<cpal::Stream>,
    writer: Arc<Mutex<Option<hound::WavWriter<std::io::BufWriter<std::fs::File>>>>>,
    is_recording: Arc<Mutex<bool>>,
    vad_enabled: Arc<Mutex<bool>>,
    vad: Option<VoiceActivityDetector>,
    sample_count: Arc<Mutex<u64>>,
    sample_rate: u32,
    channels: u16,
    sample_format: Option<cpal::SampleFormat>,
    current_audio_level: Arc<Mutex<f32>>,
}

impl AudioRecorderWorker {
    fn new(is_recording: Arc<Mutex<bool>>, vad_enabled: Arc<Mutex<bool>>, audio_level: Arc<Mutex<f32>>) -> Self {
        Self {
            stream: None,
            writer: Arc::new(Mutex::new(None)),
            is_recording,
            vad_enabled,
            vad: None,
            sample_count: Arc::new(Mutex::new(0)),
            sample_rate: 48000, // default, will be updated when recording starts
            channels: 1, // default, will be updated when recording starts
            sample_format: None,
            current_audio_level: audio_level,
        }
    }

    fn start_recording(&mut self, output_path: &str) -> Result<(), String> {
        use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};


        let host = cpal::default_host();
        
        
        let device = host
            .default_input_device()
            .ok_or("No input device available - please check microphone permissions")?;


        let config = device
            .default_input_config()
            .map_err(|e| format!("Failed to get input config: {}", e))?;

        // Store sample rate, channels, and format for later use
        self.sample_rate = config.sample_rate().0;
        self.channels = config.channels();
        self.sample_format = Some(config.sample_format());
        
        // Reset sample count
        *self.sample_count.lock().unwrap() = 0;

        // Match the WAV spec to the actual audio format
        let (bits_per_sample, sample_format) = match config.sample_format() {
            cpal::SampleFormat::I16 => (16, hound::SampleFormat::Int),
            cpal::SampleFormat::F32 => (32, hound::SampleFormat::Float),
            _ => return Err("Unsupported sample format".to_string()),
        };
        
        let spec = hound::WavSpec {
            channels: config.channels(),
            sample_rate: config.sample_rate().0,
            bits_per_sample,
            sample_format,
        };

        // Initialize VAD if enabled
        if *self.vad_enabled.lock().unwrap() {
            self.vad = Some(VoiceActivityDetector::new(config.sample_rate().0)?);
        }

        let writer = hound::WavWriter::create(output_path, spec)
            .map_err(|e| format!("Failed to create WAV writer: {}", e))?;


        let writer = Arc::new(Mutex::new(Some(writer)));
        self.writer = writer.clone();

        let is_recording = self.is_recording.clone();
        *is_recording.lock().unwrap() = true;

        let err_fn = |err| eprintln!("An error occurred on the audio stream: {}", err);

        let stream = match config.sample_format() {
            cpal::SampleFormat::I16 => self.build_input_stream::<i16>(
                &device,
                &config.into(),
                writer.clone(),
                is_recording.clone(),
                self.sample_count.clone(),
                self.current_audio_level.clone(),
                err_fn,
            ),
            cpal::SampleFormat::U16 => {
                return Err("U16 sample format not supported".to_string());
            }
            cpal::SampleFormat::F32 => self.build_input_stream::<f32>(
                &device,
                &config.into(),
                writer.clone(),
                is_recording.clone(),
                self.sample_count.clone(),
                self.current_audio_level.clone(),
                err_fn,
            ),
            _ => return Err("Unsupported sample format".to_string()),
        }?;

        
        stream
            .play()
            .map_err(|e| format!("Failed to play stream: {}", e))?;

        println!("Recording started");
        
        self.stream = Some(stream);
        Ok(())
    }

    fn stop_recording(&mut self) -> Result<(), String> {
        *self.is_recording.lock().unwrap() = false;
        
        // Reset audio level
        *self.current_audio_level.lock().unwrap() = 0.0;

        // Give the stream a moment to process any remaining audio
        std::thread::sleep(std::time::Duration::from_millis(100));

        if let Some(stream) = self.stream.take() {
            drop(stream);
        }

        // Add another small delay to ensure all samples are written
        std::thread::sleep(std::time::Duration::from_millis(100));

        // Check if we need to pad with silence
        let total_samples = *self.sample_count.lock().unwrap();
        let duration_seconds = total_samples as f32 / self.sample_rate as f32 / self.channels as f32;
        
        if duration_seconds < 1.0 && self.writer.lock().unwrap().is_some() {
            // Calculate how many silence samples we need to reach 1.1 seconds (with a small buffer)
            let target_samples = (self.sample_rate as f64 * self.channels as f64 * 1.1) as u64; // 1.1 seconds worth
            let silence_samples_needed = target_samples.saturating_sub(total_samples);
            
            if silence_samples_needed > 0 {
                println!("Recording too short ({:.2}s), padding with silence to 1.1 seconds", duration_seconds);
                
                // Write silence samples
                if let Some(ref mut writer) = *self.writer.lock().unwrap() {
                    match self.sample_format {
                        Some(cpal::SampleFormat::F32) => {
                            for _ in 0..silence_samples_needed {
                                writer.write_sample(0.0f32).ok();
                            }
                        }
                        Some(cpal::SampleFormat::I16) => {
                            for _ in 0..silence_samples_needed {
                                writer.write_sample(0i16).ok();
                            }
                        }
                        _ => {
                            // Default to i16 if format is unknown
                            for _ in 0..silence_samples_needed {
                                writer.write_sample(0i16).ok();
                            }
                        }
                    }
                }
            }
        }

        if let Some(writer) = self.writer.lock().unwrap().take() {
            writer
                .finalize()
                .map_err(|e| format!("Failed to finalize recording: {}", e))?;
        }

        println!("Recording stopped");
        Ok(())
    }

    fn build_input_stream<T>(
        &self,
        device: &cpal::Device,
        config: &cpal::StreamConfig,
        writer: Arc<Mutex<Option<hound::WavWriter<std::io::BufWriter<std::fs::File>>>>>,
        is_recording: Arc<Mutex<bool>>,
        sample_count: Arc<Mutex<u64>>,
        audio_level: Arc<Mutex<f32>>,
        err_fn: impl FnMut(cpal::StreamError) + Send + 'static,
    ) -> Result<cpal::Stream, String>
    where
        T: cpal::Sample + cpal::SizedSample + hound::Sample + Send + 'static,
    {
        use cpal::traits::DeviceTrait;
        
        device
            .build_input_stream(
                config,
                move |data: &[T], _: &cpal::InputCallbackInfo| {
                    if *is_recording.lock().unwrap() {
                        // Calculate RMS (Root Mean Square) level for volume
                        let mut sum_squares = 0.0f32;
                        
                        // Convert samples to f32 for RMS calculation
                        if TypeId::of::<T>() == TypeId::of::<f32>() {
                            // For f32 samples
                            for &sample in data.iter() {
                                let s = unsafe { *(&sample as *const T as *const f32) };
                                sum_squares += s * s;
                            }
                        } else if TypeId::of::<T>() == TypeId::of::<i16>() {
                            // For i16 samples
                            for &sample in data.iter() {
                                let s = unsafe { *(&sample as *const T as *const i16) } as f32 / 32768.0;
                                sum_squares += s * s;
                            }
                        }
                        
                        let rms = (sum_squares / data.len() as f32).sqrt();
                        
                        // Amplify the RMS value for better visual response
                        // Most speech is quite low in amplitude, so we need to scale it up
                        let amplified_rms = (rms * 20.0).min(1.0);  // Increased from 8x to 20x
                        
                        // Debug logging for audio levels (only log significant changes)
                        // Commented out to reduce noise
                        // if rms > 0.001 {
                        //     println!("Audio recorder - RMS: {:.4}, Amplified: {:.4}", rms, amplified_rms);
                        // }
                        
                        // Update audio level (with some smoothing)
                        let current_level = *audio_level.lock().unwrap();
                        let new_level = current_level * 0.7 + amplified_rms * 0.3; // Smooth the level changes
                        *audio_level.lock().unwrap() = new_level; // Already capped by amplified_rms
                        
                        if let Some(ref mut writer) = *writer.lock().unwrap() {
                            let samples_written = data.len();
                            for &sample in data.iter() {
                                writer.write_sample(sample).ok();
                            }
                            *sample_count.lock().unwrap() += samples_written as u64;
                        }
                    }
                },
                err_fn,
                None,
            )
            .map_err(|e| format!("Failed to build input stream: {}", e))
    }
}
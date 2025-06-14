use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;
use std::sync::mpsc;

pub struct AudioRecorder {
    control_tx: Option<mpsc::Sender<RecorderCommand>>,
    is_recording: Arc<Mutex<bool>>,
}

enum RecorderCommand {
    StartRecording(String),
    StopRecording,
}

impl AudioRecorder {
    pub fn new() -> Self {
        Self {
            control_tx: None,
            is_recording: Arc::new(Mutex::new(false)),
        }
    }

    pub fn init(&mut self) {
        let (tx, rx) = mpsc::channel();
        self.control_tx = Some(tx);
        let is_recording = self.is_recording.clone();

        thread::spawn(move || {
            let mut recorder = AudioRecorderWorker::new(is_recording);
            
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
}

struct AudioRecorderWorker {
    stream: Option<cpal::Stream>,
    writer: Arc<Mutex<Option<hound::WavWriter<std::io::BufWriter<std::fs::File>>>>>,
    is_recording: Arc<Mutex<bool>>,
}

impl AudioRecorderWorker {
    fn new(is_recording: Arc<Mutex<bool>>) -> Self {
        Self {
            stream: None,
            writer: Arc::new(Mutex::new(None)),
            is_recording,
        }
    }

    fn start_recording(&mut self, output_path: &str) -> Result<(), String> {
        use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or("No input device available")?;

        let config = device
            .default_input_config()
            .map_err(|e| format!("Failed to get input config: {}", e))?;

        let spec = hound::WavSpec {
            channels: config.channels(),
            sample_rate: config.sample_rate().0,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };

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
                err_fn,
            ),
            _ => return Err("Unsupported sample format".to_string()),
        }?;

        stream
            .play()
            .map_err(|e| format!("Failed to play stream: {}", e))?;

        self.stream = Some(stream);
        Ok(())
    }

    fn stop_recording(&mut self) -> Result<(), String> {
        *self.is_recording.lock().unwrap() = false;

        if let Some(stream) = self.stream.take() {
            drop(stream);
        }

        if let Some(writer) = self.writer.lock().unwrap().take() {
            writer
                .finalize()
                .map_err(|e| format!("Failed to finalize recording: {}", e))?;
        }

        Ok(())
    }

    fn build_input_stream<T>(
        &self,
        device: &cpal::Device,
        config: &cpal::StreamConfig,
        writer: Arc<Mutex<Option<hound::WavWriter<std::io::BufWriter<std::fs::File>>>>>,
        is_recording: Arc<Mutex<bool>>,
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
                        if let Some(ref mut writer) = *writer.lock().unwrap() {
                            for &sample in data.iter() {
                                writer.write_sample(sample).ok();
                            }
                        }
                    }
                },
                err_fn,
                None,
            )
            .map_err(|e| format!("Failed to build input stream: {}", e))
    }
}
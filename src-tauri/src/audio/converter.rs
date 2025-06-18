use std::path::{Path, PathBuf};
use std::fs::File;
use symphonia::core::audio::AudioBufferRef;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use hound::{WavWriter, WavSpec};

pub struct AudioConverter;

impl AudioConverter {
    /// Convert any audio file to WAV format using Symphonia
    pub fn convert_to_wav(input_path: &Path, output_path: &Path) -> Result<(), String> {
        // Open the input file
        let file = File::open(input_path)
            .map_err(|e| format!("Failed to open input file: {}", e))?;
        
        // Create a media source stream
        let mss = MediaSourceStream::new(Box::new(file), Default::default());
        
        // Create a hint based on the file extension
        let mut hint = Hint::new();
        if let Some(ext) = input_path.extension() {
            if let Some(ext_str) = ext.to_str() {
                hint.with_extension(ext_str);
            }
        }
        
        // Probe the media source
        let meta_opts: MetadataOptions = Default::default();
        let fmt_opts: FormatOptions = Default::default();
        
        let probed = symphonia::default::get_probe()
            .format(&hint, mss, &fmt_opts, &meta_opts)
            .map_err(|e| format!("Failed to probe audio format: {}", e))?;
        
        // Get the format reader
        let mut format = probed.format;
        
        // Find the first audio track
        let track = format
            .tracks()
            .iter()
            .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
            .ok_or("No audio tracks found")?;
        
        let track_id = track.id;
        
        // Create a decoder for the track
        let dec_opts: DecoderOptions = Default::default();
        let mut decoder = symphonia::default::get_codecs()
            .make(&track.codec_params, &dec_opts)
            .map_err(|e| format!("Failed to create decoder: {}", e))?;
        
        // Get audio parameters
        let sample_rate = track.codec_params.sample_rate.unwrap_or(44100);
        let channels = track.codec_params.channels.map(|c| c.count()).unwrap_or(2) as u16;
        
        // Create WAV writer with 16kHz mono for Whisper
        let spec = WavSpec {
            channels: 1,
            sample_rate: 16000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        
        let mut wav_writer = WavWriter::create(output_path, spec)
            .map_err(|e| format!("Failed to create WAV file: {}", e))?;
        
        // Resample ratio
        let resample_ratio = 16000.0 / sample_rate as f32;
        
        // Buffer for accumulating samples for resampling
        let mut sample_buffer: Vec<f32> = Vec::new();
        
        // Decode and convert
        loop {
            // Get the next packet
            let packet = match format.next_packet() {
                Ok(packet) => packet,
                Err(Error::IoError(_)) => break,
                Err(Error::ResetRequired) => {
                    // Reset the decoder and continue
                    decoder.reset();
                    continue;
                }
                Err(err) => return Err(format!("Decode error: {}", err)),
            };
            
            // If the packet is for our track, decode it
            if packet.track_id() != track_id {
                continue;
            }
            
            // Decode the packet
            match decoder.decode(&packet) {
                Ok(decoded) => {
                    // Convert to f32 samples
                    let samples = Self::convert_samples_to_f32(decoded);
                    
                    // Mix to mono if stereo
                    let mono_samples = if channels > 1 {
                        samples
                            .chunks(channels as usize)
                            .map(|chunk| chunk.iter().sum::<f32>() / chunk.len() as f32)
                            .collect::<Vec<f32>>()
                    } else {
                        samples
                    };
                    
                    // Add to buffer
                    sample_buffer.extend(mono_samples);
                }
                Err(Error::IoError(_)) => break,
                Err(Error::ResetRequired) => {
                    decoder.reset();
                    continue;
                }
                Err(err) => return Err(format!("Decode error: {}", err)),
            }
        }
        
        // Resample all samples
        let resampled = Self::resample(&sample_buffer, resample_ratio);
        
        // Write samples to WAV
        for sample in resampled {
            let sample_i16 = (sample.clamp(-1.0, 1.0) * 32767.0) as i16;
            wav_writer.write_sample(sample_i16)
                .map_err(|e| format!("Failed to write sample: {}", e))?;
        }
        
        // Finalize the WAV file
        wav_writer.finalize()
            .map_err(|e| format!("Failed to finalize WAV file: {}", e))?;
        
        Ok(())
    }
    
    /// Convert audio buffer to f32 samples
    fn convert_samples_to_f32(buffer: AudioBufferRef) -> Vec<f32> {
        match buffer {
            AudioBufferRef::F32(buf) => {
                let mut samples = Vec::new();
                for plane in buf.planes().planes() {
                    samples.extend_from_slice(plane);
                }
                samples
            }
            AudioBufferRef::F64(buf) => {
                let mut samples = Vec::new();
                for plane in buf.planes().planes() {
                    samples.extend(plane.iter().map(|&s| s as f32));
                }
                samples
            }
            AudioBufferRef::S32(buf) => {
                let mut samples = Vec::new();
                for plane in buf.planes().planes() {
                    samples.extend(plane.iter().map(|&s| s as f32 / i32::MAX as f32));
                }
                samples
            }
            AudioBufferRef::S16(buf) => {
                let mut samples = Vec::new();
                for plane in buf.planes().planes() {
                    samples.extend(plane.iter().map(|&s| s as f32 / i16::MAX as f32));
                }
                samples
            }
            _ => Vec::new(), // Unsupported format
        }
    }
    
    /// Resample audio data
    fn resample(samples: &[f32], ratio: f32) -> Vec<f32> {
        if ratio == 1.0 {
            return samples.to_vec();
        }
        
        let new_len = (samples.len() as f32 * ratio) as usize;
        let mut resampled = Vec::with_capacity(new_len);
        
        for i in 0..new_len {
            let src_idx = i as f32 / ratio;
            let idx = src_idx as usize;
            let frac = src_idx - idx as f32;
            
            let sample = if idx + 1 < samples.len() {
                // Linear interpolation
                samples[idx] * (1.0 - frac) + samples[idx + 1] * frac
            } else {
                samples.last().copied().unwrap_or(0.0)
            };
            
            resampled.push(sample);
        }
        
        resampled
    }

    /// Check if the file needs conversion (i.e., it's not already a WAV file)
    pub fn needs_conversion(file_path: &Path) -> bool {
        file_path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase() != "wav")
            .unwrap_or(true)
    }

    /// Get the path for the converted WAV file
    pub fn get_wav_path(original_path: &Path) -> PathBuf {
        original_path.with_extension("wav")
    }
}
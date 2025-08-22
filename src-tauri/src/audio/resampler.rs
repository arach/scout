use std::f32;

/// Simple audio resampler for downsampling from 48kHz to 16kHz
/// Uses a simple decimation approach with basic low-pass filtering
pub struct Resampler {
    from_rate: u32,
    to_rate: u32,
    ratio: usize,
}

impl Resampler {
    /// Create a new resampler
    pub fn new(from_rate: u32, to_rate: u32) -> Result<Self, String> {
        // For now, we only support 48kHz to 16kHz (3:1 ratio)
        if from_rate != 48000 || to_rate != 16000 {
            return Err(format!(
                "Currently only 48kHz to 16kHz resampling is supported (got {}Hz to {}Hz)",
                from_rate, to_rate
            ));
        }
        
        Ok(Self {
            from_rate,
            to_rate,
            ratio: 3, // 48000 / 16000 = 3
        })
    }
    
    /// Downsample audio data from 48kHz to 16kHz
    /// Uses simple decimation with averaging for anti-aliasing
    pub fn resample_f32(&self, input: &[f32], channels: u16) -> Vec<f32> {
        let channels = channels as usize;
        let samples_per_channel = input.len() / channels;
        let output_samples_per_channel = samples_per_channel / self.ratio;
        let mut output = Vec::with_capacity(output_samples_per_channel * channels);
        
        // Process each channel separately
        for channel in 0..channels {
            for i in 0..output_samples_per_channel {
                let start_idx = i * self.ratio;
                let end_idx = ((i + 1) * self.ratio).min(samples_per_channel);
                
                // Average the samples in this window (simple low-pass filter)
                let mut sum = 0.0;
                let mut count = 0;
                for j in start_idx..end_idx {
                    let sample_idx = j * channels + channel;
                    if sample_idx < input.len() {
                        sum += input[sample_idx];
                        count += 1;
                    }
                }
                
                if count > 0 {
                    output.push(sum / count as f32);
                }
            }
        }
        
        // Reinterleave channels if needed
        if channels > 1 {
            let mut interleaved = Vec::with_capacity(output.len());
            for i in 0..output_samples_per_channel {
                for channel in 0..channels {
                    let idx = channel * output_samples_per_channel + i;
                    if idx < output.len() {
                        interleaved.push(output[idx]);
                    }
                }
            }
            interleaved
        } else {
            output
        }
    }
    
    /// Downsample i16 audio data from 48kHz to 16kHz
    pub fn resample_i16(&self, input: &[i16], channels: u16) -> Vec<i16> {
        // Convert to f32, resample, then convert back
        let f32_input: Vec<f32> = input.iter()
            .map(|&s| s as f32 / 32768.0)
            .collect();
        
        let f32_output = self.resample_f32(&f32_input, channels);
        
        // Convert back to i16
        f32_output.iter()
            .map(|&s| {
                let scaled = s * 32768.0;
                if scaled > 32767.0 {
                    32767
                } else if scaled < -32768.0 {
                    -32768
                } else {
                    scaled as i16
                }
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_resampler_creation() {
        let resampler = Resampler::new(48000, 16000).unwrap();
        assert_eq!(resampler.ratio, 3);
    }
    
    #[test]
    fn test_resample_f32_mono() {
        let resampler = Resampler::new(48000, 16000).unwrap();
        let input = vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0];
        let output = resampler.resample_f32(&input, 1);
        
        // Should average every 3 samples: [2.0, 5.0, 8.0]
        assert_eq!(output.len(), 3);
        assert_eq!(output[0], 2.0); // (1+2+3)/3
        assert_eq!(output[1], 5.0); // (4+5+6)/3
        assert_eq!(output[2], 8.0); // (7+8+9)/3
    }
    
    #[test]
    fn test_resample_i16_mono() {
        let resampler = Resampler::new(48000, 16000).unwrap();
        let input = vec![3000, 6000, 9000, 12000, 15000, 18000];
        let output = resampler.resample_i16(&input, 1);
        
        assert_eq!(output.len(), 2);
        // Values will be slightly different due to f32 conversion
        assert!((output[0] - 6000).abs() < 10);
        assert!((output[1] - 15000).abs() < 10);
    }
}
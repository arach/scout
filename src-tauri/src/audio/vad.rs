use webrtc_vad::{Vad, VadMode};

#[allow(dead_code)]
pub struct VoiceActivityDetector {
    vad: Vad,
    sample_rate: u32,
}

#[allow(dead_code)]
impl VoiceActivityDetector {
    pub fn new(sample_rate: u32) -> Result<Self, String> {
        let mut vad = Vad::new();
        vad.set_mode(VadMode::Quality);
        
        Ok(Self { vad, sample_rate })
    }

    pub fn is_voice_segment(&mut self, audio_data: &[i16]) -> Result<bool, String> {
        // WebRTC VAD expects 10, 20, or 30 ms frames at specific sample rates
        // For 16kHz: 160, 320, or 480 samples
        // For 32kHz: 320, 640, or 960 samples
        // For 48kHz: 480, 960, or 1440 samples
        
        let frame_size = match self.sample_rate {
            16000 => 320, // 20ms
            32000 => 640, // 20ms  
            48000 => 960, // 20ms
            _ => return Err(format!("Unsupported sample rate: {}", self.sample_rate)),
        };

        if audio_data.len() < frame_size {
            return Ok(false);
        }

        self.vad
            .is_voice_segment(&audio_data[..frame_size])
            .map_err(|e| format!("VAD error: {:?}", e))
    }
}
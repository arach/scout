use crate::logger::{error, Component};

#[derive(serde::Serialize, Clone)]
pub struct AudioDeviceInfo {
    pub name: String,
    pub index: usize,
    pub sample_rates: Vec<u32>,
    pub channels: u16,
}

pub fn list_device_names() -> Result<Vec<String>, String> {
    use cpal::traits::{DeviceTrait, HostTrait};
    let host = cpal::default_host();
    let mut device_names = Vec::new();
    let devices = host
        .input_devices()
        .map_err(|e| format!("Failed to enumerate input devices: {}", e))?;
    for device in devices {
        match device.name() {
            Ok(name) => device_names.push(name),
            Err(e) => error(Component::Recording, &format!("Failed to get device name: {}", e)),
        }
    }
    if device_names.is_empty() {
        device_names.push("No input devices found".to_string());
    }
    Ok(device_names)
}

pub fn list_devices_detailed() -> Result<Vec<AudioDeviceInfo>, String> {
    use cpal::traits::{DeviceTrait, HostTrait};
    let host = cpal::default_host();
    let mut device_infos = Vec::new();
    let devices = host
        .input_devices()
        .map_err(|e| format!("Failed to enumerate input devices: {}", e))?;
    for (index, device) in devices.enumerate() {
        let name = device.name().unwrap_or_else(|_| format!("Unknown Device {}", index));
        let (sample_rates, channels) = match device.default_input_config() {
            Ok(config) => {
                let mut rates = vec![config.sample_rate().0];
                for &rate in &[16000, 44100, 48000, 96000] {
                    if rate != config.sample_rate().0 {
                        rates.push(rate);
                    }
                }
                (rates, config.channels())
            }
            Err(_) => (vec![48000], 2),
        };
        device_infos.push(AudioDeviceInfo { name, index, sample_rates, channels });
    }
    Ok(device_infos)
}


use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock},
    thread,
    time::{Duration, Instant},
};

use cpal::traits::{DeviceTrait, HostTrait};

use crate::logger::{error, info, Component};

// Global device capability cache to prevent repeated probing
static DEVICE_CACHE: OnceLock<Mutex<DeviceCapabilityCache>> = OnceLock::new();

#[derive(Debug, Clone)]
struct CachedDeviceInfo {
    capabilities: DeviceCapabilities,
    last_updated: Instant,
}

struct DeviceCapabilityCache {
    devices: HashMap<String, CachedDeviceInfo>,
    default_device: Option<(String, CachedDeviceInfo)>,
    cache_duration: Duration,
}

impl DeviceCapabilityCache {
    fn new() -> Self {
        Self {
            devices: HashMap::new(),
            default_device: None,
            cache_duration: Duration::from_secs(30), // Cache for 30 seconds
        }
    }

    fn get_cached_device(&self, device_name: &str) -> Option<DeviceCapabilities> {
        if let Some(cached) = self.devices.get(device_name) {
            if cached.last_updated.elapsed() < self.cache_duration {
                return Some(cached.capabilities.clone());
            }
        }
        None
    }

    fn get_cached_default_device(&self) -> Option<DeviceCapabilities> {
        if let Some((_, cached)) = &self.default_device {
            if cached.last_updated.elapsed() < self.cache_duration {
                return Some(cached.capabilities.clone());
            }
        }
        None
    }

    fn cache_device(&mut self, device_name: String, capabilities: DeviceCapabilities) {
        let cached_info = CachedDeviceInfo {
            capabilities,
            last_updated: Instant::now(),
        };
        self.devices.insert(device_name, cached_info);
    }

    fn cache_default_device(&mut self, device_name: String, capabilities: DeviceCapabilities) {
        let cached_info = CachedDeviceInfo {
            capabilities,
            last_updated: Instant::now(),
        };
        self.default_device = Some((device_name.clone(), cached_info.clone()));
        // Also cache it in the regular devices map
        self.devices.insert(device_name, cached_info);
    }

    fn clear_expired(&mut self) {
        let now = Instant::now();
        self.devices.retain(|_, cached| now.duration_since(cached.last_updated) < self.cache_duration);
        
        if let Some((_, cached)) = &self.default_device {
            if now.duration_since(cached.last_updated) >= self.cache_duration {
                self.default_device = None;
            }
        }
    }
}

/// Device change event types
#[derive(Debug, Clone)]
pub enum DeviceChangeEvent {
    /// A new device was connected
    DeviceConnected {
        name: String,
        device_type: DeviceType,
    },

    /// A device was disconnected
    DeviceDisconnected { name: String },

    /// The default device changed
    DefaultDeviceChanged {
        old_default: Option<String>,
        new_default: String,
    },

    /// A device's capabilities changed
    DeviceCapabilitiesChanged {
        name: String,
        old_capabilities: DeviceCapabilities,
        new_capabilities: DeviceCapabilities,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub enum DeviceType {
    Input,
    Output,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DeviceCapabilities {
    pub sample_rates: Vec<u32>,
    pub channels: Vec<u16>,
    pub sample_formats: Vec<String>,
    pub default_config: Option<DeviceConfig>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DeviceConfig {
    pub sample_rate: u32,
    pub channels: u16,
    pub sample_format: String,
}

/// Device monitoring service
pub struct DeviceMonitor {
    /// Current device snapshot
    current_devices: Arc<Mutex<HashMap<String, DeviceCapabilities>>>,

    /// Current default input device
    current_default: Arc<Mutex<Option<String>>>,

    /// Event callback
    event_callback: Arc<Mutex<Option<Box<dyn Fn(DeviceChangeEvent) + Send + Sync>>>>,

    /// Monitoring thread handle
    monitor_thread: Option<thread::JoinHandle<()>>,

    /// Stop signal
    should_stop: Arc<Mutex<bool>>,

    /// Monitoring interval
    check_interval: Duration,
}

impl DeviceMonitor {
    pub fn new() -> Self {
        Self {
            current_devices: Arc::new(Mutex::new(HashMap::new())),
            current_default: Arc::new(Mutex::new(None)),
            event_callback: Arc::new(Mutex::new(None)),
            monitor_thread: None,
            should_stop: Arc::new(Mutex::new(false)),
            check_interval: Duration::from_secs(2), // Check every 2 seconds
        }
    }

    /// Set the event callback for device changes
    pub fn set_event_callback<F>(&mut self, callback: F)
    where
        F: Fn(DeviceChangeEvent) + Send + Sync + 'static,
    {
        *self.event_callback.lock().unwrap() = Some(Box::new(callback));
    }

    /// Start monitoring devices
    pub fn start_monitoring(&mut self) -> Result<(), String> {
        if self.monitor_thread.is_some() {
            return Err("Monitoring already started".to_string());
        }

        // Initial device scan
        self.perform_initial_scan()?;

        // Start monitoring thread
        let current_devices = self.current_devices.clone();
        let current_default = self.current_default.clone();
        let event_callback = self.event_callback.clone();
        let should_stop = self.should_stop.clone();
        let check_interval = self.check_interval;

        *self.should_stop.lock().unwrap() = false;

        let handle = thread::spawn(move || {
            info(Component::Recording, "Device monitor thread started");

            let mut last_check = Instant::now();

            while !*should_stop.lock().unwrap() {
                thread::sleep(Duration::from_millis(50));

                if last_check.elapsed() >= check_interval {
                    if let Err(e) = Self::check_for_device_changes(
                        &current_devices,
                        &current_default,
                        &event_callback,
                    ) {
                        error(
                            Component::Recording,
                            &format!("Device monitoring error: {}", e),
                        );
                    }
                    last_check = Instant::now();
                }
            }

            info(Component::Recording, "Device monitor thread stopped");
        });

        self.monitor_thread = Some(handle);
        info(Component::Recording, "Device monitoring started");

        Ok(())
    }

    /// Stop monitoring devices
    pub fn stop_monitoring(&mut self) {
        if let Some(handle) = self.monitor_thread.take() {
            *self.should_stop.lock().unwrap() = true;

            if let Err(e) = handle.join() {
                error(
                    Component::Recording,
                    &format!("Error joining monitor thread: {:?}", e),
                );
            } else {
                info(Component::Recording, "Device monitoring stopped");
            }
        }
    }

    /// Perform initial device scan
    fn perform_initial_scan(&self) -> Result<(), String> {
        let host = cpal::default_host();

        // Scan input devices
        let input_devices = host
            .input_devices()
            .map_err(|e| format!("Failed to enumerate input devices: {}", e))?;

        let mut devices_map = HashMap::new();

        for device in input_devices {
            let name = device.name().unwrap_or_else(|_| "Unknown".to_string());

            if let Ok(capabilities) = Self::get_device_capabilities(&device) {
                devices_map.insert(name.clone(), capabilities);
                info(
                    Component::Recording,
                    &format!("Initial scan found device: {}", name),
                );
            }
        }

        // Get default device
        if let Some(default_device) = host.default_input_device() {
            if let Ok(default_name) = default_device.name() {
                *self.current_default.lock().unwrap() = Some(default_name.clone());
                info(
                    Component::Recording,
                    &format!("Initial default device: {}", default_name),
                );
            }
        }

        *self.current_devices.lock().unwrap() = devices_map;

        Ok(())
    }

    /// Check for device changes
    fn check_for_device_changes(
        current_devices: &Arc<Mutex<HashMap<String, DeviceCapabilities>>>,
        current_default: &Arc<Mutex<Option<String>>>,
        event_callback: &Arc<Mutex<Option<Box<dyn Fn(DeviceChangeEvent) + Send + Sync>>>>,
    ) -> Result<(), String> {
        let host = cpal::default_host();

        // Get current device state
        let input_devices = host
            .input_devices()
            .map_err(|e| format!("Failed to enumerate devices: {}", e))?;

        let mut new_devices = HashMap::new();

        // Build new device map
        for device in input_devices {
            let name = device.name().unwrap_or_else(|_| "Unknown".to_string());

            if let Ok(capabilities) = Self::get_device_capabilities(&device) {
                new_devices.insert(name, capabilities);
            }
        }

        // Compare with current state
        let mut current_devices_guard = current_devices.lock().unwrap();

        // Check for new devices
        for (name, capabilities) in &new_devices {
            if !current_devices_guard.contains_key(name) {
                info(
                    Component::Recording,
                    &format!("New device detected: {}", name),
                );
                Self::emit_event(
                    &event_callback,
                    DeviceChangeEvent::DeviceConnected {
                        name: name.clone(),
                        device_type: DeviceType::Input,
                    },
                );
            } else {
                // Check for capability changes
                if let Some(old_capabilities) = current_devices_guard.get(name) {
                    if old_capabilities != capabilities {
                        info(
                            Component::Recording,
                            &format!("Device capabilities changed: {}", name),
                        );
                        Self::emit_event(
                            &event_callback,
                            DeviceChangeEvent::DeviceCapabilitiesChanged {
                                name: name.clone(),
                                old_capabilities: old_capabilities.clone(),
                                new_capabilities: capabilities.clone(),
                            },
                        );
                    }
                }
            }
        }

        // Check for removed devices
        for name in current_devices_guard.keys() {
            if !new_devices.contains_key(name) {
                info(
                    Component::Recording,
                    &format!("Device disconnected: {}", name),
                );
                Self::emit_event(
                    &event_callback,
                    DeviceChangeEvent::DeviceDisconnected { name: name.clone() },
                );
            }
        }

        // Update current devices
        *current_devices_guard = new_devices;
        drop(current_devices_guard);

        // Check for default device changes
        if let Some(default_device) = host.default_input_device() {
            if let Ok(default_name) = default_device.name() {
                let mut default_guard = current_default.lock().unwrap();

                if default_guard.as_ref() != Some(&default_name) {
                    let old_default = default_guard.clone();
                    *default_guard = Some(default_name.clone());

                    info(
                        Component::Recording,
                        &format!("Default device changed to: {}", default_name),
                    );
                    Self::emit_event(
                        &event_callback,
                        DeviceChangeEvent::DefaultDeviceChanged {
                            old_default,
                            new_default: default_name,
                        },
                    );
                }
            }
        }

        Ok(())
    }

    /// Get device capabilities
    fn get_device_capabilities(device: &cpal::Device) -> Result<DeviceCapabilities, String> {
        let default_config = device
            .default_input_config()
            .map_err(|e| format!("Failed to get default config: {}", e))?;

        let mut sample_rates = Vec::new();
        let mut channels = Vec::new();
        let mut sample_formats = Vec::new();

        // Get supported configurations
        if let Ok(supported_configs) = device.supported_input_configs() {
            for supported_range in supported_configs {
                // Collect sample rates
                let min_rate = supported_range.min_sample_rate().0;
                let max_rate = supported_range.max_sample_rate().0;

                // Add common sample rates within the supported range
                for &rate in &[8000, 16000, 22050, 24000, 44100, 48000, 96000] {
                    if rate >= min_rate && rate <= max_rate && !sample_rates.contains(&rate) {
                        sample_rates.push(rate);
                    }
                }

                // Add min and max rates
                if !sample_rates.contains(&min_rate) {
                    sample_rates.push(min_rate);
                }
                if !sample_rates.contains(&max_rate) {
                    sample_rates.push(max_rate);
                }

                // Collect channels
                let channel_count = supported_range.channels();
                if !channels.contains(&channel_count) {
                    channels.push(channel_count);
                }

                // Collect sample formats
                let format_str = format!("{:?}", supported_range.sample_format());
                if !sample_formats.contains(&format_str) {
                    sample_formats.push(format_str);
                }
            }
        }

        sample_rates.sort();
        channels.sort();
        sample_formats.sort();

        Ok(DeviceCapabilities {
            sample_rates,
            channels,
            sample_formats,
            default_config: Some(DeviceConfig {
                sample_rate: default_config.sample_rate().0,
                channels: default_config.channels(),
                sample_format: format!("{:?}", default_config.sample_format()),
            }),
        })
    }

    /// Emit event to callback
    fn emit_event(
        event_callback: &Arc<Mutex<Option<Box<dyn Fn(DeviceChangeEvent) + Send + Sync>>>>,
        event: DeviceChangeEvent,
    ) {
        if let Some(ref callback) = *event_callback.lock().unwrap() {
            callback(event);
        }
    }

    /// Get current device snapshot
    pub fn get_current_devices(&self) -> HashMap<String, DeviceCapabilities> {
        self.current_devices.lock().unwrap().clone()
    }

    /// Get current default device
    pub fn get_current_default(&self) -> Option<String> {
        self.current_default.lock().unwrap().clone()
    }

    /// Get capabilities for a specific device by name
    pub fn get_device_capabilities_by_name(&self, device_name: &str) -> Option<DeviceCapabilities> {
        self.current_devices.lock().unwrap().get(device_name).cloned()
    }

    /// Get capabilities for the default input device
    pub fn get_default_device_capabilities(&self) -> Option<DeviceCapabilities> {
        let default_name = self.get_current_default()?;
        self.get_device_capabilities_by_name(&default_name)
    }

    /// Immediately probe and return device capabilities without starting monitoring (with caching)
    /// This is useful for eager device detection during initialization
    pub fn probe_device_capabilities() -> Result<HashMap<String, DeviceCapabilities>, String> {
        // Initialize cache if needed
        let cache = DEVICE_CACHE.get_or_init(|| Mutex::new(DeviceCapabilityCache::new()));
        
        let host = cpal::default_host();
        let input_devices = host
            .input_devices()
            .map_err(|e| format!("Failed to enumerate devices: {}", e))?;

        let mut devices_map = HashMap::new();
        let mut cache_hits = 0;
        let mut cache_misses = 0;
        
        for device in input_devices {
            let name = device.name().unwrap_or_else(|_| "Unknown".to_string());
            
            // Try cache first
            let capabilities = if let Ok(mut cache_guard) = cache.lock() {
                cache_guard.clear_expired();
                if let Some(cached_capabilities) = cache_guard.get_cached_device(&name) {
                    cache_hits += 1;
                    Some(cached_capabilities)
                } else {
                    None
                }
            } else {
                None
            };
            
            let capabilities = if let Some(caps) = capabilities {
                caps
            } else {
                // Cache miss - probe the device
                if let Ok(caps) = Self::get_device_capabilities(&device) {
                    cache_misses += 1;
                    
                    // Cache the result
                    if let Ok(mut cache_guard) = cache.lock() {
                        cache_guard.cache_device(name.clone(), caps.clone());
                    }
                    caps
                } else {
                    continue; // Skip devices that can't be probed
                }
            };
            
            devices_map.insert(name, capabilities);
        }
        
        if cache_hits > 0 || cache_misses > 0 {
            info(
                Component::Recording,
                &format!("📦 Device capability cache stats: {} hits, {} misses", cache_hits, cache_misses)
            );
        }

        Ok(devices_map)
    }

    /// Immediately probe the default device and return its capabilities (with caching)
    pub fn probe_default_device_capabilities() -> Option<DeviceCapabilities> {
        // Initialize cache if needed
        let cache = DEVICE_CACHE.get_or_init(|| Mutex::new(DeviceCapabilityCache::new()));
        
        // Try to get from cache first
        if let Ok(mut cache_guard) = cache.lock() {
            cache_guard.clear_expired(); // Clean up expired entries
            if let Some(cached_capabilities) = cache_guard.get_cached_default_device() {
                info(Component::Recording, "📦 Using cached default device capabilities");
                return Some(cached_capabilities);
            }
        }
        
        // Cache miss - probe the device
        let host = cpal::default_host();
        if let Some(default_device) = host.default_input_device() {
            let device_name = default_device.name().unwrap_or_else(|_| "Default Device".to_string());
            
            if let Ok(capabilities) = Self::get_device_capabilities(&default_device) {
                // Cache the result
                if let Ok(mut cache_guard) = cache.lock() {
                    cache_guard.cache_default_device(device_name, capabilities.clone());
                    info(Component::Recording, "💾 Cached default device capabilities for future use");
                }
                return Some(capabilities);
            }
        }
        None
    }

    /// Force a device check (useful for manual refresh)
    pub fn force_device_check(&self) -> Result<(), String> {
        Self::check_for_device_changes(
            &self.current_devices,
            &self.current_default,
            &self.event_callback,
        )
    }

    /// Set monitoring interval
    pub fn set_check_interval(&mut self, interval: Duration) {
        self.check_interval = interval;
    }
}

impl Drop for DeviceMonitor {
    fn drop(&mut self) {
        self.stop_monitoring();
    }
}

/// Capability checker for periodic validation during recording
pub struct DeviceCapabilityChecker {
    device_name: String,
    last_capabilities: Option<DeviceCapabilities>,
    last_check: Instant,
    check_interval: Duration,
}

impl DeviceCapabilityChecker {
    pub fn new(device_name: String, check_interval: Duration) -> Self {
        Self {
            device_name,
            last_capabilities: None,
            last_check: Instant::now(),
            check_interval,
        }
    }

    /// Check if capabilities should be verified
    pub fn should_check(&self) -> bool {
        self.last_check.elapsed() >= self.check_interval
    }

    /// Perform capability check
    pub fn check_capabilities(&mut self) -> Result<CapabilityCheckResult, String> {
        let host = cpal::default_host();

        // Find the device
        let devices = host
            .input_devices()
            .map_err(|e| format!("Failed to enumerate devices: {}", e))?;

        let device = devices
            .filter_map(|d| {
                d.name().ok().and_then(|name| {
                    if name == self.device_name {
                        Some(d)
                    } else {
                        None
                    }
                })
            })
            .next()
            .ok_or_else(|| format!("Device '{}' not found", self.device_name))?;

        let current_capabilities = DeviceMonitor::get_device_capabilities(&device)?;

        let result = if let Some(ref last_caps) = self.last_capabilities {
            if last_caps != &current_capabilities {
                CapabilityCheckResult::Changed {
                    old: last_caps.clone(),
                    new: current_capabilities.clone(),
                }
            } else {
                CapabilityCheckResult::Unchanged
            }
        } else {
            CapabilityCheckResult::FirstCheck(current_capabilities.clone())
        };

        self.last_capabilities = Some(current_capabilities);
        self.last_check = Instant::now();

        Ok(result)
    }
}

#[derive(Debug)]
pub enum CapabilityCheckResult {
    FirstCheck(DeviceCapabilities),
    Unchanged,
    Changed {
        old: DeviceCapabilities,
        new: DeviceCapabilities,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_device_config_equality() {
        let config1 = DeviceConfig {
            sample_rate: 48000,
            channels: 2,
            sample_format: "F32".to_string(),
        };

        let config2 = DeviceConfig {
            sample_rate: 48000,
            channels: 2,
            sample_format: "F32".to_string(),
        };

        assert_eq!(config1, config2);
    }

    #[test]
    fn test_device_capabilities_equality() {
        let caps1 = DeviceCapabilities {
            sample_rates: vec![44100, 48000],
            channels: vec![1, 2],
            sample_formats: vec!["F32".to_string()],
            default_config: None,
        };

        let caps2 = DeviceCapabilities {
            sample_rates: vec![44100, 48000],
            channels: vec![1, 2],
            sample_formats: vec!["F32".to_string()],
            default_config: None,
        };

        assert_eq!(caps1, caps2);
    }
}

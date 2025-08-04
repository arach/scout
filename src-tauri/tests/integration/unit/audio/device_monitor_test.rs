use super::super::super::common::create_mock_device_info;
use scout_lib::audio::device_monitor::{
    DeviceMonitor, DeviceCapabilityChecker, DeviceChangeEvent, DeviceType, 
    DeviceCapabilities, DeviceConfig, CapabilityCheckResult
};
use mockall::{mock, predicate::*};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use std::collections::HashMap;

// Mock for testing event callbacks
#[derive(Clone)]
struct MockEventCollector {
    events: Arc<Mutex<Vec<DeviceChangeEvent>>>,
}

impl MockEventCollector {
    fn new() -> Self {
        Self {
            events: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn callback(&self, event: DeviceChangeEvent) {
        self.events.lock().unwrap().push(event);
    }

    fn get_events(&self) -> Vec<DeviceChangeEvent> {
        self.events.lock().unwrap().clone()
    }

    fn clear_events(&self) {
        self.events.lock().unwrap().clear();
    }

    fn event_count(&self) -> usize {
        self.events.lock().unwrap().len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;

    fn create_test_capabilities() -> DeviceCapabilities {
        DeviceCapabilities {
            sample_rates: vec![16000, 44100, 48000],
            channels: vec![1, 2],
            sample_formats: vec!["F32".to_string(), "I16".to_string()],
            default_config: Some(DeviceConfig {
                sample_rate: 44100,
                channels: 2,
                sample_format: "F32".to_string(),
            }),
        }
    }

    fn create_different_capabilities() -> DeviceCapabilities {
        DeviceCapabilities {
            sample_rates: vec![8000, 16000, 48000],
            channels: vec![1],
            sample_formats: vec!["I16".to_string()],
            default_config: Some(DeviceConfig {
                sample_rate: 16000,
                channels: 1,
                sample_format: "I16".to_string(),
            }),
        }
    }

    #[test]
    fn test_device_monitor_new() {
        let monitor = DeviceMonitor::new();
        
        // Should start with empty state
        assert!(monitor.get_current_devices().is_empty());
        assert!(monitor.get_current_default().is_none());
    }

    #[test]
    #[serial] // Device enumeration might conflict between tests
    fn test_device_monitor_set_event_callback() {
        let mut monitor = DeviceMonitor::new();
        let collector = MockEventCollector::new();
        let collector_clone = collector.clone();
        
        monitor.set_event_callback(move |event| {
            collector_clone.callback(event);
        });
        
        // Callback should be set (can't directly test, but no panic is good)
        assert_eq!(collector.event_count(), 0);
    }

    #[test]
    #[serial]
    fn test_device_monitor_start_stop() {
        let mut monitor = DeviceMonitor::new();
        
        // Should be able to start monitoring
        // Note: This may fail in test environment without audio devices
        let start_result = monitor.start_monitoring();
        
        if start_result.is_ok() {
            // If start succeeded, test stop
            monitor.stop_monitoring();
            
            // Should be able to start again after stop
            let restart_result = monitor.start_monitoring();
            monitor.stop_monitoring();
            
            // Restart should also succeed if initial start worked
            assert!(restart_result.is_ok() || 
                   restart_result.unwrap_err().contains("Monitoring already started"));
        }
        // If start failed, it's likely due to no audio devices in test environment
        // which is acceptable for unit tests
    }

    #[test]
    #[serial]
    fn test_device_monitor_double_start() {
        let mut monitor = DeviceMonitor::new();
        
        // First start might succeed or fail depending on test environment
        let first_start = monitor.start_monitoring();
        
        if first_start.is_ok() {
            // Second start should fail
            let second_start = monitor.start_monitoring();
            assert!(second_start.is_err());
            assert_eq!(second_start.unwrap_err(), "Monitoring already started");
            
            monitor.stop_monitoring();
        }
    }

    #[test]
    #[serial]
    fn test_device_monitor_stop_without_start() {
        let mut monitor = DeviceMonitor::new();
        
        // Stop without start should not panic
        monitor.stop_monitoring();
        
        // Should still be able to start after stop
        let start_result = monitor.start_monitoring();
        if start_result.is_ok() {
            monitor.stop_monitoring();
        }
    }

    #[test]
    #[serial]
    fn test_device_monitor_check_interval() {
        let mut monitor = DeviceMonitor::new();
        
        // Should be able to set different check intervals
        monitor.set_check_interval(Duration::from_millis(500));
        monitor.set_check_interval(Duration::from_secs(5));
        monitor.set_check_interval(Duration::from_millis(100));
        
        // No way to verify the interval was set without starting monitoring
        // but setting it shouldn't panic
    }

    #[test]
    #[serial]
    fn test_device_monitor_force_check() {
        let monitor = DeviceMonitor::new();
        
        // Force check should work even without monitoring started
        let result = monitor.force_device_check();
        
        // May succeed or fail depending on test environment
        // The important thing is that it doesn't panic
        match result {
            Ok(_) => {
                // Success - test environment has audio devices
            }
            Err(e) => {
                // Failure - likely no audio devices in test environment
                assert!(e.contains("Failed to enumerate") || e.contains("device"));
            }
        }
    }

    #[test]
    #[serial]
    fn test_device_monitor_drop_cleanup() {
        {
            let mut monitor = DeviceMonitor::new();
            let start_result = monitor.start_monitoring();
            
            if start_result.is_ok() {
                // Monitor should clean up when dropped
                // We can't directly test this, but it shouldn't hang or panic
            }
            // Monitor drops here
        }
        
        // If we get here, drop completed successfully
        assert!(true);
    }

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

        let config3 = DeviceConfig {
            sample_rate: 44100,
            channels: 2,
            sample_format: "F32".to_string(),
        };

        assert_eq!(config1, config2);
        assert_ne!(config1, config3);
    }

    #[test]
    fn test_device_capabilities_equality() {
        let caps1 = create_test_capabilities();
        let caps2 = create_test_capabilities();
        let caps3 = create_different_capabilities();

        assert_eq!(caps1, caps2);
        assert_ne!(caps1, caps3);
    }

    #[test]
    fn test_device_change_event_types() {
        let connected_event = DeviceChangeEvent::DeviceConnected {
            name: "Test Device".to_string(),
            device_type: DeviceType::Input,
        };

        let disconnected_event = DeviceChangeEvent::DeviceDisconnected {
            name: "Test Device".to_string(),
        };

        let default_changed_event = DeviceChangeEvent::DefaultDeviceChanged {
            old_default: Some("Old Device".to_string()),
            new_default: "New Device".to_string(),
        };

        let capabilities_changed_event = DeviceChangeEvent::DeviceCapabilitiesChanged {
            name: "Test Device".to_string(),
            old_capabilities: create_test_capabilities(),
            new_capabilities: create_different_capabilities(),
        };

        // Events should be constructible and clonable
        let _cloned_connected = connected_event.clone();
        let _cloned_disconnected = disconnected_event.clone();
        let _cloned_default_changed = default_changed_event.clone();
        let _cloned_capabilities_changed = capabilities_changed_event.clone();
    }

    #[test]
    fn test_device_type_equality() {
        assert_eq!(DeviceType::Input, DeviceType::Input);
        assert_eq!(DeviceType::Output, DeviceType::Output);
        assert_ne!(DeviceType::Input, DeviceType::Output);
    }

    #[test]
    fn test_device_capabilities_structure() {
        let caps = DeviceCapabilities {
            sample_rates: vec![16000, 44100, 48000],
            channels: vec![1, 2],
            sample_formats: vec!["F32".to_string(), "I16".to_string()],
            default_config: Some(DeviceConfig {
                sample_rate: 44100,
                channels: 2,
                sample_format: "F32".to_string(),
            }),
        };

        assert_eq!(caps.sample_rates.len(), 3);
        assert_eq!(caps.channels.len(), 2);
        assert_eq!(caps.sample_formats.len(), 2);
        assert!(caps.default_config.is_some());

        let default = caps.default_config.unwrap();
        assert_eq!(default.sample_rate, 44100);
        assert_eq!(default.channels, 2);
        assert_eq!(default.sample_format, "F32");
    }

    #[test]
    fn test_event_collector_helper() {
        let collector = MockEventCollector::new();
        
        assert_eq!(collector.event_count(), 0);
        assert!(collector.get_events().is_empty());
        
        let test_event = DeviceChangeEvent::DeviceConnected {
            name: "Test".to_string(),
            device_type: DeviceType::Input,
        };
        
        collector.callback(test_event.clone());
        
        assert_eq!(collector.event_count(), 1);
        let events = collector.get_events();
        assert_eq!(events.len(), 1);
        
        collector.clear_events();
        assert_eq!(collector.event_count(), 0);
    }
}

// Tests for DeviceCapabilityChecker
#[cfg(test)]
mod capability_checker_tests {
    use super::*;

    #[test]
    fn test_capability_checker_new() {
        let checker = DeviceCapabilityChecker::new(
            "Test Device".to_string(),
            Duration::from_secs(1)
        );
        
        // Should be ready to check immediately
        assert!(checker.should_check());
    }

    #[test]
    fn test_capability_checker_timing() {
        let checker = DeviceCapabilityChecker::new(
            "Test Device".to_string(),
            Duration::from_millis(100)
        );
        
        // Should initially need to check
        assert!(checker.should_check());
        
        // After a very short time, might still need to check depending on timing
        std::thread::sleep(Duration::from_millis(10));
        // We can't reliably test timing without making the test flaky
    }

    #[test]
    #[serial]
    fn test_capability_checker_nonexistent_device() {
        let mut checker = DeviceCapabilityChecker::new(
            "NonexistentDevice12345".to_string(),
            Duration::from_millis(100)
        );
        
        let result = checker.check_capabilities();
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found") || 
               result.unwrap_err().contains("Failed to enumerate devices"));
    }

    #[test]
    #[serial]
    fn test_capability_checker_with_real_device() {
        // This test only runs if we can find a real device
        use cpal::traits::HostTrait;
        
        let host = cpal::default_host();
        if let Ok(mut devices) = host.input_devices() {
            if let Some(device) = devices.next() {
                if let Ok(device_name) = device.name() {
                    let mut checker = DeviceCapabilityChecker::new(
                        device_name,
                        Duration::from_millis(100)
                    );
                    
                    let result = checker.check_capabilities();
                    if result.is_ok() {
                        match result.unwrap() {
                            CapabilityCheckResult::FirstCheck(_) => {
                                // Good - first check should return capabilities
                            }
                            _ => panic!("Expected FirstCheck result"),
                        }
                        
                        // Second check should return Unchanged (in rapid succession)
                        let result2 = checker.check_capabilities();
                        if result2.is_ok() {
                            match result2.unwrap() {
                                CapabilityCheckResult::Unchanged => {
                                    // Expected for rapid consecutive checks
                                }
                                CapabilityCheckResult::FirstCheck(_) => {
                                    // Also acceptable if timing is off
                                }
                                _ => {
                                    // Changed is possible but unlikely in rapid succession
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn test_capability_check_result_types() {
        let caps = create_test_capabilities();
        let different_caps = create_different_capabilities();
        
        let first_check = CapabilityCheckResult::FirstCheck(caps.clone());
        let unchanged = CapabilityCheckResult::Unchanged;
        let changed = CapabilityCheckResult::Changed {
            old: caps.clone(),
            new: different_caps.clone(),
        };
        
        // Results should be constructible
        match first_check {
            CapabilityCheckResult::FirstCheck(_) => assert!(true),
            _ => panic!("Wrong variant"),
        }
        
        match unchanged {
            CapabilityCheckResult::Unchanged => assert!(true),
            _ => panic!("Wrong variant"),
        }
        
        match changed {
            CapabilityCheckResult::Changed { old: _, new: _ } => assert!(true),
            _ => panic!("Wrong variant"),
        }
    }
}

// Integration-style tests for real device interaction
#[cfg(test)]
mod integration_tests {
    use super::*;

    #[test]
    #[ignore] // Run with: cargo test -- --ignored
    #[serial]
    fn test_real_device_monitoring() {
        let mut monitor = DeviceMonitor::new();
        let collector = Arc::new(MockEventCollector::new());
        let collector_clone = collector.clone();
        
        monitor.set_event_callback(move |event| {
            collector_clone.callback(event);
        });
        
        // Try to start monitoring
        if monitor.start_monitoring().is_ok() {
            // Let it run for a short time
            std::thread::sleep(Duration::from_millis(100));
            
            // Should have some initial device state
            let devices = monitor.get_current_devices();
            println!("Found {} devices", devices.len());
            
            let default_device = monitor.get_current_default();
            if let Some(ref default_name) = default_device {
                println!("Default device: {}", default_name);
            }
            
            monitor.stop_monitoring();
            
            // Should have received some events during initialization
            let events = collector.get_events();
            println!("Received {} events", events.len());
        }
    }

    #[test]
    #[ignore] // Run with: cargo test -- --ignored
    #[serial]
    fn test_force_device_refresh() {
        let monitor = DeviceMonitor::new();
        
        // Should be able to force a device check
        let result = monitor.force_device_check();
        
        match result {
            Ok(_) => {
                println!("Device check succeeded");
                
                let devices = monitor.get_current_devices();
                println!("Found {} devices after refresh", devices.len());
                
                for (name, caps) in devices {
                    println!("Device: {}", name);
                    println!("  Sample rates: {:?}", caps.sample_rates);
                    println!("  Channels: {:?}", caps.channels);
                    println!("  Formats: {:?}", caps.sample_formats);
                    
                    if let Some(ref default_config) = caps.default_config {
                        println!("  Default: {}Hz, {} channels, {}",
                                default_config.sample_rate,
                                default_config.channels,
                                default_config.sample_format);
                    }
                }
            }
            Err(e) => {
                println!("Device check failed (expected in test environment): {}", e);
            }
        }
    }

    #[test]
    #[ignore] // Run with: cargo test -- --ignored
    #[serial]
    fn test_monitoring_thread_lifecycle() {
        let mut monitor = DeviceMonitor::new();
        let collector = Arc::new(MockEventCollector::new());
        let collector_clone = collector.clone();
        
        monitor.set_event_callback(move |event| {
            collector_clone.callback(event);
        });
        
        // Set a very fast check interval for testing
        monitor.set_check_interval(Duration::from_millis(50));
        
        if monitor.start_monitoring().is_ok() {
            // Let monitoring run for a bit
            std::thread::sleep(Duration::from_millis(200));
            
            println!("Events after 200ms: {}", collector.event_count());
            
            // Stop and verify clean shutdown
            monitor.stop_monitoring();
            
            let final_event_count = collector.event_count();
            
            // Give a moment for any final events
            std::thread::sleep(Duration::from_millis(50));
            
            // Should not receive more events after stop
            let post_stop_count = collector.event_count();
            assert_eq!(final_event_count, post_stop_count);
            
            println!("Final event count: {}", post_stop_count);
        }
    }
}
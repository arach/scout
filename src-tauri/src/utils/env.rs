/// Environment detection for production optimizations
pub struct Environment;

impl Environment {
    /// Check if running in production mode
    pub fn is_production() -> bool {
        // In production, Tauri doesn't pass --no-default-features
        cfg!(feature = "custom-protocol")
    }

    /// Check if running in development mode
    pub fn is_development() -> bool {
        !Self::is_production()
    }

    /// Get appropriate log level based on environment
    pub fn log_level() -> log::LevelFilter {
        if Self::is_production() {
            log::LevelFilter::Warn
        } else {
            log::LevelFilter::Debug
        }
    }

    /// Should we enable debug features
    pub fn enable_debug_features() -> bool {
        Self::is_development()
    }

    /// Get performance monitoring interval
    pub fn perf_monitor_interval_ms() -> u64 {
        if Self::is_production() {
            60000 // 1 minute in production
        } else {
            5000 // 5 seconds in development
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_environment_detection() {
        // The test environment detection depends on the feature flags
        // During tests, custom-protocol feature may be enabled
        let is_prod = Environment::is_production();
        let is_dev = Environment::is_development();
        
        // These should be opposites
        assert_eq!(is_prod, !is_dev);
        
        // Test that methods don't panic
        let _ = Environment::log_level();
        let _ = Environment::enable_debug_features();
        let _ = Environment::perf_monitor_interval_ms();
    }
}

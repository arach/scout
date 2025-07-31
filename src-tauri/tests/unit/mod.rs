// Unit tests module for Scout
//
// This module organizes all unit tests for the Scout application by component.
// Each submodule contains focused, fast-running tests with mocked dependencies.
//
// Test Organization:
// - audio/: Tests for audio recording, processing, and device management
// - transcription/: Tests for speech-to-text transcription strategies and processing
// - db/: Tests for database operations and migrations (if any)
//
// Usage:
// - Run all unit tests: `cargo test`
// - Run specific module: `cargo test transcription::`
// - Run with output: `cargo test -- --nocapture`

pub mod audio;
pub mod transcription;

// Re-export common test utilities
pub use crate::common::*;
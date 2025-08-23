-- Add comprehensive audio metadata columns to transcripts and performance_metrics tables

-- Add audio metadata columns to transcripts table
ALTER TABLE transcripts ADD COLUMN audio_metadata TEXT;

-- Add more detailed audio configuration to performance_metrics
ALTER TABLE performance_metrics ADD COLUMN audio_device_name TEXT;
ALTER TABLE performance_metrics ADD COLUMN audio_sample_rate INTEGER;
ALTER TABLE performance_metrics ADD COLUMN audio_channels INTEGER;
ALTER TABLE performance_metrics ADD COLUMN audio_bit_depth INTEGER;
ALTER TABLE performance_metrics ADD COLUMN audio_buffer_size TEXT;
ALTER TABLE performance_metrics ADD COLUMN audio_input_gain REAL;
ALTER TABLE performance_metrics ADD COLUMN requested_sample_rate INTEGER;
ALTER TABLE performance_metrics ADD COLUMN requested_channels INTEGER;

-- Create an index on device name for performance analysis
CREATE INDEX IF NOT EXISTS idx_performance_metrics_device ON performance_metrics(audio_device_name);

-- Create a new table for tracking audio configuration mismatches
CREATE TABLE IF NOT EXISTS audio_config_mismatches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transcript_id INTEGER,
    performance_metric_id INTEGER,
    mismatch_type TEXT NOT NULL CHECK (mismatch_type IN ('sample_rate', 'channels', 'format', 'buffer_size', 'other')),
    requested_value TEXT,
    actual_value TEXT,
    potential_impact TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE,
    FOREIGN KEY (performance_metric_id) REFERENCES performance_metrics(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_audio_mismatches_transcript ON audio_config_mismatches(transcript_id);
CREATE INDEX IF NOT EXISTS idx_audio_mismatches_type ON audio_config_mismatches(mismatch_type);
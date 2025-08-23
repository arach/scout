-- Create performance_metrics table to track recording and transcription performance
CREATE TABLE IF NOT EXISTS performance_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transcript_id INTEGER,
    recording_duration_ms INTEGER NOT NULL,
    transcription_time_ms INTEGER NOT NULL,
    user_perceived_latency_ms INTEGER,
    processing_queue_time_ms INTEGER,
    model_used TEXT,
    audio_file_size_bytes INTEGER,
    audio_format TEXT,
    success BOOLEAN NOT NULL DEFAULT 1,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT,
    FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE
);

-- Create indices for common queries
CREATE INDEX idx_performance_metrics_created_at ON performance_metrics(created_at);
CREATE INDEX idx_performance_metrics_transcript_id ON performance_metrics(transcript_id);
CREATE INDEX idx_performance_metrics_success ON performance_metrics(success);
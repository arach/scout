-- Create whisper_logs table to store detailed transcription logs
CREATE TABLE IF NOT EXISTS whisper_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    transcript_id INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    level TEXT NOT NULL CHECK (level IN ('DEBUG', 'INFO', 'WARN', 'ERROR')),
    component TEXT NOT NULL,
    message TEXT NOT NULL,
    metadata TEXT, -- JSON field for additional data
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE
);

-- Index for querying by session
CREATE INDEX idx_whisper_logs_session_id ON whisper_logs(session_id);

-- Index for querying by transcript
CREATE INDEX idx_whisper_logs_transcript_id ON whisper_logs(transcript_id);

-- Index for querying by timestamp
CREATE INDEX idx_whisper_logs_timestamp ON whisper_logs(timestamp);

-- Index for filtering by level
CREATE INDEX idx_whisper_logs_level ON whisper_logs(level);
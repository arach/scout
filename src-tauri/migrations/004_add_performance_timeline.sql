-- Create performance_timeline_events table to store detailed timeline data
CREATE TABLE IF NOT EXISTS performance_timeline_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transcript_id INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    timestamp DATETIME NOT NULL,
    event_type TEXT NOT NULL,
    details TEXT NOT NULL,
    duration_from_start_ms INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE
);

-- Index for querying by transcript
CREATE INDEX idx_performance_timeline_transcript_id ON performance_timeline_events(transcript_id);

-- Index for querying by session
CREATE INDEX idx_performance_timeline_session_id ON performance_timeline_events(session_id);

-- Index for ordering by timestamp
CREATE INDEX idx_performance_timeline_timestamp ON performance_timeline_events(timestamp);
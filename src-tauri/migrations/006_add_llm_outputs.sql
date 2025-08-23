-- Create table for storing LLM outputs
CREATE TABLE IF NOT EXISTS llm_outputs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transcript_id INTEGER NOT NULL,
    prompt_id TEXT NOT NULL,
    prompt_name TEXT NOT NULL,
    prompt_template TEXT NOT NULL,
    input_text TEXT NOT NULL,
    output_text TEXT NOT NULL,
    model_used TEXT NOT NULL,
    processing_time_ms INTEGER NOT NULL,
    temperature REAL NOT NULL,
    max_tokens INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT,
    FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_llm_outputs_transcript_id ON llm_outputs(transcript_id);
CREATE INDEX IF NOT EXISTS idx_llm_outputs_prompt_id ON llm_outputs(prompt_id);
CREATE INDEX IF NOT EXISTS idx_llm_outputs_created_at ON llm_outputs(created_at);

-- Create table for custom prompt templates
CREATE TABLE IF NOT EXISTS llm_prompt_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    template TEXT NOT NULL,
    category TEXT NOT NULL,
    enabled BOOLEAN DEFAULT 1,
    is_custom BOOLEAN DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default prompt templates
INSERT OR IGNORE INTO llm_prompt_templates (id, name, description, template, category, enabled, is_custom) VALUES
    ('summarize', 'Summarize', 'Create a concise summary of the transcript', 'Please provide a concise summary of the following transcript in 2-3 sentences:\n\n{transcript}', 'summarization', 1, 0),
    ('bullet_points', 'Bullet Points', 'Convert transcript to bullet points', 'Convert the following transcript into clear bullet points:\n\n{transcript}', 'formatting', 1, 0),
    ('action_items', 'Extract Action Items', 'Extract actionable tasks from the transcript', 'Extract all action items and tasks from the following transcript. List each one as a checkbox:\n\n{transcript}', 'extraction', 1, 0),
    ('fix_grammar', 'Fix Grammar', 'Correct grammar and punctuation errors', 'Please correct any grammar, spelling, and punctuation errors in the following transcript while preserving the original meaning:\n\n{transcript}', 'formatting', 1, 0),
    ('meeting_notes', 'Meeting Notes', 'Format as structured meeting notes', 'Format the following transcript as structured meeting notes with sections for: Key Topics, Decisions Made, Action Items, and Next Steps:\n\n{transcript}', 'formatting', 0, 0),
    ('key_points', 'Key Points', 'Extract the most important points', 'Identify and list the 3-5 most important points from the following transcript:\n\n{transcript}', 'extraction', 0, 0);
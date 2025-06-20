import React from 'react';
import './SessionTranscripts.css';

interface Transcript {
    id: number;
    text: string;
    duration_ms: number;
    created_at: string;
    metadata?: string;
    audio_path?: string;
    file_size?: number;
}

interface SessionTranscriptsProps {
    transcripts: Transcript[];
    formatDuration: (ms: number) => string;
}

export function SessionTranscripts({ transcripts, formatDuration }: SessionTranscriptsProps) {
    if (transcripts.length === 0) {
        return null;
    }

    const formatTime = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit',
            second: '2-digit'
        });
    };

    return (
        <div className="session-transcripts">
            <h3 className="session-header">Recent Transcripts</h3>
            <div className="session-list">
                {transcripts.map((transcript) => (
                    <div key={transcript.id} className="session-item">
                        <div className="session-item-header">
                            <span className="session-time">{formatTime(transcript.created_at)}</span>
                            <span className="session-duration">{formatDuration(transcript.duration_ms)}</span>
                        </div>
                        <p className="session-text">
                            {transcript.text === "[BLANK_AUDIO]" ? (
                                <span className="session-empty">No speech detected</span>
                            ) : (
                                transcript.text
                            )}
                        </p>
                    </div>
                ))}
            </div>
        </div>
    );
}
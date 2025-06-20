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
    showDeleteConfirmation: (id: number, text: string) => void;
}

export function SessionTranscripts({ transcripts, formatDuration, showDeleteConfirmation }: SessionTranscriptsProps) {
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
                            <button
                                className="session-delete-button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    showDeleteConfirmation(transcript.id, transcript.text);
                                }}
                                title="Delete transcript"
                            >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="3,6 5,6 21,6"></polyline>
                                    <path d="m19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2"></path>
                                    <line x1="10" y1="11" x2="10" y2="17"></line>
                                    <line x1="14" y1="11" x2="14" y2="17"></line>
                                </svg>
                            </button>
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
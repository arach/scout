import React, { useEffect, useState } from 'react';
import { SimpleAudioPlayer } from './SimpleAudioPlayer';
import './TranscriptDetailPanel.css';

interface Transcript {
    id: number;
    text: string;
    duration_ms: number;
    created_at: string;
    metadata?: string;
    audio_path?: string;
    file_size?: number;
}

interface TranscriptDetailPanelProps {
    transcript: Transcript | null;
    isOpen: boolean;
    onClose: () => void;
    onCopy: (text: string) => void;
    onDelete: (id: number, text: string) => void;
    onExport: (transcripts: Transcript[], format: 'json' | 'markdown' | 'text') => void;
    formatDuration: (ms: number) => string;
    formatFileSize?: (bytes: number) => string;
}

export function TranscriptDetailPanel({
    transcript,
    isOpen,
    onClose,
    onCopy,
    onDelete,
    onExport,
    formatDuration,
    formatFileSize,
}: TranscriptDetailPanelProps) {
    const [canRenderPlayer, setCanRenderPlayer] = useState(false);

    // Handle ESC key to close panel and manage player rendering
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };
        document.addEventListener('keydown', handleKeyDown);

        let timer: number;
        if (isOpen) {
            // Delay rendering the heavy WaveformPlayer component to avoid issues with
            // animations and React's StrictMode double-render in dev.
            timer = setTimeout(() => {
                setCanRenderPlayer(true);
            }, 200);
        } else {
            setCanRenderPlayer(false);
        }

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            clearTimeout(timer);
        };
    }, [isOpen, onClose]);

    const handleExport = (format: 'json' | 'markdown' | 'text') => {
        onExport([transcript!], format);
    };

    if (!isOpen || !transcript) return null;

    // Parse metadata if available
    let metadata: any = {};
    try {
        metadata = transcript.metadata ? JSON.parse(transcript.metadata) : {};
    } catch (e) {
        // Invalid JSON, ignore
    }

    return (
        <>
            <div className="detail-panel-backdrop" onClick={(e) => {
                e.stopPropagation();
                onClose();
            }} />
            <div className="transcript-detail-panel" onClick={(e) => e.stopPropagation()}>
                <div className="detail-panel-header">
                    <h2>Transcript Details</h2>
                    <button className="close-button" onClick={(e) => {
                        e.stopPropagation();
                        onClose();
                    }} title="Close (ESC)">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M10.5 3.5L3.5 10.5M3.5 3.5L10.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                    </button>
                </div>

                <div className="detail-panel-content">
                    <div className="detail-metadata">
                        <div className="metadata-item">
                            <span className="metadata-label">Date</span>
                            <span className="metadata-value">
                                {new Date(transcript.created_at).toLocaleDateString('en-US', { 
                                    weekday: 'long', 
                                    year: 'numeric', 
                                    month: 'long', 
                                    day: 'numeric' 
                                })}
                            </span>
                        </div>
                        <div className="metadata-item">
                            <span className="metadata-label">Time</span>
                            <span className="metadata-value">
                                {new Date(transcript.created_at).toLocaleTimeString()}
                            </span>
                        </div>
                        <div className="metadata-item">
                            <span className="metadata-label">Duration</span>
                            <span className="metadata-value">{formatDuration(transcript.duration_ms)}</span>
                        </div>
                        {metadata.model_used && (
                            <div className="metadata-item">
                                <span className="metadata-label">Model</span>
                                <span className="metadata-value">{metadata.model_used}</span>
                            </div>
                        )}
                        {metadata.filename && (
                            <div className="metadata-item">
                                <span className="metadata-label">Source</span>
                                <span className="metadata-value" title={metadata.filename}>
                                    {metadata.filename.split('/').pop()}
                                </span>
                            </div>
                        )}
                        {transcript.file_size && formatFileSize && (
                            <div className="metadata-item">
                                <span className="metadata-label">File Size</span>
                                <span className="metadata-value">
                                    {formatFileSize(transcript.file_size)}
                                </span>
                            </div>
                        )}
                    </div>

                    {transcript.audio_path && canRenderPlayer && (
                        <SimpleAudioPlayer
                            audioPath={transcript.audio_path}
                            duration={transcript.duration_ms}
                            formatDuration={formatDuration}
                        />
                    )}

                    <div className="detail-transcript">
                        <h3>Transcript</h3>
                        <div className="transcript-full-text">
                            {transcript.text === "[BLANK_AUDIO]" ? (
                                <p className="transcript-empty">No speech detected in this recording.</p>
                            ) : (
                                <p>{transcript.text}</p>
                            )}
                        </div>
                    </div>

                    <div className="detail-actions">
                        <button 
                            className="action-button primary"
                            onClick={() => onCopy(transcript.text)}
                        >
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <rect x="3" y="3" width="8" height="8" stroke="currentColor" strokeWidth="1" rx="1"/>
                                <path d="M3 7H2C1.44772 7 1 6.55228 1 6V2C1 1.44772 1.44772 1 2 1H6C6.55228 1 7 1.44772 7 2V3" stroke="currentColor" strokeWidth="1"/>
                            </svg>
                            Copy Text
                        </button>
                        
                        <div className="export-dropdown">
                            <button className="action-button">
                                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M7 1V9M7 9L4 6M7 9L10 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M1 10V12C1 12.5523 1.44772 13 2 13H12C12.5523 13 13 12.5523 13 12V10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                </svg>
                                Export
                            </button>
                            <div className="export-dropdown-menu">
                                <button onClick={() => handleExport('json')}>Export as JSON</button>
                                <button onClick={() => handleExport('markdown')}>Export as Markdown</button>
                                <button onClick={() => handleExport('text')}>Export as Text</button>
                            </div>
                        </div>

                        <button 
                            className="action-button danger"
                            onClick={() => onDelete(transcript.id, transcript.text)}
                        >
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M2 4H12M5 4V2.5C5 2.22386 5.22386 2 5.5 2H8.5C8.77614 2 9 2.22386 9 2.5V4M6 7V10M8 7V10M3 4L4 11.5C4 11.7761 4.22386 12 4.5 12H9.5C9.77614 12 10 11.7761 10 11.5L11 4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                            Delete
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}
import { useEffect, useState } from 'react';
import { SimpleAudioPlayer } from './SimpleAudioPlayer';
import { invoke } from '@tauri-apps/api/core';
import { parseTranscriptMetadata } from '../types/transcript';
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

interface PerformanceMetrics {
    id: number;
    transcript_id: number | null;
    recording_duration_ms: number;
    transcription_time_ms: number;
    user_perceived_latency_ms: number | null;
    processing_queue_time_ms: number | null;
    model_used: string | null;
    transcription_strategy: string | null;
    audio_file_size_bytes: number | null;
    audio_format: string | null;
    success: boolean;
    error_message: string | null;
    created_at: string;
    metadata: string | null;
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
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [performanceMetrics, setPerformanceMetrics] = useState<PerformanceMetrics | null>(null);
    const [loadingMetrics, setLoadingMetrics] = useState(false);
    const [metricsError, setMetricsError] = useState<string | null>(null);
    const [showOriginalTranscript, setShowOriginalTranscript] = useState(false);

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
            }, 200) as unknown as number;
        } else {
            setCanRenderPlayer(false);
        }

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            clearTimeout(timer);
        };
    }, [isOpen, onClose]);
    
    // Handle click outside for export menu
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (!target.closest('.export-dropdown')) {
                setShowExportMenu(false);
            }
        };
        
        if (showExportMenu) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => {
                document.removeEventListener('mousedown', handleClickOutside);
            };
        }
    }, [showExportMenu]);

    // Fetch performance metrics when transcript changes
    useEffect(() => {
        if (isOpen && transcript) {
            setLoadingMetrics(true);
            setPerformanceMetrics(null);
            setMetricsError(null);
            setShowOriginalTranscript(false); // Reset to filtered view
            
            invoke<PerformanceMetrics | null>('get_performance_metrics_for_transcript', {
                transcriptId: transcript.id
            }).then((metrics) => {
                setPerformanceMetrics(metrics);
                setMetricsError(null);
            }).catch((error) => {
                console.error('Failed to fetch performance metrics:', error);
                setMetricsError(error.toString());
                setPerformanceMetrics(null);
            }).finally(() => {
                setLoadingMetrics(false);
            });
        }
    }, [isOpen, transcript?.id]);

    const handleExport = (format: 'json' | 'markdown' | 'text') => {
        onExport([transcript!], format);
    };

    if (!isOpen || !transcript) return null;

    // Parse metadata if available
    const metadata = parseTranscriptMetadata(transcript.metadata) || {};

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
                        {metadata.app_context && (
                            <div className="metadata-item">
                                <span className="metadata-label">App</span>
                                <span className="metadata-value" title={metadata.app_context.bundle_id}>
                                    {metadata.app_context.name}
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
                        
                        {/* Profanity Filter Status */}
                        {metadata.original_transcript && (
                            <div className="metadata-item">
                                <span className="metadata-label">Content Filter</span>
                                <span className="metadata-value">
                                    {metadata.original_transcript !== transcript.text ? (
                                        <span className="metadata-badge warning">
                                            🚫 Filtered
                                        </span>
                                    ) : metadata.filter_analysis && metadata.filter_analysis.length > 0 ? (
                                        <span className="metadata-badge info">
                                            ✅ Clean with notes
                                        </span>
                                    ) : (
                                        <span className="metadata-badge success">
                                            ✅ Clean
                                        </span>
                                    )}
                                </span>
                            </div>
                        )}
                        
                        {/* Filter Analysis */}
                        {metadata.filter_analysis && metadata.filter_analysis.length > 0 && (
                            <div className="metadata-item filter-analysis">
                                <span className="metadata-label">Filter Notes</span>
                                <div className="metadata-value">
                                    <div className="filter-analysis-logs">
                                        {metadata.filter_analysis.map((log, index) => (
                                            <div key={index} className="filter-log">
                                                {log}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                        
                        {/* Performance Metrics */}
                        {loadingMetrics && (
                            <div className="metadata-item">
                                <span className="metadata-label">Performance</span>
                                <span className="metadata-value">Loading metrics...</span>
                            </div>
                        )}
                        
                        {!loadingMetrics && !performanceMetrics && !metricsError && (
                            <div className="metadata-item">
                                <span className="metadata-label">Performance</span>
                                <span className="metadata-value">
                                    <span className="metadata-badge info">📊 No metrics available</span>
                                </span>
                            </div>
                        )}
                        
                        {!loadingMetrics && metricsError && (
                            <div className="metadata-item">
                                <span className="metadata-label">Performance</span>
                                <span className="metadata-value">
                                    <span className="metadata-badge warning">⚠️ Error loading metrics</span>
                                </span>
                            </div>
                        )}
                        
                        {!loadingMetrics && performanceMetrics && (
                            <>
                                <div className="metadata-item">
                                    <span className="metadata-label">Transcription Time</span>
                                    <span className="metadata-value">
                                        {formatDuration(performanceMetrics.transcription_time_ms)}
                                        <span className="metadata-ratio">
                                            {` (${(performanceMetrics.transcription_time_ms / transcript.duration_ms).toFixed(2)}x speed)`}
                                        </span>
                                    </span>
                                </div>
                                
                                {performanceMetrics.transcription_strategy && (
                                    <div className="metadata-item">
                                        <span className="metadata-label">Strategy</span>
                                        <span className="metadata-value">
                                            {performanceMetrics.transcription_strategy}
                                            {performanceMetrics.transcription_strategy === 'ring_buffer' && ' (Chunked)'}
                                            {performanceMetrics.transcription_strategy === 'classic' && ' (Single-pass)'}
                                        </span>
                                    </div>
                                )}
                                
                                {performanceMetrics.user_perceived_latency_ms && (
                                    <div className="metadata-item">
                                        <span className="metadata-label">Processing Latency</span>
                                        <span className="metadata-value">
                                            {formatDuration(performanceMetrics.user_perceived_latency_ms)}
                                            {performanceMetrics.user_perceived_latency_ms < 300 && (
                                                <span className="metadata-badge success"> ⚡ Fast</span>
                                            )}
                                            {performanceMetrics.user_perceived_latency_ms >= 1000 && (
                                                <span className="metadata-badge warning"> ⚠️ Slow</span>
                                            )}
                                        </span>
                                    </div>
                                )}
                                
                                {performanceMetrics.transcription_time_ms < transcript.duration_ms && (
                                    <div className="metadata-item">
                                        <span className="metadata-label">Efficiency</span>
                                        <span className="metadata-value">
                                            <span className="metadata-badge success">
                                                ✅ Faster than real-time
                                            </span>
                                        </span>
                                    </div>
                                )}
                            </>
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
                        <div className="transcript-header">
                            <h3>Transcript</h3>
                            {metadata.original_transcript && metadata.original_transcript !== transcript.text && (
                                <div className="transcript-toggle">
                                    <button 
                                        className={`toggle-button ${!showOriginalTranscript ? 'active' : ''}`}
                                        onClick={() => setShowOriginalTranscript(false)}
                                    >
                                        Filtered
                                    </button>
                                    <button 
                                        className={`toggle-button ${showOriginalTranscript ? 'active' : ''}`}
                                        onClick={() => setShowOriginalTranscript(true)}
                                    >
                                        Original
                                    </button>
                                </div>
                            )}
                        </div>
                        
                        <div className="transcript-full-text">
                            {transcript.text === "[BLANK_AUDIO]" ? (
                                <p className="transcript-empty">No speech detected in this recording.</p>
                            ) : (
                                <div className="transcript-content">
                                    {showOriginalTranscript && metadata.original_transcript ? (
                                        <div className="transcript-original">
                                            <p>{metadata.original_transcript}</p>
                                            {metadata.original_transcript !== transcript.text && (
                                                <div className="transcript-diff-note">
                                                    <span className="diff-icon">🚫</span>
                                                    <span>This version contains content that was filtered from the final transcript</span>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <p>{transcript.text}</p>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="detail-actions">
                        <button 
                            className="action-button primary"
                            onClick={() => onCopy(showOriginalTranscript && metadata.original_transcript ? metadata.original_transcript : transcript.text)}
                        >
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <rect x="3" y="3" width="8" height="8" stroke="currentColor" strokeWidth="1" rx="1"/>
                                <path d="M3 7H2C1.44772 7 1 6.55228 1 6V2C1 1.44772 1.44772 1 2 1H6C6.55228 1 7 1.44772 7 2V3" stroke="currentColor" strokeWidth="1"/>
                            </svg>
                            Copy Text
                        </button>
                        
                        <div className="export-dropdown">
                            <button 
                                className="action-button"
                                onClick={() => setShowExportMenu(!showExportMenu)}
                            >
                                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M7 1V9M7 9L4 6M7 9L10 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M1 10V12C1 12.5523 1.44772 13 2 13H12C12.5523 13 13 12.5523 13 12V10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                </svg>
                                Export
                            </button>
                            {showExportMenu && (
                                <div className="export-dropdown-menu">
                                    <button onClick={() => {
                                        handleExport('json');
                                        setShowExportMenu(false);
                                    }}>Export as JSON</button>
                                    <button onClick={() => {
                                        handleExport('markdown');
                                        setShowExportMenu(false);
                                    }}>Export as Markdown</button>
                                    <button onClick={() => {
                                        handleExport('text');
                                        setShowExportMenu(false);
                                    }}>Export as Text</button>
                                </div>
                            )}
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
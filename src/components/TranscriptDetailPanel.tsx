import { useEffect, useState } from 'react';
import { SimpleAudioPlayer } from './SimpleAudioPlayer';
import { TranscriptAIInsights } from './TranscriptAIInsights';
import { PerformanceTimeline } from './PerformanceTimeline';
import { invoke } from '@tauri-apps/api/core';
import { parseTranscriptMetadata, parseAudioMetadata, Transcript } from '../types/transcript';
import { useResizable } from '../hooks/useResizable';
import './TranscriptDetailPanel.css';

// Icon components for better visual scanning
const CalendarIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="3" width="12" height="11" rx="1" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M2 6H14" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M5 1V3M11 1V3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
);

const FileIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 2C3 1.44772 3.44772 1 4 1H9L13 5V13C13 13.5523 12.5523 14 12 14H4C3.44772 14 3 13.5523 3 13V2Z" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M9 1V5H13" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
);

const ClockIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M8 4V8L10.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
);

const ChipIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="4" y="4" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M2 6H4M2 10H4M12 6H14M12 10H14M6 2V4M10 2V4M6 12V14M10 12V14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
);

const MicrophoneIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="6" y="2" width="4" height="7" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M4 7V8C4 10.2091 5.79086 12 8 12C10.2091 12 12 10.2091 12 8V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M8 12V14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
);

const SpeedIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M2 8C2 4.68629 4.68629 2 8 2C11.3137 2 14 4.68629 14 8C14 9.88457 13.2096 11.5837 11.9497 12.75H4.05025C2.79036 11.5837 2 9.88457 2 8Z" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M8 8L10.5 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="8" cy="8" r="1" fill="currentColor"/>
    </svg>
);

const ShieldCheckIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 1L3 3V7C3 10.5 5.5 13.5 8 14C10.5 13.5 13 10.5 13 7V3L8 1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
        <path d="M6 8L7.5 9.5L10 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
);

const ExpandIcon = ({ expanded }: { expanded: boolean }) => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" 
         style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
        <path d="M4 3L7 6L4 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
);

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
    const [activeTab, setActiveTab] = useState<'transcript' | 'insights' | 'logs' | 'performance'>('transcript');
    const [whisperLogs, setWhisperLogs] = useState<any[]>([]);
    const [loadingLogs, setLoadingLogs] = useState(false);
    const [expandedSections, setExpandedSections] = useState<{ [key: string]: boolean }>({});
    const [expandedCards, setExpandedCards] = useState<{ [key: string]: boolean }>({});
    
    const { width, isResizing, resizeHandleProps } = useResizable({
        minWidth: 400,
        maxWidth: 1200,
        defaultWidth: 600
    });

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

    // Fetch whisper logs when logs tab is active
    useEffect(() => {
        if (isOpen && transcript && activeTab === 'logs') {
            setLoadingLogs(true);
            setWhisperLogs([]);
            
            invoke<any[]>('get_whisper_logs_for_transcript', {
                transcriptId: transcript.id,
                limit: 1000
            }).then((logs) => {
                setWhisperLogs(logs);
            }).catch((error) => {
                console.error('Failed to fetch whisper logs:', error);
                setWhisperLogs([]);
            }).finally(() => {
                setLoadingLogs(false);
            });
        }
    }, [isOpen, transcript?.id, activeTab]);

    const handleExport = (format: 'json' | 'markdown' | 'text') => {
        onExport([transcript!], format);
    };

    const toggleSection = (section: string) => {
        setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
    };
    
    const toggleCard = (card: string) => {
        setExpandedCards(prev => ({ ...prev, [card]: !prev[card] }));
    };

    const getDeviceSummary = () => {
        if (!audioMetadata) return null;
        const parts = [];
        
        // Device name
        parts.push(audioMetadata.device.name);
        
        // Sample rate
        parts.push(`${audioMetadata.format.sample_rate} Hz`);
        
        // OS
        parts.push(audioMetadata.system.os);
        
        return parts.join(' • ');
    };

    const getDeviceConnectionType = (device: any) => {
        const name = device.name.toLowerCase();
        
        if (device.device_type) {
            // Map existing device types to better connection descriptions
            switch (device.device_type.toLowerCase()) {
                case 'airpods':
                    return 'Bluetooth';
                case 'bluetooth':
                    return 'Bluetooth';
                case 'usb':
                    return 'USB';
                case 'built-in':
                    return 'Built-in';
                case 'headset':
                    // Try to determine connection type from name
                    if (name.includes('usb')) return 'USB';
                    if (name.includes('bluetooth') || name.includes('wireless')) return 'Bluetooth';
                    if (name.includes('3.5mm') || name.includes('jack')) return '3.5mm Jack';
                    return 'Wired';
                default:
                    return device.device_type;
            }
        }
        
        // Fallback detection from device name
        if (name.includes('airpod')) return 'Bluetooth';
        if (name.includes('bluetooth') || name.includes('wireless')) return 'Bluetooth';
        if (name.includes('usb')) return 'USB';
        if (name.includes('built-in') || name.includes('internal')) return 'Built-in';
        if (name.includes('3.5mm') || name.includes('jack') || name.includes('aux')) return '3.5mm Jack';
        if (name.includes('thunderbolt')) return 'Thunderbolt';
        if (name.includes('hdmi')) return 'HDMI';
        if (name.includes('displayport') || name.includes('display port')) return 'DisplayPort';
        if (name.includes('external')) return 'External';
        
        // Default to wired if we can't determine
        return 'Wired';
    };

    if (!isOpen || !transcript) return null;

    // Parse metadata if available
    const metadata = parseTranscriptMetadata(transcript.metadata) || {};
    const audioMetadata = parseAudioMetadata(transcript.audio_metadata);

    return (
        <>
            <div className="detail-panel-backdrop" onClick={(e) => {
                e.stopPropagation();
                onClose();
            }} style={{ position: 'fixed', inset: 0 }} />
            <div 
                className={`transcript-detail-panel ${isResizing ? 'resizing' : ''}`} 
                onClick={(e) => e.stopPropagation()}
                style={{ 
                    width: `${width}px`,
                    position: 'fixed',
                    top: 0,
                    right: 0,
                    bottom: 0,
                    height: '100vh'
                }}
            >
                <div className="resize-handle" {...resizeHandleProps} />
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
                    {/* Card Grid for Metadata */}
                    <div className="card-grid">
                        {/* Date & Time Card */}
                        <div className="info-card">
                            <div className="card-header">
                                <div className="card-icon">
                                    <CalendarIcon />
                                </div>
                                <h3 className="card-title">Date & Time</h3>
                            </div>
                            <div className="card-content">
                                <div className="card-value">
                                    {new Date(transcript.created_at).toLocaleDateString('en-US', { 
                                        month: 'short', 
                                        day: 'numeric',
                                        year: 'numeric' 
                                    })}
                                </div>
                                <div className="card-subtitle">
                                    {new Date(transcript.created_at).toLocaleTimeString([], { 
                                        hour: '2-digit', 
                                        minute: '2-digit'
                                    })}
                                </div>
                            </div>
                        </div>
                        
                        {/* Duration Card */}
                        <div className="info-card">
                            <div className="card-header">
                                <div className="card-icon">
                                    <ClockIcon />
                                </div>
                                <h3 className="card-title">Duration</h3>
                            </div>
                            <div className="card-content">
                                <div className="card-value">{formatDuration(transcript.duration_ms)}</div>
                                {transcript.duration_ms > 60000 && (
                                    <div className="card-subtitle">
                                        {Math.round(transcript.duration_ms / 60000)} minutes
                                    </div>
                                )}
                            </div>
                        </div>
                        
                        {/* File Info Card */}
                        {(metadata.filename || transcript.file_size) && (
                            <div className="info-card">
                                <div className="card-header">
                                    <div className="card-icon">
                                        <FileIcon />
                                    </div>
                                    <h3 className="card-title">File Info</h3>
                                </div>
                                <div className="card-content">
                                    {metadata.filename && (
                                        <div className="card-value" title={metadata.filename}>
                                            {metadata.filename.split('/').pop()}
                                        </div>
                                    )}
                                    {transcript.file_size && formatFileSize && (
                                        <div className="card-subtitle">
                                            {formatFileSize(transcript.file_size)}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                        
                        {/* Content Filter Card */}
                        {metadata.original_transcript && (
                            <div className={`info-card ${metadata.original_transcript !== transcript.text ? 'card-warning' : 'card-success'}`}>
                                <div className="card-header">
                                    <div className="card-icon">
                                        <ShieldCheckIcon />
                                    </div>
                                    <h3 className="card-title">Content Filter</h3>
                                </div>
                                <div className="card-content">
                                    <div className="card-value">
                                        {metadata.original_transcript !== transcript.text ? (
                                            <>🚫 Filtered</>
                                        ) : metadata.filter_analysis && metadata.filter_analysis.length > 0 ? (
                                            <>✅ Clean with notes</>
                                        ) : (
                                            <>✅ Clean</>
                                        )}
                                    </div>
                                    {metadata.filter_analysis && metadata.filter_analysis.length > 0 && (
                                        <button 
                                            className="card-expand-btn" 
                                            onClick={() => toggleCard('filter')}
                                        >
                                            View notes <ExpandIcon expanded={expandedCards.filter} />
                                        </button>
                                    )}
                                </div>
                                {expandedCards.filter && metadata.filter_analysis && (
                                    <div className="card-expanded-content">
                                        {metadata.filter_analysis.map((log, index) => (
                                            <div key={index} className="filter-log">
                                                {log}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    {/* Performance Metrics Card Grid */}
                    {performanceMetrics && (
                        <>
                            <h4 className="section-title">Performance Metrics</h4>
                            <div className="card-grid">
                                {/* Model Card */}
                                {metadata.model_used && (
                                    <div className="info-card">
                                        <div className="card-header">
                                            <div className="card-icon">
                                                <ChipIcon />
                                            </div>
                                            <h3 className="card-title">AI Model</h3>
                                        </div>
                                        <div className="card-content">
                                            <div className="card-value" title={metadata.model_used}>
                                                {metadata.model_used.split('/').pop()?.replace('.bin', '')}
                                            </div>
                                            {performanceMetrics.transcription_strategy && (
                                                <div className="card-subtitle">
                                                    {performanceMetrics.transcription_strategy === 'ring_buffer' ? 'Chunked' : 'Single-pass'}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                                
                                {/* Speed Card */}
                                <div className={`info-card ${performanceMetrics.transcription_time_ms < transcript.duration_ms ? 'card-success' : ''}`}>
                                    <div className="card-header">
                                        <div className="card-icon">
                                            <SpeedIcon />
                                        </div>
                                        <h3 className="card-title">Processing Speed</h3>
                                    </div>
                                    <div className="card-content">
                                        <div className="card-value">
                                            {(performanceMetrics.transcription_time_ms / transcript.duration_ms).toFixed(2)}x
                                        </div>
                                        <div className="card-subtitle">
                                            {performanceMetrics.transcription_time_ms < transcript.duration_ms ? 'Faster than real-time' : 'Processing time'}
                                        </div>
                                        <div className="progress-bar">
                                            <div 
                                                className="progress-fill"
                                                style={{ 
                                                    width: `${Math.min(100, (transcript.duration_ms / performanceMetrics.transcription_time_ms) * 100)}%` 
                                                }}
                                            />
                                        </div>
                                    </div>
                                </div>
                                
                                {/* Latency Card */}
                                {performanceMetrics.user_perceived_latency_ms && (
                                    <div className={`info-card ${performanceMetrics.user_perceived_latency_ms < 300 ? 'card-success' : performanceMetrics.user_perceived_latency_ms >= 1000 ? 'card-warning' : ''}`}>
                                        <div className="card-header">
                                            <div className="card-icon">
                                                <ClockIcon />
                                            </div>
                                            <h3 className="card-title">Processing Latency</h3>
                                        </div>
                                        <div className="card-content">
                                            <div className="card-value">
                                                {formatDuration(performanceMetrics.user_perceived_latency_ms)}
                                            </div>
                                            <div className="card-subtitle">
                                                {performanceMetrics.user_perceived_latency_ms < 300 ? '⚡ Fast' : 
                                                 performanceMetrics.user_perceived_latency_ms >= 1000 ? '⚠️ Slow' : 'Normal'}
                                            </div>
                                            <div className="latency-indicator">
                                                <div className={`indicator-dot ${performanceMetrics.user_perceived_latency_ms < 300 ? 'fast' : performanceMetrics.user_perceived_latency_ms >= 1000 ? 'slow' : 'normal'}`} />
                                            </div>
                                        </div>
                                    </div>
                                )}
                                
                                {/* Transcription Time Card */}
                                <div className="info-card">
                                    <div className="card-header">
                                        <div className="card-icon">
                                            <ClockIcon />
                                        </div>
                                        <h3 className="card-title">Transcription Time</h3>
                                    </div>
                                    <div className="card-content">
                                        <div className="card-value">
                                            {formatDuration(performanceMetrics.transcription_time_ms)}
                                        </div>
                                        <div className="card-subtitle">
                                            Total processing
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                        
                    {/* Active App Card */}
                    {metadata.app_context && (
                        <div className="card-grid">
                            <div className="info-card full-width">
                                <div className="card-header">
                                    <div className="card-icon">
                                        <FileIcon />
                                    </div>
                                    <h3 className="card-title">Active Application</h3>
                                </div>
                                <div className="card-content">
                                    <div className="card-value" title={metadata.app_context.bundle_id}>
                                        {metadata.app_context.name}
                                    </div>
                                    <div className="card-subtitle">
                                        {metadata.app_context.bundle_id}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                        
                    {/* Technical Details - Audio Device Card */}
                    {audioMetadata && (
                        <>
                            <h4 className="section-title">Technical Details</h4>
                            <div className="card-grid">
                                <div className="info-card full-width expandable" onClick={() => toggleCard('device')}>
                                    <div className="card-header">
                                        <div className="card-icon">
                                            <MicrophoneIcon />
                                        </div>
                                        <h3 className="card-title">Audio Device</h3>
                                        <button className="card-expand-indicator">
                                            <ExpandIcon expanded={expandedCards.device} />
                                        </button>
                                    </div>
                                    <div className="card-content">
                                        <div className="card-value">
                                            {audioMetadata.device.name}
                                        </div>
                                        <div className="card-subtitle">
                                            {audioMetadata.format.sample_rate} Hz • {audioMetadata.system.os} • {getDeviceConnectionType(audioMetadata.device)}
                                        </div>
                                    </div>
                                    {expandedCards.device && (
                                        <div className="card-expanded-content">
                                            <div className="detail-grid">
                                                <div className="detail-item">
                                                    <span className="detail-label">Audio Format</span>
                                                    <span className="detail-value">
                                                        {audioMetadata.format.sample_rate} Hz, {audioMetadata.format.channels} ch, {audioMetadata.format.bit_depth}-bit
                                                    </span>
                                                </div>
                                                <div className="detail-item">
                                                    <span className="detail-label">Buffer</span>
                                                    <span className="detail-value">
                                                        {audioMetadata.format.buffer_config.buffer_type}
                                                        {audioMetadata.format.buffer_config.estimated_latency_ms && (
                                                            <span className="text-muted"> ({audioMetadata.format.buffer_config.estimated_latency_ms.toFixed(1)}ms)</span>
                                                        )}
                                                    </span>
                                                </div>
                                                <div className="detail-item">
                                                    <span className="detail-label">Recording Mode</span>
                                                    <span className="detail-value">
                                                        {audioMetadata.recording.trigger_type === 'manual' && 'Manual'}
                                                        {audioMetadata.recording.trigger_type === 'push-to-talk' && 'Push-to-Talk'}
                                                        {audioMetadata.recording.trigger_type === 'vad' && 'Voice Activated'}
                                                        {audioMetadata.recording.vad_enabled && ' (VAD)'}
                                                    </span>
                                                </div>
                                                <div className="detail-item">
                                                    <span className="detail-label">Audio Backend</span>
                                                    <span className="detail-value">
                                                        {audioMetadata.system.audio_backend}
                                                    </span>
                                                </div>
                                                {audioMetadata.device.is_default && (
                                                    <div className="detail-item">
                                                        <span className="detail-label">Status</span>
                                                        <span className="detail-value">
                                                            <span className="badge badge-info">System Default</span>
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                            
                                            {/* Warnings Section */}
                                            {(audioMetadata.device.notes.length > 0 || audioMetadata.mismatches.length > 0 || 
                                              (audioMetadata.format.requested_sample_rate && audioMetadata.format.requested_sample_rate !== audioMetadata.format.sample_rate)) && (
                                                <div className="card-warnings">
                                                    <h4 className="warnings-title">Warnings & Issues</h4>
                                                    
                                                    {audioMetadata.format.requested_sample_rate && 
                                                     audioMetadata.format.requested_sample_rate !== audioMetadata.format.sample_rate && (
                                                        <div className="warning-item">
                                                            <span className="warning-icon">⚠️</span>
                                                            <span>Sample rate mismatch: Expected {audioMetadata.format.requested_sample_rate} Hz, got {audioMetadata.format.sample_rate} Hz</span>
                                                        </div>
                                                    )}
                                                    
                                                    {audioMetadata.device.notes.map((note, index) => (
                                                        <div key={index} className="warning-item">
                                                            <span className="warning-icon">⚠️</span>
                                                            <span>{note}</span>
                                                        </div>
                                                    ))}
                                                    
                                                    {audioMetadata.mismatches.map((mismatch, index) => (
                                                        <div key={index} className="mismatch-card">
                                                            <div className="mismatch-header">
                                                                <span className="mismatch-type">{mismatch.mismatch_type}</span>
                                                                <span className="mismatch-impact">{mismatch.impact}</span>
                                                            </div>
                                                            <div className="mismatch-details">
                                                                <span>Expected: {mismatch.requested}</span>
                                                                <span>Actual: {mismatch.actual}</span>
                                                            </div>
                                                            {mismatch.resolution && (
                                                                <div className="mismatch-resolution">
                                                                    💡 {mismatch.resolution}
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                        
                    {/* Performance Metrics Loading States */}
                    {loadingMetrics && (
                        <div className="card-grid">
                            <div className="info-card loading">
                                <div className="card-content">
                                    <div className="loading-spinner" />
                                    <div className="card-subtitle">Loading performance metrics...</div>
                                </div>
                            </div>
                        </div>
                    )}
                    
                    {!loadingMetrics && !performanceMetrics && !metricsError && (
                        <div className="card-grid">
                            <div className="info-card card-info">
                                <div className="card-content">
                                    <div className="card-value">📊 No metrics available</div>
                                    <div className="card-subtitle">Performance data not recorded for this transcript</div>
                                </div>
                            </div>
                        </div>
                    )}
                    
                    {!loadingMetrics && metricsError && (
                        <div className="card-grid">
                            <div className="info-card card-warning">
                                <div className="card-content">
                                    <div className="card-value">⚠️ Error loading metrics</div>
                                    <div className="card-subtitle">Could not retrieve performance data</div>
                                </div>
                            </div>
                        </div>
                    )}

                    {transcript.audio_path && canRenderPlayer && (
                        <SimpleAudioPlayer
                            audioPath={transcript.audio_path}
                            duration={transcript.duration_ms}
                            formatDuration={formatDuration}
                        />
                    )}

                    {/* Tabs */}
                    <div className="detail-tabs">
                        <button
                            className={`tab-button ${activeTab === 'transcript' ? 'active' : ''}`}
                            onClick={() => setActiveTab('transcript')}
                        >
                            Transcript
                        </button>
                        <button
                            className={`tab-button ${activeTab === 'insights' ? 'active' : ''}`}
                            onClick={() => setActiveTab('insights')}
                        >
                            AI Insights
                        </button>
                        <button
                            className={`tab-button ${activeTab === 'logs' ? 'active' : ''}`}
                            onClick={() => setActiveTab('logs')}
                        >
                            Whisper Logs
                        </button>
                        <button
                            className={`tab-button ${activeTab === 'performance' ? 'active' : ''}`}
                            onClick={() => setActiveTab('performance')}
                        >
                            Performance
                        </button>
                    </div>

                    {activeTab === 'transcript' && (
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
                    )}

                    {activeTab === 'insights' && (
                        <div className="detail-insights">
                            <TranscriptAIInsights transcriptId={transcript.id} />
                        </div>
                    )}

                    {activeTab === 'logs' && (
                        <div className="detail-logs">
                            <div className="logs-header">
                                <h3>Whisper Transcription Logs</h3>
                                <p className="logs-description">Detailed logs from the Whisper transcription process</p>
                            </div>
                            
                            {loadingLogs ? (
                                <div className="logs-loading">Loading logs...</div>
                            ) : whisperLogs.length === 0 ? (
                                <div className="logs-empty">
                                    <p>No whisper logs found for this transcript.</p>
                                    <p className="logs-hint">Logs are only available for recent recordings with whisper logging enabled.</p>
                                </div>
                            ) : (
                                <div className="logs-content">
                                    {whisperLogs.map((log, index) => (
                                        <div key={index} className={`log-entry log-${log.level.toLowerCase()}`}>
                                            <div className="log-header">
                                                <span className="log-timestamp">{new Date(log.timestamp).toLocaleTimeString()}</span>
                                                <span className="log-level">{log.level}</span>
                                                <span className="log-component">{log.component}</span>
                                            </div>
                                            <div className="log-message">{log.message}</div>
                                            {log.metadata && (
                                                <div className="log-metadata">
                                                    <pre>{JSON.stringify(log.metadata, null, 2)}</pre>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'performance' && (
                        <div className="detail-performance">
                            <div className="performance-header">
                                <h3>Performance Timeline</h3>
                                <p className="performance-description">Detailed timing breakdown of the recording and transcription process</p>
                            </div>
                            <div className="performance-content">
                                <PerformanceTimeline 
                                    isRecording={false}
                                    transcriptId={transcript.id}
                                    onClose={undefined}
                                />
                            </div>
                        </div>
                    )}

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
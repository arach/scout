import { useEffect, useState } from 'react';
import { SimpleAudioPlayer } from './SimpleAudioPlayer';
import { PerformanceTimeline } from './PerformanceTimeline';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { parseTranscriptMetadata, parseAudioMetadata, Transcript } from '../types/transcript';
import { useResizable } from '../hooks/useResizable';
import './TranscriptDetailPanel.css';


const ClockIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M8 4V8L10.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
);


const MicrophoneIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="6" y="2" width="4" height="7" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M4 7V8C4 10.2091 5.79086 12 8 12C10.2091 12 12 10.2091 12 8V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M8 12V14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
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
    const [showOriginalTranscript, setShowOriginalTranscript] = useState(false);
    const [activeTab, setActiveTab] = useState<'transcript' | 'logs' | 'performance'>('transcript');
    const [whisperLogs, setWhisperLogs] = useState<any[]>([]);
    const [loadingLogs, setLoadingLogs] = useState(false);
    const [expandedCards, setExpandedCards] = useState<{ [key: string]: boolean }>({ transcription: true });
    const [copiedTab, setCopiedTab] = useState<string | null>(null);
    
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

    // Handle tab switching when transcript changes
    useEffect(() => {
        if (isOpen && transcript) {
            // Parse metadata to check strategy
            const metadata = parseTranscriptMetadata(transcript.metadata) || {};
            
            // If current tab is logs but transcript used external service, switch to transcript tab
            if (activeTab === 'logs' && metadata.strategy_used === 'ExternalService') {
                setActiveTab('transcript');
            }
        }
    }, [transcript?.id]); // Only run when transcript ID changes

    // Fetch performance metrics when transcript changes
    useEffect(() => {
        if (isOpen && transcript) {
            setPerformanceMetrics(null);
            setShowOriginalTranscript(false); // Reset to filtered view
            
            invoke<PerformanceMetrics | null>('get_performance_metrics_for_transcript', {
                transcriptId: transcript.id
            }).then((metrics) => {
                setPerformanceMetrics(metrics);
            }).catch((error) => {
                console.error('Failed to fetch performance metrics:', error);
                setPerformanceMetrics(null);
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

    const handleExportAudio = async () => {
        if (!transcript?.audio_path) {
            console.error('No audio path available');
            return;
        }

        try {
            // Generate a nice filename with date
            const date = new Date(transcript.created_at);
            const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
            const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-MM-SS
            const defaultFilename = `scout_recording_${dateStr}_${timeStr}.wav`;
            
            // Show save dialog
            const filePath = await save({
                defaultPath: defaultFilename,
                filters: [{
                    name: 'Audio',
                    extensions: ['wav']
                }]
            });
            
            if (filePath) {
                // Use the backend command to copy the file
                await invoke('export_audio_file', {
                    sourcePath: transcript.audio_path,
                    destinationPath: filePath
                });
                console.log('Audio file exported successfully to:', filePath);
            }
        } catch (error) {
            console.error('Failed to export audio:', error);
            alert(`Failed to export audio: ${error}`);
        }
    };

    const toggleCard = (card: string) => {
        setExpandedCards(prev => ({ ...prev, [card]: !prev[card] }));
    };

    const copyTranscript = () => {
        if (!transcript) return;
        
        const textToCopy = showOriginalTranscript && metadata.original_transcript 
            ? metadata.original_transcript 
            : transcript.text;
        
        navigator.clipboard.writeText(textToCopy);
        setCopiedTab('transcript');
        setTimeout(() => setCopiedTab(null), 2000);
    };

    const copyWhisperLogs = () => {
        const logsText = whisperLogs.map(log => {
            let text = `[${new Date(log.timestamp).toLocaleTimeString()}] ${log.level} ${log.component}: ${log.message}`;
            if (log.metadata) {
                text += '\n' + JSON.stringify(log.metadata, null, 2);
            }
            return text;
        }).join('\n\n');
        
        navigator.clipboard.writeText(logsText);
        setCopiedTab('logs');
        setTimeout(() => setCopiedTab(null), 2000);
    };

    const copyPerformance = () => {
        // This will be handled by the PerformanceTimeline component's own copy function
        // But we still want to show the copied state
        setCopiedTab('performance');
        setTimeout(() => setCopiedTab(null), 2000);
    };


    const getDeviceConnectionType = (device: any) => {
        const name = device.name.toLowerCase();
        
        if (device?.device_type) {
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
                    <div className="header-content">
                        <h2 className="transcript-id">ID #{transcript.id}</h2>
                        <span className="transcript-datetime">
                            {new Date(transcript.created_at).toLocaleDateString('en-US', { 
                                month: 'short', 
                                day: 'numeric',
                                year: 'numeric' 
                            })} at {new Date(transcript.created_at).toLocaleTimeString([], { 
                                hour: '2-digit', 
                                minute: '2-digit'
                            })}
                        </span>
                    </div>
                    <button className="close-button" onClick={(e) => {
                        e.stopPropagation();
                        onClose();
                    }} title="Close (ESC)">
                        ×
                    </button>
                </div>

                <div className="detail-panel-content">
                    {/* Transcription Details Card */}
                    <div className="card-grid">
                        <div className="info-card full-width expandable">
                            <div className="card-header" onClick={() => toggleCard('transcription')}>
                                <div className="card-icon">
                                    <ClockIcon />
                                </div>
                                <h3 className="card-title">Recording Info</h3>
                                <button className="card-expand-indicator" onClick={(e) => {
                                    e.stopPropagation();
                                    toggleCard('transcription');
                                }}>
                                    <ExpandIcon expanded={expandedCards.transcription} />
                                </button>
                            </div>
                            {!expandedCards.transcription && (
                                <div className="card-content">
                                    <div className="card-value">
                                        {formatDuration(transcript.duration_ms)}
                                        {performanceMetrics && metadata.model_used && (
                                            <span className="card-subtitle" style={{ marginLeft: '12px', fontSize: '14px', fontWeight: '500' }}>
                                                • {metadata.model_used.split('/').pop()?.replace('.bin', '')}
                                            </span>
                                        )}
                                    </div>
                                    <div className="card-subtitle">
                                        {metadata.filename ? metadata.filename.split('/').pop() : 'Recording'} • {transcript.file_size && formatFileSize ? formatFileSize(transcript.file_size) : 'No file size'}
                                        {performanceMetrics && performanceMetrics.transcription_time_ms && (
                                            <> • {(performanceMetrics.transcription_time_ms / transcript.duration_ms).toFixed(2)}x speed</>
                                        )}
                                    </div>
                                </div>
                            )}
                            {expandedCards.transcription && (
                                <div className="card-expanded-content">
                                    <div className="detail-grid">
                                        <div className="detail-item">
                                            <span className="detail-label">Duration</span>
                                            <span className="detail-value">{formatDuration(transcript.duration_ms)}</span>
                                        </div>
                                        {metadata.filename && (
                                            <div className="detail-item">
                                                <span className="detail-label">Source File</span>
                                                <span className="detail-value" title={metadata.filename}>
                                                    {metadata.filename.split('/').pop()}
                                                </span>
                                            </div>
                                        )}
                                        {transcript.file_size && formatFileSize && (
                                            <div className="detail-item">
                                                <span className="detail-label">File Size</span>
                                                <span className="detail-value">
                                                    {formatFileSize(transcript.file_size)}
                                                </span>
                                            </div>
                                        )}
                                        {metadata.original_transcript && (
                                            <div className="detail-item">
                                                <span className="detail-label">Content Filter</span>
                                                <span className="detail-value">
                                                    {metadata.original_transcript !== transcript.text ? (
                                                        <span className="badge badge-warning">🚫 Filtered</span>
                                                    ) : metadata.filter_analysis && metadata.filter_analysis.length > 0 ? (
                                                        <span className="badge badge-info">✅ Clean with notes</span>
                                                    ) : (
                                                        <span className="badge badge-success">✅ Clean</span>
                                                    )}
                                                </span>
                                            </div>
                                        )}
                                        {performanceMetrics && (
                                            <>
                                                {metadata.model_used && (
                                                    <div className="detail-item">
                                                        <span className="detail-label">AI Model</span>
                                                        <span className="detail-value" title={metadata.model_used}>
                                                            {metadata.model_used.split('/').pop()?.replace('.bin', '')}
                                                            {performanceMetrics.transcription_strategy && (
                                                                <span className="text-muted"> ({performanceMetrics.transcription_strategy === 'ring_buffer' ? 'Chunked' : 'Single-pass'})</span>
                                                            )}
                                                        </span>
                                                    </div>
                                                )}
                                                <div className="detail-item">
                                                    <span className="detail-label">Processing Speed</span>
                                                    <span className="detail-value">
                                                        {(performanceMetrics.transcription_time_ms / transcript.duration_ms).toFixed(2)}x
                                                        <span className="text-muted"> ({performanceMetrics.transcription_time_ms < transcript.duration_ms ? 'Faster than real-time' : 'Slower than real-time'})</span>
                                                    </span>
                                                </div>
                                                <div className="detail-item">
                                                    <span className="detail-label">Transcription Time</span>
                                                    <span className="detail-value">
                                                        {formatDuration(performanceMetrics.transcription_time_ms)}
                                                    </span>
                                                </div>
                                                {performanceMetrics.user_perceived_latency_ms && (
                                                    <div className="detail-item">
                                                        <span className="detail-label">Processing Latency</span>
                                                        <span className="detail-value">
                                                            {formatDuration(performanceMetrics.user_perceived_latency_ms)}
                                                            <span className="text-muted"> ({performanceMetrics.user_perceived_latency_ms < 300 ? 'Fast' : performanceMetrics.user_perceived_latency_ms >= 1000 ? 'Slow' : 'Normal'})</span>
                                                        </span>
                                                    </div>
                                                )}
                                            </>
                                        )}
                                        {metadata.app_context && (
                                            <div className="detail-item">
                                                <span className="detail-label">Active App</span>
                                                <span className="detail-value" title={metadata.app_context.bundle_id}>
                                                    {metadata.app_context.name}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                    
                                    {/* Filter Analysis Notes */}
                                    {metadata.filter_analysis && metadata.filter_analysis.length > 0 && (
                                        <div className="card-warnings">
                                            <h4 className="warnings-title">Filter Analysis</h4>
                                            {metadata.filter_analysis.map((log, index) => (
                                                <div key={index} className="warning-item">
                                                    <span className="warning-icon">ℹ️</span>
                                                    <span>{log}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    
                                    {/* Audio Player */}
                                    {transcript.audio_path && canRenderPlayer && (
                                        <div style={{ marginTop: '16px' }}>
                                            <SimpleAudioPlayer
                                                audioPath={transcript.audio_path}
                                                duration={transcript.duration_ms}
                                            />
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                    
                    {/* Audio Device Card */}
                    {audioMetadata && (
                        <div className="card-grid" style={{ marginTop: '16px' }}>
                                <div className="info-card full-width expandable">
                                    <div className="card-header" onClick={() => toggleCard('device')}>
                                        <div className="card-icon">
                                            <MicrophoneIcon />
                                        </div>
                                        <h3 className="card-title">Audio Device</h3>
                                        <button className="card-expand-indicator" onClick={(e) => {
                                            e.stopPropagation();
                                            toggleCard('device');
                                        }}>
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
                    )}

                    {/* Tabs */}
                    <div className="detail-tabs">
                        <button
                            className={`tab-button ${activeTab === 'transcript' ? 'active' : ''}`}
                            onClick={() => setActiveTab('transcript')}
                        >
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M3 2C3 1.44772 3.44772 1 4 1H10C10.5523 1 11 1.44772 11 2V12C11 12.5523 10.5523 13 10 13H4C3.44772 13 3 12.5523 3 12V2Z" stroke="currentColor" strokeWidth="1"/>
                                <path d="M5 4H9M5 6H9M5 8H7" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                            </svg>
                            Transcript
                        </button>
                        {metadata.strategy_used !== 'ExternalService' && (
                            <button
                                className={`tab-button ${activeTab === 'logs' ? 'active' : ''}`}
                                onClick={() => setActiveTab('logs')}
                            >
                                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M1 7H3L5 3L7 11L9 7H11L13 7" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                                Whisper Logs
                            </button>
                        )}
                        <button
                            className={`tab-button ${activeTab === 'performance' ? 'active' : ''}`}
                            onClick={() => setActiveTab('performance')}
                        >
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1"/>
                                <path d="M7 4V7L9 9" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                                <path d="M7 1V2M7 12V13M1 7H2M12 7H13" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                            </svg>
                            Performance Logs
                        </button>
                    </div>

                    {activeTab === 'transcript' && (
                    <div className="tab-content">
                        <button 
                            className={`tab-copy-button ${copiedTab === 'transcript' ? 'copied' : ''}`}
                            onClick={copyTranscript}
                            title="Copy transcript"
                        >
                            📋 {copiedTab === 'transcript' ? 'Copied!' : 'Copy'}
                        </button>
                        <div className="detail-transcript">
                            <div className="transcript-header">
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
                    </div>
                    )}

                    {activeTab === 'logs' && metadata.strategy_used !== 'ExternalService' && (
                        <div className="tab-content">
                            <button 
                                className={`tab-copy-button ${copiedTab === 'logs' ? 'copied' : ''}`}
                                onClick={copyWhisperLogs}
                                title="Copy logs"
                                disabled={whisperLogs.length === 0}
                            >
                                📋 {copiedTab === 'logs' ? 'Copied!' : 'Copy'}
                            </button>
                            <div className="detail-logs">
                                {loadingLogs ? (
                                    <div className="logs-loading">Loading logs...</div>
                                ) : whisperLogs.length === 0 ? (
                                    <div className="logs-empty">
                                        <p>No whisper logs found for this transcript.</p>
                                        <p className="logs-hint">Logs are only available for recent recordings with whisper logging enabled.</p>
                                    </div>
                                ) : (
                                    <div className="logs-content">
                                        <div className="logs-table">
                                            {whisperLogs.map((log, index) => (
                                                <div key={index} className={`log-entry log-${log.level.toLowerCase()}`}>
                                                    <div className="log-header">
                                                        <span className="log-timestamp">{new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                                                        <span className={`log-level log-${log.level.toLowerCase()}`}>{log.level}</span>
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
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {activeTab === 'performance' && (
                        <div className="tab-content">
                            <button 
                                className={`tab-copy-button ${copiedTab === 'performance' ? 'copied' : ''}`}
                                onClick={() => {
                                    const button = document.querySelector('.performance-copy-trigger') as HTMLButtonElement;
                                    if (button) {
                                        button.click();
                                        copyPerformance();
                                    }
                                }}
                                title="Copy performance timeline"
                            >
                                📋 {copiedTab === 'performance' ? 'Copied!' : 'Copy'}
                            </button>
                            <div className="detail-performance">
                                <div className="performance-content">
                                    <PerformanceTimeline 
                                        isRecording={false}
                                        transcriptId={transcript.id}
                                        onClose={undefined}
                                    />
                                </div>
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
                                className="action-button secondary"
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
                                    {transcript.audio_path && (
                                        <button onClick={() => {
                                            handleExportAudio();
                                            setShowExportMenu(false);
                                        }}>Export as WAV</button>
                                    )}
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
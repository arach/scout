import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './PerformanceTimeline.css';

interface PerformanceEvent {
    timestamp: string;
    event_type: string;
    details: string;
    duration_from_start_ms: number | null;
}

interface PerformanceTimeline {
    session_id: string;
    events: PerformanceEvent[];
    start_time: string;
}

interface PerformanceTimelineProps {
    isRecording: boolean;
    transcriptId?: number;
    onClose?: () => void;
}

export function PerformanceTimeline({ isRecording, transcriptId, onClose }: PerformanceTimelineProps) {
    const [timeline, setTimeline] = useState<PerformanceTimeline | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [historicalEvents, setHistoricalEvents] = useState<PerformanceEvent[]>([]);

    const fetchTimeline = async () => {
        try {
            console.log('[PerformanceTimeline] Fetching timeline...');
            setIsLoading(true);
            setError(null);
            const result = await invoke<PerformanceTimeline | null>('get_performance_timeline');
            console.log('[PerformanceTimeline] Timeline result:', result);
            setTimeline(result);
        } catch (err) {
            console.error('Failed to fetch performance timeline:', err);
            setError(err instanceof Error ? err.message : 'Failed to fetch timeline');
        } finally {
            setIsLoading(false);
        }
    };

    const fetchHistoricalTimeline = async () => {
        if (!transcriptId) return;
        
        try {
            console.log('[PerformanceTimeline] Fetching historical timeline for transcript:', transcriptId);
            setIsLoading(true);
            setError(null);
            const events = await invoke<any[]>('get_performance_timeline_for_transcript', {
                transcriptId: transcriptId
            });
            console.log('[PerformanceTimeline] Historical events:', events);
            
            // Convert database events to PerformanceEvent format
            const formattedEvents: PerformanceEvent[] = events.map(event => ({
                timestamp: event.timestamp,
                event_type: event.event_type,
                details: event.details,
                duration_from_start_ms: event.duration_from_start_ms
            }));
            
            console.log('[PerformanceTimeline] Formatted events:', formattedEvents);
            setHistoricalEvents(formattedEvents);
        } catch (err) {
            console.error('Failed to fetch historical timeline:', err);
            setError(err instanceof Error ? err.message : 'Failed to fetch timeline');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        console.log('[PerformanceTimeline] useEffect triggered - isRecording:', isRecording, 'transcriptId:', transcriptId, 'timeline:', timeline);
        if (transcriptId) {
            // Fetch historical data for a specific transcript
            fetchHistoricalTimeline();
        } else if (isRecording) {
            // Poll for updates while recording
            fetchTimeline();
            const interval = setInterval(fetchTimeline, 500); // Update every 500ms
            return () => clearInterval(interval);
        } else if (timeline) {
            // Fetch one final time after recording stops
            setTimeout(fetchTimeline, 1000);
        }
    }, [isRecording, transcriptId]);

    // Use historical events if available, otherwise use live timeline
    const displayEvents = transcriptId && historicalEvents.length > 0 
        ? historicalEvents 
        : timeline?.events || [];
    
    console.log('[PerformanceTimeline] Render - displayEvents:', displayEvents, 'isLoading:', isLoading);
    
    if (displayEvents.length === 0 && !isLoading) {
        console.log('[PerformanceTimeline] Returning null - no events and not loading');
        return null;
    }

    const formatTimestamp = (ms: number | null) => {
        if (ms === null) return '0ms';
        if (ms < 1000) return `${ms}ms`;
        return `${(ms / 1000).toFixed(2)}s`;
    };

    const getEventIcon = (eventType: string) => {
        switch (eventType) {
            case 'session_started':
            case 'recording_command':
                return '🎬';
            case 'audio_start':
            case 'audio_stop':
                return '🎤';
            case 'transcription_init':
            case 'transcription_start':
            case 'transcription_finish':
            case 'transcription_complete':
                return '📝';
            case 'state_change':
                return '🔄';
            case 'db_save':
            case 'db_saved':
                return '💾';
            case 'post_processing':
                return '⚙️';
            case 'whisper_logging':
                return '📋';
            case 'app_context':
                return '🖥️';
            case 'strategy_start':
                return '🎯';
            case 'response_sent':
                return '📤';
            case 'session_ended':
                return '✅';
            default:
                return '•';
        }
    };

    const copyTimeline = () => {
        const timelineText = displayEvents.map((event) => {
            const time = formatTimestamp(event.duration_from_start_ms);
            return `${time} - ${event.event_type}: ${event.details}`;
        }).join('\n');
        
        const totalTime = displayEvents.length > 0 && displayEvents[displayEvents.length - 1].duration_from_start_ms 
            ? formatTimestamp(displayEvents[displayEvents.length - 1].duration_from_start_ms)
            : '0ms';
            
        const fullText = `Performance Timeline\n${'='.repeat(50)}\n${timelineText}\n${'='.repeat(50)}\nTotal time: ${totalTime}`;
        
        navigator.clipboard.writeText(fullText).then(() => {
            // Could add a toast notification here
            console.log('Timeline copied to clipboard');
        });
    };

    return (
        <div className="performance-timeline-container">
            <div className="performance-timeline-header">
                <h3>Performance Timeline</h3>
                <div className="timeline-actions">
                    <button className="copy-button" onClick={copyTimeline} title="Copy timeline to clipboard">
                        📋 Copy
                    </button>
                    {onClose && (
                        <button className="close-button" onClick={onClose}>×</button>
                    )}
                </div>
            </div>
            
            {error && (
                <div className="timeline-error">{error}</div>
            )}
            
            {isLoading && displayEvents.length === 0 && (
                <div className="timeline-loading">Loading timeline...</div>
            )}
            
            {displayEvents.length > 0 && (
                <>
                    {timeline && (
                        <div className="timeline-session-info">
                            Session: {timeline.session_id}
                        </div>
                    )}
                    
                    <div className="timeline-events">
                        {displayEvents.map((event, index) => {
                            const prevTime = index > 0 ? displayEvents[index - 1].duration_from_start_ms || 0 : 0;
                            const currentTime = event.duration_from_start_ms || 0;
                            const delta = currentTime - prevTime;
                            
                            return (
                                <div key={index} className={`timeline-event event-${event.event_type}`}>
                                    <div className="event-time">
                                        <span className="event-icon">{getEventIcon(event.event_type)}</span>
                                        <span className="event-elapsed">{formatTimestamp(event.duration_from_start_ms)}</span>
                                        {delta > 0 && (
                                            <span className="event-delta">+{formatTimestamp(delta)}</span>
                                        )}
                                    </div>
                                    <div className="event-details">
                                        <span className="event-type">{event.event_type}</span>
                                        <span className="event-description">{event.details}</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    
                    {displayEvents.length > 0 && displayEvents[displayEvents.length - 1].duration_from_start_ms && (
                        <div className="timeline-total">
                            Total time: {formatTimestamp(displayEvents[displayEvents.length - 1].duration_from_start_ms)}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
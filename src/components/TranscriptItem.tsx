import { useState } from 'react';
import { Trash2, Copy, Check, Play, Download, Edit3 } from 'lucide-react';
import './TranscriptItem.css';

interface Transcript {
    id: number;
    text: string;
    duration_ms: number;
    created_at: string;
    metadata?: string;
    audio_path?: string;
    file_size?: number;
}

interface TranscriptItemProps {
    transcript: Transcript;
    formatDuration: (ms: number) => string;
    onDelete?: (id: number, text: string) => void;
    onClick?: (transcript: Transcript) => void;
    showCheckbox?: boolean;
    isSelected?: boolean;
    onSelectToggle?: (id: number) => void;
    isActive?: boolean;
    variant?: 'default' | 'compact';
}

export function TranscriptItem({
    transcript,
    formatDuration,
    onDelete,
    onClick,
    showCheckbox = false,
    isSelected = false,
    onSelectToggle,
    isActive = false,
    variant = 'default'
}: TranscriptItemProps) {
    const [copied, setCopied] = useState(false);
    const isBlankAudio = transcript.text === "[BLANK_AUDIO]";
    
    const formatTime = (dateString: string) => {
        const date = new Date(dateString);
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();
        
        if (variant === 'compact') {
            return date.toLocaleTimeString([], { 
                hour: '2-digit', 
                minute: '2-digit'
            });
        }
        
        return isToday 
            ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    };
    
    const handleCopy = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!isBlankAudio) {
            await navigator.clipboard.writeText(transcript.text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };
    
    const handleClick = () => {
        if (onClick) {
            onClick(transcript);
        }
    };
    
    return (
        <div 
            className={`transcript-item ${variant} ${isSelected ? 'selected' : ''} ${isActive ? 'active' : ''} ${onClick ? 'clickable' : ''}`}
            onClick={handleClick}
        >
            <div className="transcript-item-content">
                {showCheckbox && (
                    <input
                        type="checkbox"
                        className="transcript-checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                            e.stopPropagation();
                            onSelectToggle?.(transcript.id);
                        }}
                        onClick={(e) => e.stopPropagation()}
                    />
                )}
                
                <span className="transcript-time">{formatTime(transcript.created_at)}</span>
                
                {variant === 'default' && (
                    <span className="transcript-duration">{formatDuration(transcript.duration_ms)}</span>
                )}
                
                <div className="transcript-text-container">
                    {isBlankAudio ? (
                        <span className="transcript-empty">No speech detected</span>
                    ) : (
                        <p className="transcript-text">{transcript.text}</p>
                    )}
                </div>
                
                <div className="transcript-actions">
                    {transcript.audio_path && (
                        <button
                            className="transcript-action-button play"
                            onClick={(e) => {
                                e.stopPropagation();
                                // TODO: Implement play functionality
                            }}
                            title="Play audio"
                        >
                            <Play size={14} />
                        </button>
                    )}
                    
                    <button
                        className="transcript-action-button download"
                        onClick={(e) => {
                            e.stopPropagation();
                            // TODO: Implement download functionality
                        }}
                        title="Download transcript"
                        disabled={isBlankAudio}
                    >
                        <Download size={14} />
                    </button>
                    
                    <button
                        className={`transcript-action-button copy ${copied ? 'copied' : ''}`}
                        onClick={handleCopy}
                        title={copied ? "Copied!" : "Copy to clipboard"}
                        disabled={isBlankAudio}
                    >
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                    
                    <button
                        className="transcript-action-button edit"
                        onClick={(e) => {
                            e.stopPropagation();
                            // TODO: Implement edit functionality
                        }}
                        title="Edit transcript"
                        disabled={isBlankAudio}
                    >
                        <Edit3 size={14} />
                    </button>
                    
                    {onDelete && (
                        <button
                            className="transcript-action-button delete"
                            onClick={(e) => {
                                e.stopPropagation();
                                onDelete(transcript.id, transcript.text);
                            }}
                            title="Delete transcript"
                        >
                            <Trash2 size={14} />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
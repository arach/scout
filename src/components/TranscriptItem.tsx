import { useState, useRef, useEffect, memo } from 'react';
import { Trash2, Copy, Check, Play, Pause, Download, Eye } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { useAudioBlob } from '../hooks/useAudioBlob';
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

export const TranscriptItem = memo(function TranscriptItem({
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
    const [isPlaying, setIsPlaying] = useState(false);
    const [showDownloadMenu, setShowDownloadMenu] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const isBlankAudio = transcript.text === "[BLANK_AUDIO]";
    
    // Use the audio blob hook
    const { blob: audioBlob, isLoading: isAudioLoading } = useAudioBlob(transcript.audio_path || '');
    
    // Create audio URL from blob
    useEffect(() => {
        if (audioBlob) {
            const url = URL.createObjectURL(audioBlob);
            setAudioUrl(url);
            
            // Reset audio element when URL changes
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
                setIsPlaying(false);
            }
            
            return () => {
                URL.revokeObjectURL(url);
            };
        }
    }, [audioBlob]);
    
    // Cleanup audio on unmount
    useEffect(() => {
        return () => {
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
            }
        };
    }, []);
    
    // Handle click outside for download menu
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (!target.closest('.download-dropdown')) {
                setShowDownloadMenu(false);
            }
        };
        
        if (showDownloadMenu) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => {
                document.removeEventListener('mousedown', handleClickOutside);
            };
        }
    }, [showDownloadMenu]);
    
    const formatTime = (dateString: string) => {
        const date = new Date(dateString);
        // Remove console.log to avoid spam

        // Always use time-only format for compact variant
        if (variant === 'compact') {
            return date.toLocaleTimeString([], { 
                hour: '2-digit', 
                minute: '2-digit'
            });
        }
        
        // Use the EXACT same logic as TranscriptsView grouping
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        // Item is "Today" if date >= today AND date < tomorrow
        const isToday = date >= today && date < tomorrow;
        
        // Always show just time for Today items
        if (isToday) {
            return date.toLocaleTimeString([], { 
                hour: '2-digit', 
                minute: '2-digit'
            });
        }
        
        // For other dates, show full date and time
        const yearPart = date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined;
        const formatted = date.toLocaleDateString([], { 
            month: 'short', 
            day: 'numeric',
            year: yearPart
        });
        const time = date.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });
        return `${formatted} at ${time}`;
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
                    <div 
                        className="transcript-checkbox-wrapper"
                        onClick={(e) => {
                            e.stopPropagation();
                            onSelectToggle?.(transcript.id);
                        }}
                    >
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
                    </div>
                )}
                
                <span className="transcript-time">{formatTime(transcript.created_at)}</span>
                
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
                            onClick={async (e) => {
                                e.stopPropagation();
                                
                                if (isPlaying && audioRef.current) {
                                    audioRef.current.pause();
                                    setIsPlaying(false);
                                } else if (audioUrl && !isAudioLoading) {
                                    // Create audio element if it doesn't exist
                                    if (!audioRef.current) {
                                        audioRef.current = new Audio(audioUrl);
                                        audioRef.current.onended = () => setIsPlaying(false);
                                    }
                                    
                                    try {
                                        await audioRef.current.play();
                                        setIsPlaying(true);
                                    } catch (error) {
                                        console.error('Failed to play audio:', error);
                                    }
                                }
                            }}
                            title={isPlaying ? "Pause audio" : "Play audio"}
                            disabled={isAudioLoading || !audioUrl}
                        >
                            {isPlaying ? <Pause size={14} /> : <Play size={14} />}
                        </button>
                    )}
                    
                    <div className="download-dropdown">
                        <button
                            className="transcript-action-button download"
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowDownloadMenu(!showDownloadMenu);
                            }}
                            title="Download transcript"
                            disabled={isBlankAudio}
                        >
                            <Download size={14} />
                        </button>
                        {showDownloadMenu && (
                            <div className="download-menu" onClick={(e) => e.stopPropagation()}>
                                <button onClick={async (e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    try {
                                        const filePath = await save({
                                            defaultPath: `transcript-${transcript.id}-${new Date(transcript.created_at).toISOString().split('T')[0]}.json`,
                                            filters: [{
                                                name: 'JSON',
                                                extensions: ['json']
                                            }]
                                        });
                                        
                                        if (filePath) {
                                            const downloadData = {
                                                id: transcript.id,
                                                text: transcript.text,
                                                duration_ms: transcript.duration_ms,
                                                created_at: transcript.created_at,
                                                metadata: transcript.metadata,
                                                audio_path: transcript.audio_path,
                                                file_size: transcript.file_size
                                            };
                                            
                                            await writeTextFile(filePath, JSON.stringify(downloadData, null, 2));
                                            setShowDownloadMenu(false);
                                        }
                                    } catch (error) {
                                        console.error('Download failed:', error);
                                    }
                                }}>JSON</button>
                                <button onClick={async (e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    try {
                                        const filePath = await save({
                                            defaultPath: `transcript-${transcript.id}-${new Date(transcript.created_at).toISOString().split('T')[0]}.txt`,
                                            filters: [{
                                                name: 'Text',
                                                extensions: ['txt']
                                            }]
                                        });
                                        
                                        if (filePath) {
                                            await writeTextFile(filePath, transcript.text);
                                            setShowDownloadMenu(false);
                                        }
                                    } catch (error) {
                                        console.error('Download failed:', error);
                                    }
                                }}>Text</button>
                                <button onClick={async (e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    try {
                                        const date = new Date(transcript.created_at);
                                        const filePath = await save({
                                            defaultPath: `transcript-${transcript.id}-${date.toISOString().split('T')[0]}.md`,
                                            filters: [{
                                                name: 'Markdown',
                                                extensions: ['md']
                                            }]
                                        });
                                        
                                        if (filePath) {
                                            const markdown = `# Transcript\n\n**Date:** ${date.toLocaleDateString()} ${date.toLocaleTimeString()}\n**Duration:** ${formatDuration(transcript.duration_ms)}\n\n## Text\n\n${transcript.text}\n\n---\n\n*Transcript ID: ${transcript.id}*`;
                                            await writeTextFile(filePath, markdown);
                                            setShowDownloadMenu(false);
                                        }
                                    } catch (error) {
                                        console.error('Download failed:', error);
                                    }
                                }}>Markdown</button>
                            </div>
                        )}
                    </div>
                    
                    <button
                        className={`transcript-action-button copy ${copied ? 'copied' : ''}`}
                        onClick={handleCopy}
                        title={copied ? "Copied!" : "Copy to clipboard"}
                        disabled={isBlankAudio}
                    >
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                    
                    <button
                        className="transcript-action-button view-details"
                        onClick={(e) => {
                            e.stopPropagation();
                            if (onClick) {
                                onClick(transcript);
                            }
                        }}
                        title="View transcript details"
                        disabled={isBlankAudio}
                    >
                        <Eye size={14} />
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
});
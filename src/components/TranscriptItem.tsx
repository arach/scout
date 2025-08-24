import { useState, useRef, useEffect, memo, useCallback } from 'react';
import { Trash2, Copy, Check, Play, Pause, Download, Eye } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { useLazyAudioBlob } from '../hooks/useLazyAudioBlob';
import { useOptimizedDateFormat } from '../hooks/useOptimizedDateFormat';
import { Transcript } from '../types/transcript';
import './TranscriptItem.css';

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
    style?: React.CSSProperties;
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
    variant = 'default',
    style
}: TranscriptItemProps) {
    const [copied, setCopied] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [showDownloadMenu, setShowDownloadMenu] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const isBlankAudio = transcript.text === "[BLANK_AUDIO]";
    
    // Use lazy audio loading - only load when needed
    const { blob: audioBlob, isLoading: isAudioLoading, loadAudio } = useLazyAudioBlob(transcript.audio_path || '');
    
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
    
    // Use memoized date formatting hook
    const formattedTime = useOptimizedDateFormat(transcript.created_at, variant);
    
    const handleCopy = useCallback(async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!isBlankAudio) {
            await navigator.clipboard.writeText(transcript.text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    }, [isBlankAudio, transcript.text]);
    
    const handlePlayPause = useCallback(async (e: React.MouseEvent) => {
        e.stopPropagation();
        
        if (isPlaying && audioRef.current) {
            audioRef.current.pause();
            setIsPlaying(false);
        } else {
            // Load audio on demand
            if (!audioBlob && !isAudioLoading) {
                await loadAudio();
            }
            
            if (audioBlob) {
                // Create audio element if it doesn't exist
                if (!audioRef.current) {
                    const url = URL.createObjectURL(audioBlob);
                    audioRef.current = new Audio(url);
                    audioRef.current.onended = () => setIsPlaying(false);
                }
                
                try {
                    await audioRef.current.play();
                    setIsPlaying(true);
                } catch (error) {
                    console.error('Failed to play audio:', error);
                }
            }
        }
    }, [isPlaying, audioBlob, isAudioLoading, loadAudio]);
    
    const handleClick = () => {
        if (onClick) {
            onClick(transcript);
        }
    };
    
    return (
        <div 
            className={`transcript-item ${variant} ${isSelected ? 'selected' : ''} ${isActive ? 'active' : ''} ${onClick ? 'clickable' : ''}`}
            onClick={handleClick}
            style={style}
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
                
                <div className="transcript-text-container">
                    {isBlankAudio ? (
                        <span className="transcript-empty">No speech detected</span>
                    ) : (
                        <p className="transcript-text">{transcript.text}</p>
                    )}
                </div>
                
                <span className="transcript-time">{formattedTime}</span>
                
                <div className="transcript-actions">
                    {transcript.audio_path && (
                        <button
                            className="transcript-action-button play"
                            onClick={handlePlayPause}
                            title={isPlaying ? "Pause audio" : "Play audio"}
                            disabled={isAudioLoading}
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
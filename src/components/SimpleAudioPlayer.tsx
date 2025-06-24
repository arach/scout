import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, RotateCcw } from 'lucide-react';
import './SimpleAudioPlayer.css';
import { useAudioBlob } from '../hooks/useAudioBlob';

interface SimpleAudioPlayerProps {
    audioPath: string;
    duration: number;
    formatDuration: (ms: number) => string;
}

export function SimpleAudioPlayer({ audioPath, duration, formatDuration }: SimpleAudioPlayerProps) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [actualDuration, setActualDuration] = useState(duration);
    
    const { blob, isLoading, error } = useAudioBlob(audioPath);
    
    // Create blob URL for audio element
    const audioUrl = React.useMemo(() => {
        if (!blob) return null;
        return URL.createObjectURL(blob);
    }, [blob]);
    
    // Cleanup blob URL
    useEffect(() => {
        return () => {
            if (audioUrl) {
                URL.revokeObjectURL(audioUrl);
            }
        };
    }, [audioUrl]);
    
    // Update time
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;
        
        const updateTime = () => {
            setCurrentTime(audio.currentTime * 1000);
        };
        
        const handleLoadedMetadata = () => {
            setActualDuration(audio.duration * 1000);
        };
        
        const handleEnded = () => {
            setIsPlaying(false);
            setCurrentTime(0);
        };
        
        audio.addEventListener('timeupdate', updateTime);
        audio.addEventListener('loadedmetadata', handleLoadedMetadata);
        audio.addEventListener('ended', handleEnded);
        
        return () => {
            audio.removeEventListener('timeupdate', updateTime);
            audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
            audio.removeEventListener('ended', handleEnded);
        };
    }, [audioUrl]);
    
    const togglePlayPause = () => {
        if (!audioRef.current) return;
        
        if (isPlaying) {
            audioRef.current.pause();
            setIsPlaying(false);
        } else {
            audioRef.current.play();
            setIsPlaying(true);
        }
    };
    
    const restart = () => {
        if (!audioRef.current) return;
        audioRef.current.currentTime = 0;
        setCurrentTime(0);
        if (isPlaying) {
            audioRef.current.play();
        }
    };
    
    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!audioRef.current) return;
        const newTime = parseFloat(e.target.value);
        audioRef.current.currentTime = newTime / 1000;
        setCurrentTime(newTime);
    };
    
    if (error) {
        return <div className="audio-player-error">Error loading audio: {error}</div>;
    }
    
    return (
        <div className="simple-audio-player">
            {audioUrl && (
                <audio ref={audioRef} src={audioUrl} preload="metadata" />
            )}
            
            <div className="audio-controls">
                <button 
                    onClick={togglePlayPause} 
                    className="audio-control-button play-pause"
                    disabled={isLoading || !audioUrl}
                    title={isPlaying ? "Pause" : "Play"}
                >
                    {isLoading ? (
                        <div className="loading-spinner" />
                    ) : isPlaying ? (
                        <Pause size={20} />
                    ) : (
                        <Play size={20} />
                    )}
                </button>
                
                <button 
                    onClick={restart} 
                    className="audio-control-button"
                    disabled={isLoading || !audioUrl}
                    title="Restart"
                >
                    <RotateCcw size={16} />
                </button>
                
                <div className="time-display">
                    <span className="current-time">{formatDuration(currentTime)}</span>
                    <span className="time-separator">/</span>
                    <span className="total-time">{formatDuration(actualDuration)}</span>
                </div>
            </div>
            
            <div className="progress-container">
                <input
                    type="range"
                    className="progress-slider"
                    min="0"
                    max={actualDuration}
                    value={currentTime}
                    onChange={handleSeek}
                    disabled={isLoading || !audioUrl}
                />
                <div 
                    className="progress-bar"
                    style={{ width: `${(currentTime / actualDuration) * 100}%` }}
                />
            </div>
        </div>
    );
}
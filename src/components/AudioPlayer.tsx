import React, { useState, useRef, useEffect } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import './AudioPlayer.css';

interface AudioPlayerProps {
    audioPath: string;
    duration: number;
    formatDuration: (ms: number) => string;
}

export function AudioPlayer({ audioPath, duration, formatDuration }: AudioPlayerProps) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [playbackRate, setPlaybackRate] = useState(1);
    const [hasError, setHasError] = useState(false);
    
    // Convert the file path to a URL that can be loaded by the audio element
    const audioUrl = convertFileSrc(audioPath);
    
    // Calculate progress percentage for visual progress bar
    const progressPercentage = duration > 0 ? (currentTime / duration) * 100 : 0;

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const updateTime = () => setCurrentTime(audio.currentTime * 1000);
        const handleEnded = () => setIsPlaying(false);
        const handleError = (e: Event) => {
            console.error('Audio playback error:', e);
            setHasError(true);
            setIsPlaying(false);
        };
        const handleCanPlay = () => {
            console.log('Audio can play');
            setHasError(false);
        };

        audio.addEventListener('timeupdate', updateTime);
        audio.addEventListener('ended', handleEnded);
        audio.addEventListener('error', handleError);
        audio.addEventListener('canplay', handleCanPlay);

        return () => {
            audio.removeEventListener('timeupdate', updateTime);
            audio.removeEventListener('ended', handleEnded);
            audio.removeEventListener('error', handleError);
            audio.removeEventListener('canplay', handleCanPlay);
        };
    }, []);

    const togglePlayPause = async () => {
        if (!audioRef.current || hasError) return;

        try {
            if (isPlaying) {
                audioRef.current.pause();
                setIsPlaying(false);
            } else {
                await audioRef.current.play();
                setIsPlaying(true);
            }
        } catch (error) {
            console.error('Failed to toggle playback:', error);
            setHasError(true);
            setIsPlaying(false);
        }
    };

    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!audioRef.current) return;
        const time = parseFloat(e.target.value) / 1000;
        audioRef.current.currentTime = time;
        setCurrentTime(parseFloat(e.target.value));
    };

    const handlePlaybackRateChange = () => {
        if (!audioRef.current) return;
        const rates = [1, 1.25, 1.5, 1.75, 2];
        const currentIndex = rates.indexOf(playbackRate);
        const nextIndex = (currentIndex + 1) % rates.length;
        const newRate = rates[nextIndex];
        
        audioRef.current.playbackRate = newRate;
        setPlaybackRate(newRate);
    };

    return (
        <div className="audio-player">
            <audio ref={audioRef} src={audioUrl} preload="metadata" />
            
            {hasError && (
                <div style={{ color: 'red', fontSize: '12px', marginBottom: '8px' }}>
                    Error loading audio file. The file may be missing or in an unsupported format.
                </div>
            )}
            
            <div className="audio-player-controls">
                <button 
                    className="play-pause-button" 
                    onClick={togglePlayPause}
                    disabled={hasError}
                    title={isPlaying ? "Pause" : "Play"}
                >
                    {isPlaying ? (
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect x="4" y="3" width="2.5" height="10" rx="0.5" fill="currentColor"/>
                            <rect x="9.5" y="3" width="2.5" height="10" rx="0.5" fill="currentColor"/>
                        </svg>
                    ) : (
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M5 3.5V12.5L12 8L5 3.5Z" fill="currentColor"/>
                        </svg>
                    )}
                </button>

                <div className="audio-player-timeline">
                    <span className="audio-time">{formatDuration(currentTime)}</span>
                    <div className="seek-bar-container">
                        <div className="seek-bar-background">
                            <div 
                                className="seek-bar-progress"
                                style={{ width: `${progressPercentage}%` }}
                            />
                        </div>
                        <input
                            type="range"
                            className="audio-seek-bar"
                            min="0"
                            max={duration}
                            value={currentTime}
                            onChange={handleSeek}
                        />
                    </div>
                    <span className="audio-time">{formatDuration(duration)}</span>
                </div>

                <button 
                    className="playback-rate-button"
                    onClick={handlePlaybackRateChange}
                    title="Playback speed"
                >
                    {playbackRate}x
                </button>
            </div>
        </div>
    );
}
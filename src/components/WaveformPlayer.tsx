import React, { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { convertFileSrc } from '@tauri-apps/api/core';
import './WaveformPlayer.css';

interface WaveformPlayerProps {
    audioPath: string;
    duration: number;
    formatDuration: (ms: number) => string;
}

export function WaveformPlayer({ audioPath, duration, formatDuration }: WaveformPlayerProps) {
    const waveformRef = useRef<HTMLDivElement>(null);
    const wavesurfer = useRef<WaveSurfer | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [playbackRate, setPlaybackRate] = useState(1);
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);

    // Convert the file path to a URL that can be loaded by WaveSurfer
    const audioUrl = convertFileSrc(audioPath);

    useEffect(() => {
        if (!waveformRef.current) return;

        // Get computed CSS variables
        const computedStyle = getComputedStyle(document.documentElement);
        const waveColor = computedStyle.getPropertyValue('--border-secondary').trim() || '#dddddd';
        const progressColor = computedStyle.getPropertyValue('--accent-primary').trim() || '#007acc';

        // Initialize WaveSurfer
        wavesurfer.current = WaveSurfer.create({
            container: waveformRef.current,
            waveColor: waveColor,
            progressColor: progressColor,
            cursorColor: progressColor,
            barWidth: 2,
            barGap: 1,
            barRadius: 2,
            responsive: true,
            height: 48,
            normalize: true,
            backend: 'WebAudio',
            mediaControls: false,
        });

        // Event listeners
        wavesurfer.current.on('ready', () => {
            console.log('WaveSurfer ready');
            setIsLoading(false);
            setHasError(false);
        });

        wavesurfer.current.on('loading', (percent) => {
            console.log('WaveSurfer loading:', percent);
        });

        wavesurfer.current.on('error', (error) => {
            console.error('WaveSurfer error:', error);
            setHasError(true);
            setIsLoading(false);
        });

        wavesurfer.current.on('play', () => {
            setIsPlaying(true);
        });

        wavesurfer.current.on('pause', () => {
            setIsPlaying(false);
        });

        wavesurfer.current.on('finish', () => {
            setIsPlaying(false);
        });

        wavesurfer.current.on('audioprocess', () => {
            if (wavesurfer.current) {
                const current = wavesurfer.current.getCurrentTime();
                setCurrentTime(current * 1000); // Convert to milliseconds
            }
        });

        wavesurfer.current.on('seek', () => {
            if (wavesurfer.current) {
                const current = wavesurfer.current.getCurrentTime();
                setCurrentTime(current * 1000);
            }
        });

        // Load the audio
        wavesurfer.current.load(audioUrl);

        return () => {
            if (wavesurfer.current) {
                wavesurfer.current.destroy();
            }
        };
    }, [audioUrl]);

    const togglePlayPause = () => {
        if (!wavesurfer.current || hasError) return;
        wavesurfer.current.playPause();
    };

    const handlePlaybackRateChange = () => {
        if (!wavesurfer.current) return;
        const rates = [1, 1.25, 1.5, 1.75, 2];
        const currentIndex = rates.indexOf(playbackRate);
        const nextIndex = (currentIndex + 1) % rates.length;
        const newRate = rates[nextIndex];
        
        wavesurfer.current.setPlaybackRate(newRate);
        setPlaybackRate(newRate);
    };

    return (
        <div className="waveform-player">
            {hasError && (
                <div className="error-message">
                    Error loading audio file. The file may be missing or in an unsupported format.
                </div>
            )}
            
            <div className="waveform-controls">
                <button 
                    className="play-pause-button" 
                    onClick={togglePlayPause}
                    disabled={isLoading || hasError}
                    title={isPlaying ? "Pause" : "Play"}
                >
                    {isLoading ? (
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1" fill="none" strokeDasharray="5,2" className="loading-spinner"/>
                        </svg>
                    ) : isPlaying ? (
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

                <div className="waveform-timeline">
                    <span className="time-display">{formatDuration(currentTime)}</span>
                    <span className="time-separator">/</span>
                    <span className="time-display">{formatDuration(duration)}</span>
                </div>

                <button 
                    className="playback-rate-button"
                    onClick={handlePlaybackRateChange}
                    disabled={isLoading || hasError}
                    title="Playback speed"
                >
                    {playbackRate}x
                </button>
            </div>

            <div className="waveform-container">
                <div ref={waveformRef} className="waveform" />
                {isLoading && (
                    <div className="loading-overlay">
                        <div className="loading-text">Loading waveform...</div>
                    </div>
                )}
            </div>
        </div>
    );
}
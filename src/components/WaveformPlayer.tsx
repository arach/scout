import { useState, useEffect, useMemo } from 'react';
import WavesurferPlayer from '@wavesurfer/react';
import './WaveformPlayer.css';
import { useAudioBlob } from '../hooks/useAudioBlob';

const ZOOM_LEVELS = [50, 100, 200, 400, 800];
const INITIAL_ZOOM_INDEX = 1;

interface WaveformPlayerProps {
    audioPath: string;
    duration: number;
    formatDuration: (ms: number) => string;
}

export function WaveformPlayer({ audioPath, duration, formatDuration }: WaveformPlayerProps) {
    const [wavesurfer, setWavesurfer] = useState<any>(null);
    const [isReady, setIsReady] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [actualDuration, setActualDuration] = useState(duration);

    const { blob, isLoading: isBlobLoading, error: blobError } = useAudioBlob(audioPath);

    // Create blob URL for WaveSurfer
    const audioUrl = useMemo(() => {
        if (!blob) return null;
        return URL.createObjectURL(blob);
    }, [blob]);

    // Cleanup blob URL when component unmounts or blob changes
    useEffect(() => {
        return () => {
            if (audioUrl) {
                URL.revokeObjectURL(audioUrl);
            }
        };
    }, [audioUrl]);

    const onReady = (ws: any) => {
        const audioDuration = ws.getDuration();
        setActualDuration(audioDuration * 1000); // Convert to milliseconds
        setWavesurfer(ws);
        setIsReady(true);
    };

    const onPlay = () => {
        setIsPlaying(true);
    };

    const onPause = () => {
        setIsPlaying(false);
    };

    const onTimeupdate = (wavesurfer: any) => {
        setCurrentTime(wavesurfer.getCurrentTime() * 1000);
    };

    const [playbackRate, setPlaybackRate] = useState(1);
    const [currentZoomIndex, setCurrentZoomIndex] = useState(INITIAL_ZOOM_INDEX);

    const togglePlayPause = () => {
        if (!wavesurfer) return;
        wavesurfer.playPause();
    };

    const handlePlaybackRateChange = () => {
        if (!wavesurfer) return;
        const rates = [1, 1.25, 1.5, 1.75, 2];
        const currentIndex = rates.indexOf(playbackRate);
        const nextIndex = (currentIndex + 1) % rates.length;
        const newRate = rates[nextIndex];
        setPlaybackRate(newRate);
        wavesurfer.setPlaybackRate(newRate);
    };

    const handleZoomChange = (direction: 'in' | 'out') => {
        if (!wavesurfer) return;
        
        let newIndex = currentZoomIndex;
        
        if (direction === 'in' && currentZoomIndex < ZOOM_LEVELS.length - 1) {
            newIndex = currentZoomIndex + 1;
        } else if (direction === 'out' && currentZoomIndex > 0) {
            newIndex = currentZoomIndex - 1;
        }
        
        if (newIndex !== currentZoomIndex) {
            setCurrentZoomIndex(newIndex);
            wavesurfer.zoom(ZOOM_LEVELS[newIndex]);
        }
    };

    const isLoading = isBlobLoading || !isReady;
    const error = blobError;

    return (
        <div className="waveform-player">
            <div className="waveform-controls">
                <button onClick={togglePlayPause} className="play-pause-button" disabled={isLoading || !!error}>
                    {isLoading ? <div className="loading-spinner" /> : isPlaying ? '❚❚' : '►'}
                </button>
                <div className="waveform-timeline">
                    <span className="time-display">{formatDuration(currentTime)}</span>
                    <span className="time-separator">/</span>
                    <span className="time-display">{formatDuration(actualDuration)}</span>
                </div>
                <button onClick={handlePlaybackRateChange} className="playback-rate-button" disabled={isLoading || !!error}>
                    {playbackRate}x
                </button>
                <div className="zoom-controls">
                    <button 
                        onClick={() => handleZoomChange('out')} 
                        className="zoom-button" 
                        disabled={isLoading || !!error || currentZoomIndex === 0}
                        title="Zoom Out"
                    >
                        −
                    </button>
                    <button 
                        onClick={() => handleZoomChange('in')} 
                        className="zoom-button" 
                        disabled={isLoading || !!error || currentZoomIndex === ZOOM_LEVELS.length - 1}
                        title="Zoom In"
                    >
                        +
                    </button>
                </div>
            </div>
            
            <div className="waveform-container">
                {audioUrl ? (
                    <WavesurferPlayer
                        height={120}
                        waveColor="#ddd"
                        progressColor="#0066cc"
                        cursorColor="#0066cc"
                        url={audioUrl}
                        onReady={onReady}
                        onPlay={onPlay}
                        onPause={onPause}
                        onTimeupdate={onTimeupdate}
                        barWidth={3}
                        barGap={1}
                        barRadius={3}
                        normalize={true}
                        interact={true}
                    />
                ) : (
                    <div className="loading-overlay">
                        <div className="loading-text">Loading waveform...</div>
                    </div>
                )}
            </div>

            {error && <div className="error-message">{error}</div>}
        </div>
    );
}
import React, { Fragment } from 'react';
import { SessionTranscripts } from './SessionTranscripts';
import './RecordView.css';

interface UploadProgress {
    filename?: string;
    fileSize?: number;
    status: 'idle' | 'uploading' | 'queued' | 'processing' | 'converting' | 'transcribing';
    queuePosition?: number;
    progress?: number;
}

interface Transcript {
    id: number;
    text: string;
    duration_ms: number;
    created_at: string;
    metadata?: string;
}

interface RecordViewProps {
    isRecording: boolean;
    isProcessing: boolean;
    recordingDuration: number;
    hotkey: string;
    uploadProgress: UploadProgress;
    sessionTranscripts?: Transcript[];
    startRecording: () => void;
    stopRecording: () => void;
    handleFileUpload: () => void;
    formatDuration: (ms: number) => string;
    formatFileSize: (bytes: number) => string;
}

export function RecordView({
    isRecording,
    isProcessing,
    recordingDuration,
    hotkey,
    uploadProgress,
    sessionTranscripts = [],
    startRecording,
    stopRecording,
    handleFileUpload,
    formatDuration,
    formatFileSize,
}: RecordViewProps) {
    return (
        <div className="record-view">
            <div className="record-view-content">
                <button
                    className={`record-button ${isRecording ? 'recording' : ''} ${isProcessing ? 'processing' : ''}`}
                    onClick={isRecording ? stopRecording : startRecording}
                    disabled={isProcessing}
                >
                    {isProcessing ? (
                        <span>Processing...</span>
                    ) : isRecording ? (
                        <div className="recording-content">
                            <div className="mini-waveform">
                                <span className="mini-wave"></span>
                                <span className="mini-wave"></span>
                                <span className="mini-wave"></span>
                            </div>
                            <span className="rec-timer">{formatDuration(recordingDuration)}</span>
                        </div>
                    ) : (
                        <>
                            <div className="record-circle" />
                            <span>Start Recording</span>
                        </>
                    )}
                </button>

                <div className="upload-section">
                    <span>or</span>
                    <button
                        className="upload-link-button"
                        onClick={handleFileUpload}
                        disabled={isProcessing}
                    >
                        upload an audio file
                    </button>
                </div>

                <div className="hints-container">
                    <p className="hotkey-hint">
                        {hotkey.split('+').map((key, idx) => (
                            <Fragment key={idx}>
                                {idx > 0 && ' + '}
                                <kbd>{key}</kbd>
                            </Fragment>
                        ))}
                    </p>
                    <p className="drag-hint">or drag & drop audio files</p>
                </div>

                {uploadProgress.status !== 'idle' && (
                    <div className="upload-progress-container">
                        <div className="upload-progress-header">
                            <h3>Processing Upload</h3>
                            {uploadProgress.filename && (
                                <span className="upload-filename">{uploadProgress.filename}</span>
                            )}
                        </div>

                        <div className="upload-progress-status">
                            {uploadProgress.status === 'uploading' && (
                                <>
                                    <div className="spinner"></div>
                                    <span>Uploading file...</span>
                                </>
                            )}
                            {uploadProgress.status === 'queued' && (
                                <>
                                    <div className="spinner"></div>
                                    <span>In queue{uploadProgress.queuePosition ? ` (position ${uploadProgress.queuePosition})` : ''}</span>
                                </>
                            )}
                            {uploadProgress.status === 'processing' && (
                                <>
                                    <div className="spinner"></div>
                                    <span>Processing audio file...</span>
                                </>
                            )}
                            {uploadProgress.status === 'converting' && (
                                <>
                                    <div className="spinner"></div>
                                    <span>Converting to WAV format...</span>
                                </>
                            )}
                            {uploadProgress.status === 'transcribing' && (
                                <>
                                    <div className="spinner"></div>
                                    <span>Transcribing speech to text...</span>
                                </>
                            )}
                        </div>

                        {uploadProgress.fileSize && (
                            <div className="upload-file-info">
                                <span>Size: {formatFileSize(uploadProgress.fileSize)}</span>
                            </div>
                        )}
                    </div>
                )}

                <SessionTranscripts 
                    transcripts={sessionTranscripts}
                    formatDuration={formatDuration}
                />
            </div>
        </div>
    );
} 
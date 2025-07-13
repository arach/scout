import { Fragment, useRef, useEffect, useState } from 'react';
import { Settings } from 'lucide-react';
import { MicrophoneQuickPicker } from './MicrophoneQuickPicker';
import { SessionTranscripts } from './SessionTranscripts';
import { RecordingTimer } from './RecordingTimer';
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
    audio_path?: string;
    file_size?: number;
}

interface RecordViewProps {
    isRecording: boolean;
    isProcessing: boolean;
    recordingStartTime: number | null;
    hotkey: string;
    pushToTalkHotkey: string;
    uploadProgress: UploadProgress;
    sessionTranscripts?: Transcript[];
    selectedMic: string;
    onMicChange: (mic: string) => void;
    audioLevel: number;
    startRecording: () => void;
    stopRecording: () => void;
    cancelRecording: () => void;
    handleFileUpload: () => void;
    formatDuration: (ms: number) => string;
    formatRecordingTimer?: (ms: number) => string;
    showDeleteConfirmation: (id: number, text: string) => void;
}

// Helper function to format keyboard keys
function formatKey(key: string): string {
    const keyMap: { [key: string]: string } = {
        'Up': '↑',
        'Down': '↓',
        'Left': '←',
        'Right': '→',
        'CmdOrCtrl': '⌘',
        'Cmd': '⌘',
        'Ctrl': 'Ctrl',
        'Shift': '⇧',
        'Alt': '⌥',
        'Option': '⌥',
        'Enter': '↵',
        'Return': '↵',
        'Space': '␣',
        'Tab': '⇥',
        'Escape': 'Esc',
        'Backspace': '⌫',
        'Delete': '⌦'
    };
    
    return keyMap[key] || key;
}

export function RecordView({
    isRecording,
    isProcessing,
    recordingStartTime,
    hotkey,
    pushToTalkHotkey,
    uploadProgress,
    sessionTranscripts = [],
    selectedMic,
    onMicChange,
    audioLevel,
    startRecording,
    stopRecording,
    cancelRecording,
    handleFileUpload,
    formatDuration,
    formatRecordingTimer,
    showDeleteConfirmation,
}: RecordViewProps) {
    const [showSuccessHint, setShowSuccessHint] = useState(false);
    const [showQuickMicPicker, setShowQuickMicPicker] = useState(false);
    const gearButtonRef = useRef<HTMLButtonElement>(null);
    const transcriptCountRef = useRef(sessionTranscripts.length);

    // Show success hint after first few recordings
    useEffect(() => {
        if (sessionTranscripts.length > transcriptCountRef.current && sessionTranscripts.length <= 3) {
            setShowSuccessHint(true);
            const timer = setTimeout(() => setShowSuccessHint(false), 8000);
            return () => clearTimeout(timer);
        }
        transcriptCountRef.current = sessionTranscripts.length;
    }, [sessionTranscripts.length]);

    return (
        <div className="record-view">
            <div className="record-view-content">
                
                {/* Main Recording Zone */}
                <div className="recording-zone">
                    {isRecording ? (
                        /* Recording State - Keep same layout but change button to stop */
                        <div className="recording-idle">
                            <div className="button-container">
                                {/* Keep the visualizer ring but make it pulsing/animated for recording */}
                                <div 
                                    className="audio-visualizer-ring recording-ring"
                                    style={{
                                        '--audio-level': audioLevel
                                    } as React.CSSProperties}
                                />
                                
                                {/* Same large button but now a stop button */}
                                <button
                                    className="circular-record-button recording-button"
                                    onClick={stopRecording}
                                    title="Stop recording"
                                    style={{
                                        '--audio-level': audioLevel
                                    } as React.CSSProperties}
                                >
                                    {/* Audio level fill indicator - darker for recording state */}
                                    <div 
                                        className="audio-level-fill recording"
                                        style={{
                                            height: `${audioLevel * 100}%`
                                        }}
                                    />
                                    <div className="stop-icon-large">
                                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                                            <rect x="6" y="6" width="12" height="12" fill="currentColor" rx="2"/>
                                        </svg>
                                    </div>
                                </button>
                            </div>
                            
                            <div className="record-hint">
                                <div className="status-indicator">
                                    <span className="status-dot recording"></span>
                                    <span className="status-text">Recording</span>
                                </div>
                                <div className="recording-timer">
                                    <RecordingTimer 
                                        startTime={recordingStartTime} 
                                        formatTimer={formatRecordingTimer || formatDuration} 
                                    />
                                </div>
                            </div>
                            
                            {/* Cancel button positioned nearby */}
                            <button
                                className="cancel-recording-button-small"
                                onClick={cancelRecording}
                                title="Cancel recording (Escape)"
                            >
                                Cancel
                            </button>
                        </div>
                    ) : isProcessing ? (
                        /* Processing State */
                        <div className="processing-state">
                            <div className="processing-animation">
                                <div className="processing-spinner"></div>
                            </div>
                            <h3>Transcribing your audio...</h3>
                            <div className="status-indicator">
                                <span className="status-dot processing"></span>
                                <span className="status-text">Processing</span>
                            </div>
                            {uploadProgress.filename && (
                                <div className="processing-filename">
                                    {uploadProgress.filename}
                                </div>
                            )}
                        </div>
                    ) : (
                        /* Idle State */
                        <div className="recording-idle">
                            <div className="button-container">
                                {/* Audio Visualizer Ring */}
                                <div 
                                    className="audio-visualizer-ring" 
                                    style={{
                                        '--audio-level': audioLevel
                                    } as React.CSSProperties}
                                />
                                
                                <button
                                    className="circular-record-button"
                                    onClick={startRecording}
                                    disabled={isProcessing}
                                    style={{
                                        '--audio-level': audioLevel
                                    } as React.CSSProperties}
                                >
                                    {/* Audio level fill indicator */}
                                    <div 
                                        className="audio-level-fill"
                                        style={{
                                            height: `${audioLevel * 100}%`
                                        }}
                                    />
                                    <div 
                                        className="microphone-icon"
                                    >
                                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                                            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                                            <line x1="12" y1="19" x2="12" y2="23"/>
                                            <line x1="8" y1="23" x2="16" y2="23"/>
                                        </svg>
                                    </div>
                                </button>
                                
                                {/* Gear button for mic selection */}
                                <button
                                    ref={gearButtonRef}
                                    className={`mic-settings-button ${showQuickMicPicker ? 'active' : ''}`}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setShowQuickMicPicker(!showQuickMicPicker);
                                    }}
                                    title="Select microphone"
                                >
                                    <Settings 
                                        className={`w-2.5 h-2.5 transition-colors duration-200 ${
                                            showQuickMicPicker ? 'text-blue-600' : 'text-slate-500'
                                        }`}
                                        strokeWidth={1.5}
                                    />
                                </button>
                                
                                {/* Custom tooltip */}
                                <div className="record-tooltip">
                                    <div className="tooltip-content">
                                        <div className="tooltip-header">Shortcuts</div>
                                        <div className="tooltip-row">
                                            <span className="tooltip-label">Toggle</span>
                                            <span className="tooltip-keys">
                                                {hotkey.split('+').map((key, idx) => (
                                                    <Fragment key={idx}>
                                                        {idx > 0 && <span className="plus">+</span>}
                                                        <kbd>{formatKey(key)}</kbd>
                                                    </Fragment>
                                                ))}
                                            </span>
                                        </div>
                                        <div className="tooltip-row">
                                            <span className="tooltip-label">Push-to-Talk</span>
                                            <span className="tooltip-keys">
                                                {pushToTalkHotkey.split('+').map((key, idx) => (
                                                    <Fragment key={idx}>
                                                        {idx > 0 && <span className="plus">+</span>}
                                                        <kbd>{formatKey(key)}</kbd>
                                                    </Fragment>
                                                ))}
                                            </span>
                                        </div>
                                        <div className="tooltip-hint">
                                            Hold for voice, release to stop
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="record-hint">
                                <div className="status-indicator">
                                    <span className="status-dot"></span>
                                    <span className="status-text">Ready</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Success hint after first recordings */}
                {showSuccessHint && !isRecording && !isProcessing && (
                    <div className="success-hint">
                        <div className="success-hint-content">
                            <div className="hint-icon">💡</div>
                            <div className="hint-text">
                                <strong>Pro tip:</strong> Hold{' '}
                                <span className="hint-keys">
                                    {pushToTalkHotkey.split('+').map((key, idx) => (
                                        <Fragment key={idx}>
                                            {idx > 0 && <span className="plus">+</span>}
                                            <kbd>{formatKey(key)}</kbd>
                                        </Fragment>
                                    ))}
                                </span>{' '}
                                for push-to-talk recording
                            </div>
                        </div>
                    </div>
                )}

                <SessionTranscripts 
                    transcripts={sessionTranscripts}
                    formatDuration={formatDuration}
                    showDeleteConfirmation={showDeleteConfirmation}
                    onImportAudio={handleFileUpload}
                />
            </div>
            
            {/* Mic picker dropdown */}
            <MicrophoneQuickPicker
                selectedMic={selectedMic}
                onMicChange={onMicChange}
                isOpen={showQuickMicPicker}
                onClose={() => setShowQuickMicPicker(false)}
                anchorElement={gearButtonRef.current}
            />
        </div>
    );
} 
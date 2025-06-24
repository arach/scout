import { TranscriptItem } from './TranscriptItem';
import './SessionTranscripts.css';

interface Transcript {
    id: number;
    text: string;
    duration_ms: number;
    created_at: string;
    metadata?: string;
    audio_path?: string;
    file_size?: number;
}

interface SessionTranscriptsProps {
    transcripts: Transcript[];
    formatDuration: (ms: number) => string;
    showDeleteConfirmation: (id: number, text: string) => void;
    onImportAudio?: () => void;
}

export function SessionTranscripts({ transcripts, formatDuration, showDeleteConfirmation, onImportAudio }: SessionTranscriptsProps) {
    if (transcripts.length === 0) {
        return (
            <div className="session-transcripts">
                <div className="session-header-with-actions">
                    <h3 className="session-header">Recent Transcripts</h3>
                    {onImportAudio && (
                        <button
                            className="import-audio-button"
                            onClick={onImportAudio}
                            title="Import audio file"
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="17,8 12,3 7,8"/>
                                <line x1="12" y1="3" x2="12" y2="15"/>
                            </svg>
                            import audio
                        </button>
                    )}
                </div>
                <div className="session-empty-state">
                    <div className="session-empty-icon">🎤</div>
                    <p className="session-empty-message">
                        No recent transcripts. Start recording or upload an audio file to begin!
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="session-transcripts">
            <div className="session-header-with-actions">
                <h3 className="session-header">Recent Transcripts</h3>
                {onImportAudio && (
                    <button
                        className="import-audio-button"
                        onClick={onImportAudio}
                        title="Import audio file"
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="17,8 12,3 7,8"/>
                            <line x1="12" y1="3" x2="12" y2="15"/>
                        </svg>
                        import audio
                    </button>
                )}
            </div>
            <div className="session-list">
                {transcripts.map((transcript) => (
                    <TranscriptItem
                        key={transcript.id}
                        transcript={transcript}
                        formatDuration={formatDuration}
                        onDelete={showDeleteConfirmation}
                        variant="compact"
                    />
                ))}
            </div>
        </div>
    );
}
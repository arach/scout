import { TranscriptItem } from './TranscriptItem';
import { Transcript } from '../types/transcript';
import './SessionTranscripts.css';

interface SessionTranscriptsProps {
    transcripts: Transcript[];
    formatDuration: (ms: number) => string;
    showDeleteConfirmation: (id: number, text: string) => void;
    onImportAudio?: () => void;
    navigateToTranscript: (transcriptId: number) => void;
}

export function SessionTranscripts({ transcripts, formatDuration, showDeleteConfirmation, onImportAudio, navigateToTranscript }: SessionTranscriptsProps) {
    if (transcripts.length === 0) {
        return (
            <div className="session-transcripts">
                <div className="session-table-container">
                    <table className="session-table">
                        <thead>
                            <tr>
                                <th>Time</th>
                                <th>Duration</th>
                                <th>Transcript</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr className="session-empty-row">
                                <td colSpan={4}>
                                    <div className="session-empty-content">
                                        <p className="session-empty-title">No transcripts yet</p>
                                        <p className="session-empty-subtitle">
                                            Start recording or upload an audio file to begin
                                        </p>
                                        {onImportAudio && (
                                            <button
                                                className="import-audio-button-integrated"
                                                onClick={onImportAudio}
                                                title="Import audio file"
                                            >
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                                    <polyline points="17,8 12,3 7,8"/>
                                                    <line x1="12" y1="3" x2="12" y2="15"/>
                                                </svg>
                                                Import Audio File
                                            </button>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }

    return (
        <div className="session-transcripts">
            {onImportAudio && (
                <div className="session-header-with-actions">
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
                </div>
            )}
            <div className="session-list">
                {transcripts.map((transcript) => (
                    <TranscriptItem
                        key={transcript.id}
                        transcript={transcript}
                        formatDuration={formatDuration}
                        onDelete={showDeleteConfirmation}
                        onClick={() => navigateToTranscript(transcript.id)}
                        variant="compact"
                    />
                ))}
            </div>
        </div>
    );
}
export type ViewType = 'record' | 'transcripts' | 'settings' | 'stats' | 'dictionary';

export interface DeleteConfirmation {
  show: boolean;
  transcriptId: number | null;
  transcriptText: string;
  isBulk: boolean;
}

export interface UploadProgress {
  filename: string;
  status: 'uploading' | 'processing' | 'complete' | 'error';
  progress: number;
  error?: string;
}
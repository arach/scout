export interface AppContext {
  name: string;
  bundle_id: string;
  path?: string;
  process_id?: number;
}

export interface TranscriptMetadata {
  model_used?: string;
  processing_type?: string;
  filename?: string;
  chunks_processed?: number;
  app_context?: AppContext;
  original_transcript?: string;
  filter_analysis?: string[];
}

export interface Transcript {
  id: number;
  text: string;
  duration_ms: number;
  created_at: string;
  metadata?: string; // JSON string that can be parsed to TranscriptMetadata
  audio_path?: string;
  file_size?: number;
}

// Helper function to parse metadata
export function parseTranscriptMetadata(metadataStr?: string): TranscriptMetadata | null {
  if (!metadataStr) return null;
  
  try {
    return JSON.parse(metadataStr);
  } catch (e) {
    console.error('Failed to parse transcript metadata:', e);
    return null;
  }
}

// Helper function to get app context from transcript
export function getAppContext(transcript: Transcript): AppContext | null {
  const metadata = parseTranscriptMetadata(transcript.metadata);
  return metadata?.app_context || null;
}
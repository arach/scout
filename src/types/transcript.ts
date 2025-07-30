import { loggers } from '../utils/logger';

export interface AppContext {
  name: string;
  bundle_id: string;
  path?: string;
  process_id?: number;
}

export interface DeviceMetadata {
  name: string;
  device_type?: string;
  is_default: boolean;
  notes: string[];
}

export interface BufferConfig {
  buffer_type: string;
  size_samples?: number;
  estimated_latency_ms?: number;
}

export interface FormatMetadata {
  sample_rate: number;
  requested_sample_rate?: number;
  channels: number;
  requested_channels?: number;
  sample_format: string;
  bit_depth: number;
  buffer_config: BufferConfig;
  data_rate_bytes_per_sec: number;
}

export interface RecordingMetadata {
  input_gain?: number;
  processing_applied: string[];
  vad_enabled: boolean;
  silence_padding_ms?: number;
  trigger_type: string;
}

export interface SystemMetadata {
  os: string;
  os_version: string;
  audio_backend: string;
  system_notes: string[];
}

export interface ConfigMismatch {
  mismatch_type: string;
  requested: string;
  actual: string;
  impact: string;
  resolution?: string;
}

export interface AudioMetadata {
  device: DeviceMetadata;
  format: FormatMetadata;
  recording: RecordingMetadata;
  system: SystemMetadata;
  mismatches: ConfigMismatch[];
  captured_at: string;
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
  audio_metadata?: string; // JSON string that can be parsed to AudioMetadata
  audio_path?: string;
  file_size?: number;
}

// Helper function to parse metadata
export function parseTranscriptMetadata(metadataStr?: string): TranscriptMetadata | null {
  if (!metadataStr) return null;
  
  try {
    return JSON.parse(metadataStr);
  } catch (e) {
    loggers.api.error('Failed to parse transcript metadata', e);
    return null;
  }
}

// Helper function to parse audio metadata
export function parseAudioMetadata(audioMetadataStr?: string): AudioMetadata | null {
  if (!audioMetadataStr) return null;
  
  try {
    return JSON.parse(audioMetadataStr);
  } catch (e) {
    loggers.api.error('Failed to parse audio metadata', e);
    return null;
  }
}

// Helper function to get app context from transcript
export function getAppContext(transcript: Transcript): AppContext | null {
  const metadata = parseTranscriptMetadata(transcript.metadata);
  return metadata?.app_context || null;
}
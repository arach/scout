import { invoke } from '@tauri-apps/api/core';
import { Transcript } from './transcript';

// Permission types
export type PermissionStatus = 'granted' | 'denied' | 'undetermined';

// Model types
export interface WhisperModel {
  id: string;
  name: string;
  size: string;
  downloaded: boolean;
  path?: string;
}

export interface LLMModel {
  id: string;
  name: string;
  size: string;
  downloaded: boolean;
  path?: string;
}

export interface LLMPromptTemplate {
  id: string;
  name: string;
  prompt: string;
  description?: string;
}

export interface LLMOutput {
  id: number;
  transcript_id: number;
  prompt_template_id: string;
  output_text: string;
  created_at: string;
}

// Performance types
export interface PerformanceMetrics {
  id: number;
  transcript_id: number | null;
  recording_duration_ms: number;
  transcription_time_ms: number;
  user_perceived_latency_ms: number | null;
  processing_queue_time_ms: number | null;
  model_used: string | null;
}

export interface PerformanceTimeline {
  events: any[];
  duration_ms: number;
}

// Settings types
export interface SoundSettings {
  startSound: string;
  stopSound: string;
  successSound: string;
}

export interface Settings {
  sidebar_expanded?: boolean;
  [key: string]: any;
}

/**
 * Type-safe wrapper for Tauri invoke calls with explicit type parameter
 * 
 * @param command - The Tauri command to invoke
 * @param args - Command arguments (optional)
 * @returns Promise with typed return value
 * 
 * @example
 * ```typescript
 * // Commands with arguments
 * const transcripts = await invokeTyped<Transcript[]>('get_recent_transcripts', { limit: 10 });
 * 
 * // Commands without arguments  
 * const isRecording = await invokeTyped<boolean>('is_recording');
 * ```
 */
export function invokeTyped<T = any>(
  command: string,
  args?: Record<string, any>
): Promise<T> {
  return invoke(command, args) as Promise<T>;
}

// Specific typed invoke functions for better type inference
export const tauriApi = {
  // Recording commands
  startRecording: (args: { device_name?: string | null }) => 
    invokeTyped<string>('start_recording', args),
  stopRecording: () => 
    invokeTyped<string>('stop_recording'),
  cancelRecording: () => 
    invokeTyped<void>('cancel_recording'),
  isRecording: () => 
    invokeTyped<boolean>('is_recording'),

  // Audio commands
  getAudioDevices: () => 
    invokeTyped<string[]>('get_audio_devices'),
  getCurrentAudioLevel: () => 
    invokeTyped<number>('get_current_audio_level'),
  startAudioLevelMonitoring: (args: { deviceName?: string }) => 
    invokeTyped<void>('start_audio_level_monitoring', args),
  stopAudioLevelMonitoring: () => 
    invokeTyped<void>('stop_audio_level_monitoring'),
  readAudioFile: (args: { audioPath: string }) => 
    invokeTyped<number[]>('read_audio_file', args),

  // Transcript commands
  getRecentTranscripts: (args: { limit: number }) => 
    invokeTyped<Transcript[]>('get_recent_transcripts', args),
  searchTranscripts: (args: { query: string }) => 
    invokeTyped<Transcript[]>('search_transcripts', args),
  deleteTranscript: (args: { id: number }) => 
    invokeTyped<void>('delete_transcript', args),
  exportTranscripts: (args: { format: string; transcriptIds: number[] }) => 
    invokeTyped<void>('export_transcripts', args),
  transcribeFile: (args: { filePath: string; fileName: string; language?: string }) => 
    invokeTyped<string>('transcribe_file', args),
  getTranscript: (args: { transcriptId: number }) => 
    invokeTyped<Transcript>('get_transcript', args),

  // Model commands
  getAvailableModels: () => 
    invokeTyped<WhisperModel[]>('get_available_models'),
  getCurrentModel: () => 
    invokeTyped<string>('get_current_model'),
  setActiveModel: (args: { modelId: string }) => 
    invokeTyped<void>('set_active_model', args),
  downloadModel: (args: { modelId: string; url: string }) => 
    invokeTyped<void>('download_model', args),
  getModelsDir: () => 
    invokeTyped<string>('get_models_dir'),

  // LLM commands
  getAvailableLLMModels: () => 
    invokeTyped<LLMModel[]>('get_available_llm_models'),
  setActiveLLMModel: (args: { modelId: string }) => 
    invokeTyped<void>('set_active_llm_model', args),
  downloadLLMModel: (args: { modelId: string }) => 
    invokeTyped<void>('download_llm_model', args),
  getLLMPromptTemplates: () => 
    invokeTyped<LLMPromptTemplate[]>('get_llm_prompt_templates'),
  getLLMOutputsForTranscript: (args: { transcriptId: number }) => 
    invokeTyped<LLMOutput[]>('get_llm_outputs_for_transcript', args),

  // Settings commands
  getSettings: () => 
    invokeTyped<Settings>('get_settings'),
  updateSettings: (args: Record<string, any>) => 
    invokeTyped<void>('update_settings', args),
  getOverlayPosition: () => 
    invokeTyped<string>('get_overlay_position'),
  setOverlayPosition: (args: { position: string }) => 
    invokeTyped<void>('set_overlay_position', args),
  getOverlayTreatment: () => 
    invokeTyped<string>('get_overlay_treatment'),
  setOverlayTreatment: (args: { treatment: string }) => 
    invokeTyped<void>('set_overlay_treatment', args),
  isSoundEnabled: () => 
    invokeTyped<boolean>('is_sound_enabled'),
  setSoundEnabled: (args: { enabled: boolean }) => 
    invokeTyped<void>('set_sound_enabled', args),
  getSoundSettings: () => 
    invokeTyped<SoundSettings>('get_sound_settings'),
  setStartSound: (args: { sound: string }) => 
    invokeTyped<void>('set_start_sound', args),
  setStopSound: (args: { sound: string }) => 
    invokeTyped<void>('set_stop_sound', args),
  setSuccessSound: (args: { sound: string }) => 
    invokeTyped<void>('set_success_sound', args),
  getAvailableSounds: () => 
    invokeTyped<string[]>('get_available_sounds'),
  isAutoCopyEnabled: () => 
    invokeTyped<boolean>('is_auto_copy_enabled'),
  setAutoCopyEnabled: (args: { enabled: boolean }) => 
    invokeTyped<void>('set_auto_copy_enabled', args),
  isAutoPasteEnabled: () => 
    invokeTyped<boolean>('is_auto_paste_enabled'),
  setAutoPasteEnabled: (args: { enabled: boolean }) => 
    invokeTyped<void>('set_auto_paste_enabled', args),
  updateCompletionSoundThreshold: (args: { thresholdMs: number }) => 
    invokeTyped<void>('update_completion_sound_threshold', args),
  updateLLMSettings: (args: { settings: any }) => 
    invokeTyped<void>('update_llm_settings', args),

  // Shortcut commands
  getCurrentShortcut: () => 
    invokeTyped<string>('get_current_shortcut'),
  getPushToTalkShortcut: () => 
    invokeTyped<string>('get_push_to_talk_shortcut'),
  updateGlobalShortcut: (args: { shortcut: string; actionType: string }) => 
    invokeTyped<void>('update_global_shortcut', args),

  // Permission commands
  checkMicrophonePermission: () => 
    invokeTyped<PermissionStatus>('check_microphone_permission'),
  requestMicrophonePermission: () => 
    invokeTyped<PermissionStatus>('request_microphone_permission'),

  // Performance commands
  getPerformanceMetricsForTranscript: (args: { transcriptId: number }) => 
    invokeTyped<PerformanceMetrics | null>('get_performance_metrics_for_transcript', args),
  getPerformanceTimeline: () => 
    invokeTyped<PerformanceTimeline | null>('get_performance_timeline'),
  getPerformanceTimelineForTranscript: (args: { transcriptId: number }) => 
    invokeTyped<any[]>('get_performance_timeline_for_transcript', args),
  getWhisperLogsForTranscript: (args: { transcriptId: number }) => 
    invokeTyped<any[]>('get_whisper_logs_for_transcript', args),

  // Sound commands
  playStartSound: () => 
    invokeTyped<void>('play_start_sound'),
  playStopSound: () => 
    invokeTyped<void>('play_stop_sound'),
  playSuccessSound: () => 
    invokeTyped<void>('play_success_sound'),
  previewSoundFlow: () => 
    invokeTyped<void>('preview_sound_flow'),

  // File commands
  downloadFile: (args: { url: string; fileName: string; destination: string }) => 
    invokeTyped<void>('download_file', args),
  openModelsFolder: () => 
    invokeTyped<void>('open_models_folder'),
  openLogFile: () => 
    invokeTyped<void>('open_log_file'),
  showLogFileInFinder: () => 
    invokeTyped<void>('show_log_file_in_finder'),
  openSystemPreferencesAudio: () => 
    invokeTyped<void>('open_system_preferences_audio'),

  // Overlay commands
  setOverlayWaveformStyle: (args: { style: string }) => 
    invokeTyped<void>('set_overlay_waveform_style', args),

  // Progress commands
  subscribeToProgress: () => 
    invokeTyped<string>('subscribe_to_progress'),

  // Onboarding commands
  markOnboardingComplete: () => 
    invokeTyped<void>('mark_onboarding_complete'),
};

/**
 * Legacy invoke function for gradual migration
 * Use invokeTyped or tauriApi for new code
 */
export { invoke as invokeUnsafe } from '@tauri-apps/api/core';

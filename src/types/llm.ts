export interface LLMModel {
  id: string;
  name: string;
  size_mb: number;
  description: string;
  model_url: string;
  tokenizer_url: string;
  filename: string;
  downloaded: boolean;
  active: boolean;
  parameters: string;
  speed: string;
  context_length: number;
}

export interface LLMSettings {
  enabled: boolean;
  model_id: string;
  temperature: number;
  max_tokens: number;
  auto_download_model: boolean;
  enabled_prompts: string[];
}

export interface LLMOutput {
  id: number;
  transcript_id: number;
  prompt_id: string;
  prompt_name: string;
  prompt_template: string;
  input_text: string;
  output_text: string;
  model_used: string;
  processing_time_ms: number;
  temperature: number;
  max_tokens: number;
  created_at: string;
  metadata?: string;
}

export interface LLMPromptTemplate {
  id: string;
  name: string;
  description?: string;
  template: string;
  category: string;
  enabled: boolean;
  is_custom: boolean;
  created_at: string;
  updated_at: string;
}

export interface LLMDownloadProgress {
  modelId: string;
  progress: number;
  downloadedMb: number;
  totalMb: number;
}
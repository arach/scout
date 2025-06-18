export interface RecordingProgress {
  status: "idle" | "recording" | "stopping" | "processing" | "transcribing" | "complete" | "failed";
  filename?: string;
  duration?: number;
  error?: string;
}
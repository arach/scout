/**
 * Recording a clip from the composer: the state machine and the pure parts.
 *
 * The hook (use-media-clip.ts) owns the browser objects — the stream and the
 * MediaRecorder. Everything that can be decided without them lives here, so
 * the recording state is testable without a microphone.
 *
 * A finished clip is an ordinary attachment: it is staged on the composer and
 * goes up through the same upload as a picked file. Nothing is sent until the
 * person presses send.
 */

export type ClipKind = "audio" | "video";

export type ClipState =
  | { phase: "idle" }
  /** Waiting on getUserMedia — the permission prompt is up. */
  | { phase: "requesting"; kind: ClipKind }
  | { phase: "recording"; kind: ClipKind; startedAt: number }
  | { phase: "error"; kind: ClipKind; message: string };

export type ClipAction =
  | { type: "request"; kind: ClipKind }
  | { type: "started"; at: number }
  | { type: "finished" }
  | { type: "discarded" }
  | { type: "failed"; message: string }
  | { type: "dismiss" };

export const CLIP_IDLE: ClipState = { phase: "idle" };

/**
 * Hard caps, so a forgotten recording cannot outgrow the upload. Hosted Chat
 * takes 4 MB a blob: 30s of video at the bitrate below fits, and five minutes
 * of speech at 32 kbps is about 1.2 MB.
 */
export const CLIP_LIMIT_MS: Record<ClipKind, number> = {
  audio: 5 * 60_000,
  video: 30_000,
};
export const CLIP_AUDIO_BITS = 32_000;
export const CLIP_VIDEO_BITS = 800_000;

export function clipReducer(state: ClipState, action: ClipAction): ClipState {
  switch (action.type) {
    case "request":
      // One recording at a time; a second press while busy is ignored.
      if (state.phase === "requesting" || state.phase === "recording") return state;
      return { phase: "requesting", kind: action.kind };
    case "started":
      if (state.phase !== "requesting") return state;
      return { phase: "recording", kind: state.kind, startedAt: action.at };
    case "finished":
    case "discarded":
      if (state.phase !== "recording" && state.phase !== "requesting") return state;
      return CLIP_IDLE;
    case "failed":
      if (state.phase === "idle") return state;
      return { phase: "error", kind: state.kind, message: action.message };
    case "dismiss":
      return state.phase === "error" ? CLIP_IDLE : state;
  }
}

/** "0:07", "1:42". */
export function clipElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const MIME_CANDIDATES: Record<ClipKind, readonly string[]> = {
  audio: ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"],
  video: ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"],
};

/** The first container this browser's MediaRecorder can write; "" lets it choose. */
export function pickClipMimeType(kind: ClipKind, isSupported: (type: string) => boolean): string {
  return MIME_CANDIDATES[kind].find((type) => {
    try {
      return isSupported(type);
    } catch {
      return false;
    }
  }) ?? "";
}

/**
 * The attachment's media type: the recorder's type without codec parameters,
 * which upload allowlists compare as bare types. Falls back to the kind.
 */
export function clipFileType(kind: ClipKind, recorderType: string): string {
  const bare = recorderType.split(";")[0]?.trim().toLowerCase() ?? "";
  return bare.startsWith(`${kind}/`) ? bare : `${kind}/webm`;
}

export function clipFileName(kind: ClipKind, fileType: string, at: number): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`;
  const extension = fileType.split("/")[1] === "mp4" ? (kind === "audio" ? "m4a" : "mp4") : fileType.split("/")[1] || "webm";
  return `${kind === "audio" ? "Audio" : "Video"} clip ${stamp}.${extension}`;
}

/** What went wrong, in words, for the failures getUserMedia actually throws. */
export function describeClipError(error: unknown, kind: ClipKind): string {
  const device = kind === "audio" ? "microphone" : "camera";
  const name = error instanceof Error || (typeof error === "object" && error !== null && "name" in error)
    ? String((error as { name?: unknown }).name ?? "")
    : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return `${device[0]!.toUpperCase()}${device.slice(1)} access was denied. Allow it in the browser's site settings to record.`;
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return `No ${device} was found.`;
  if (name === "NotReadableError" || name === "AbortError") return `The ${device} is in use by another app.`;
  if (name === "Unsupported") return "This browser cannot record clips.";
  return `Could not start the ${device}.`;
}

/** Recording needs both a capture API and a recorder; either missing hides the controls. */
export function canRecordClips(scope: {
  navigator?: { mediaDevices?: { getUserMedia?: unknown } };
  MediaRecorder?: unknown;
}): boolean {
  return typeof scope.navigator?.mediaDevices?.getUserMedia === "function"
    && typeof scope.MediaRecorder === "function";
}

/**
 * The composer's clip recorder: getUserMedia + MediaRecorder, driven by the
 * state machine in chat-media-clip.ts. A stopped recording is handed back as a
 * File for the composer to stage like any picked attachment; a discarded one
 * is dropped. The stream is released on every exit path, including unmount.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import {
  CLIP_AUDIO_BITS,
  CLIP_IDLE,
  CLIP_LIMIT_MS,
  CLIP_VIDEO_BITS,
  canRecordClips,
  clipFileName,
  clipFileType,
  clipReducer,
  describeClipError,
  pickClipMimeType,
  type ClipKind,
  type ClipState,
} from "./chat-media-clip.ts";

export type MediaClip = {
  state: ClipState;
  supported: boolean;
  elapsedMs: number;
  /** The live camera stream while a video clip records, for the preview. */
  stream: MediaStream | null;
  start: (kind: ClipKind) => void;
  /** Stop and keep: the clip is handed to `onClip`. */
  stop: () => void;
  discard: () => void;
  dismissError: () => void;
};

export function useMediaClip(onClip: (file: File) => void): MediaClip {
  const [state, dispatch] = useReducer(clipReducer, CLIP_IDLE);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const keepRef = useRef(false);
  // Bumped by every discard/stop/unmount: a permission prompt answered after
  // the person gave up must not start a recording nobody is watching.
  const attemptRef = useRef(0);
  const onClipRef = useRef(onClip);
  onClipRef.current = onClip;
  const supported = typeof window !== "undefined" && canRecordClips(window as unknown as Parameters<typeof canRecordClips>[0]);

  const release = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setStream(null);
  }, []);

  const start = useCallback((kind: ClipKind) => {
    if (recorderRef.current || streamRef.current) return;
    if (!supported) {
      dispatch({ type: "request", kind });
      dispatch({ type: "failed", message: describeClipError({ name: "Unsupported" }, kind) });
      return;
    }
    dispatch({ type: "request", kind });
    setElapsedMs(0);
    const attempt = ++attemptRef.current;
    const constraints: MediaStreamConstraints = kind === "audio"
      ? { audio: true }
      : { audio: true, video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" } };
    navigator.mediaDevices.getUserMedia(constraints).then((media) => {
      if (attempt !== attemptRef.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = media;
      const mimeType = pickClipMimeType(kind, (type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(media, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: CLIP_AUDIO_BITS,
        ...(kind === "video" ? { videoBitsPerSecond: CLIP_VIDEO_BITS } : {}),
      });
      const chunks: Blob[] = [];
      const startedAt = Date.now();
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        const keep = keepRef.current;
        keepRef.current = false;
        release();
        if (keep && chunks.length > 0) {
          const type = clipFileType(kind, recorder.mimeType || mimeType);
          const file = new File(chunks, clipFileName(kind, type, startedAt), { type, lastModified: Date.now() });
          onClipRef.current(file);
        }
      };
      recorderRef.current = recorder;
      if (kind === "video") setStream(media);
      recorder.start(1000);
      dispatch({ type: "started", at: startedAt });
    }).catch((error: unknown) => {
      if (attempt !== attemptRef.current) return;
      release();
      dispatch({ type: "failed", message: describeClipError(error, kind) });
    });
  }, [release, supported]);

  const finish = useCallback((keep: boolean) => {
    if (!recorderRef.current) attemptRef.current += 1;
    const recorder = recorderRef.current;
    keepRef.current = keep;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    else release();
    dispatch({ type: keep ? "finished" : "discarded" });
  }, [release]);

  const stop = useCallback(() => finish(true), [finish]);
  const discard = useCallback(() => finish(false), [finish]);
  const dismissError = useCallback(() => dispatch({ type: "dismiss" }), []);

  // The clock, and the cap: a recording stops (and keeps) at its limit.
  useEffect(() => {
    if (state.phase !== "recording") return;
    const tick = () => {
      const elapsed = Date.now() - state.startedAt;
      setElapsedMs(elapsed);
      if (elapsed >= CLIP_LIMIT_MS[state.kind]) finish(true);
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [finish, state]);

  // Leaving the composer mid-recording drops the clip and frees the device.
  useEffect(() => () => {
    attemptRef.current += 1;
    keepRef.current = false;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  return { state, supported, elapsedMs, stream, start, stop, discard, dismissError };
}

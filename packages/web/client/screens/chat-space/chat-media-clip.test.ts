import { describe, expect, test } from "bun:test";

import {
  CLIP_IDLE,
  canRecordClips,
  clipElapsed,
  clipFileName,
  clipFileType,
  clipReducer,
  describeClipError,
  pickClipMimeType,
  type ClipState,
} from "./chat-media-clip.ts";

describe("clip recording state", () => {
  test("idle → requesting → recording → idle when kept", () => {
    let state: ClipState = CLIP_IDLE;
    state = clipReducer(state, { type: "request", kind: "audio" });
    expect(state).toEqual({ phase: "requesting", kind: "audio" });
    state = clipReducer(state, { type: "started", at: 1_000 });
    expect(state).toEqual({ phase: "recording", kind: "audio", startedAt: 1_000 });
    expect(clipReducer(state, { type: "finished" })).toEqual(CLIP_IDLE);
    expect(clipReducer(state, { type: "discarded" })).toEqual(CLIP_IDLE);
  });

  test("a second request while busy is ignored, not restarted", () => {
    const recording: ClipState = { phase: "recording", kind: "video", startedAt: 5 };
    expect(clipReducer(recording, { type: "request", kind: "audio" })).toBe(recording);
    const requesting: ClipState = { phase: "requesting", kind: "audio" };
    expect(clipReducer(requesting, { type: "request", kind: "video" })).toBe(requesting);
  });

  test("a denied prompt becomes an error that can be dismissed", () => {
    const requesting: ClipState = { phase: "requesting", kind: "audio" };
    const failed = clipReducer(requesting, { type: "failed", message: "denied" });
    expect(failed).toEqual({ phase: "error", kind: "audio", message: "denied" });
    expect(clipReducer(failed, { type: "dismiss" })).toEqual(CLIP_IDLE);
    // A retry from the error state is allowed.
    expect(clipReducer(failed, { type: "request", kind: "audio" }).phase).toBe("requesting");
  });

  test("started without a request, or failing from idle, changes nothing", () => {
    expect(clipReducer(CLIP_IDLE, { type: "started", at: 1 })).toBe(CLIP_IDLE);
    expect(clipReducer(CLIP_IDLE, { type: "failed", message: "x" })).toBe(CLIP_IDLE);
  });
});

describe("clip helpers", () => {
  test("elapsed reads as m:ss", () => {
    expect(clipElapsed(0)).toBe("0:00");
    expect(clipElapsed(7_400)).toBe("0:07");
    expect(clipElapsed(102_000)).toBe("1:42");
    expect(clipElapsed(-5)).toBe("0:00");
  });

  test("the recorder type is picked from what the browser supports", () => {
    expect(pickClipMimeType("audio", (type) => type === "audio/mp4")).toBe("audio/mp4");
    expect(pickClipMimeType("video", () => false)).toBe("");
    expect(pickClipMimeType("audio", () => { throw new Error("no"); })).toBe("");
  });

  test("the attachment type drops codec parameters and falls back to webm", () => {
    expect(clipFileType("audio", "audio/webm;codecs=opus")).toBe("audio/webm");
    expect(clipFileType("video", "video/mp4")).toBe("video/mp4");
    expect(clipFileType("audio", "")).toBe("audio/webm");
    expect(clipFileType("audio", "video/webm")).toBe("audio/webm");
  });

  test("clip file names say what and when", () => {
    const at = new Date(2026, 8, 30, 14, 2, 7).getTime();
    expect(clipFileName("audio", "audio/webm", at)).toBe("Audio clip 2026-09-30 14.02.07.webm");
    expect(clipFileName("audio", "audio/mp4", at)).toBe("Audio clip 2026-09-30 14.02.07.m4a");
    expect(clipFileName("video", "video/mp4", at)).toBe("Video clip 2026-09-30 14.02.07.mp4");
  });

  test("permission failures are named for the device", () => {
    expect(describeClipError({ name: "NotAllowedError" }, "audio")).toContain("Microphone access was denied");
    expect(describeClipError({ name: "NotFoundError" }, "video")).toBe("No camera was found.");
    expect(describeClipError(new Error("boom"), "audio")).toBe("Could not start the microphone.");
  });

  test("recording needs both getUserMedia and MediaRecorder", () => {
    expect(canRecordClips({})).toBe(false);
    expect(canRecordClips({ navigator: { mediaDevices: { getUserMedia: () => {} } } })).toBe(false);
    expect(canRecordClips({ navigator: { mediaDevices: { getUserMedia: () => {} } }, MediaRecorder: function MediaRecorder() {} })).toBe(true);
  });
});

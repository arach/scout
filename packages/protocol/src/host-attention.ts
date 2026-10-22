import type { HostReadAvailability, ObservedSessionIdentity } from "./observed-sessions.js";
import type { TerminalSurfaceAddress } from "./terminal-surface-id.js";

/** Exact owning node and host location, never a native harness session id. */
export type TerminalHostRef = Omit<TerminalSurfaceAddress, "nodeId" | "backend" | "paneId"> & {
  nodeId: string;
  backend: "tmux" | "herdr";
  paneId?: string;
};
export type TmuxHostAttentionTarget = {
  ref: TerminalHostRef & { backend: "tmux" };
  harness: string;
  label: string;
  agentId?: string;
  /** Optional caller-supplied link, not inferred or verified from pane text. */
  nativeSession?: ObservedSessionIdentity;
};
export type HostAttentionPrompt = {
  title: string;
  summary: string;
  detail: string | null;
  promptVersion: string;
  /** Tmux rendered text has no native tool-use / permission request id. */
  promptIdentity: null;
};
export type TmuxHostAttentionObservation = {
  ref: TerminalHostRef & { backend: "tmux" };
  harness: string;
  label: string;
  agentId?: string;
  nativeSession?: ObservedSessionIdentity;
  observedAt: number;
  source: "tmux_pane";
  provenance: "inferred";
  detector: "claude_permission_dialog" | null;
  availability: HostReadAvailability;
  reason: "local_identity_unknown" | "nonlocal_ref" | "invalid_ref" | "unsupported_harness"
    | "capture_failed" | "capture_timeout" | "capture_truncated" | "capture_capacity" | null;
  coverage: { capturedBytes: number; maxBytes: number; truncated: boolean };
  prompt: HostAttentionPrompt | null;
};
export type TmuxHostAttentionRead = {
  schema: "scout.tmux-host-attention/v1";
  scope: "machine-local-operator";
  nodeId: string | null;
  observedAt: number;
  availability: HostReadAvailability;
  observations: TmuxHostAttentionObservation[];
  coverage: {
    kind: "provided_terminal_refs";
    requested: number;
    scanned: number;
    omitted: number;
    complete: boolean;
    maxCandidates: number;
    captureConcurrency: number;
    captureTimeoutMs: number;
    maxCaptureBytes: number;
  };
};

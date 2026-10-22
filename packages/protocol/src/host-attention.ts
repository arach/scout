import type { HerdrAgentSessionRef } from "./terminal-host-topology.js";
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
  /** Rendered text supplies no native tool-use / permission request id. */
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

/** Shared answer receipt; no result itself grants actuation authority. */
export type HostAttentionAnswerResult = {
  outcome: "answered" | "stale" | "gone" | "unverified" | "failed" | "refused";
  /** `sent` means the injected transport resolved, not a native harness acknowledgement. */
  effect: "not_sent" | "sent" | "unknown";
  /** Present only on busy: this pane’s hold age, or the oldest hold at global capacity. */
  heldForMs?: number;
  reason: "dialog_disappeared" | "prompt_changed" | "prompt_gone" | "dialog_still_present"
    | "different_dialog" | "capture_failed" | "capture_truncated" | "capture_timeout"
    | "send_failed" | "send_timeout" | "aborted" | "invalid_request" | "nonlocal_ref"
    | "local_identity_unknown" | "unsupported_options" | "busy" | "already_attempted" | "attempt_capacity"
    | "authority_refused" | "claimed_elsewhere" | "claim_unavailable" | "audit_failed" | "target_changed";
};
export type TmuxHostAttentionAnswer = HostAttentionAnswerResult;
export type HerdrHostAttentionAnswer = HostAttentionAnswerResult;

/** Supplied native topology evidence, never an authenticated Scout session. */
export type HerdrHostAttentionBinding = {
  ref: TerminalHostRef & { backend: "herdr"; paneId: string };
  terminalId: string;
  workspaceId: string;
  tabId: string;
  harness: string;
  nativeSession?: HerdrAgentSessionRef;
};
export type HerdrHostAttentionTarget = HerdrHostAttentionBinding & {
  label: string;
  agentId?: string;
};
export type HerdrHostAttentionObservation = HerdrHostAttentionTarget & {
  observedAt: number;
  source: "herdr_visible";
  provenance: "inferred";
  detector: "claude_permission_dialog" | null;
  availability: HostReadAvailability;
  reason: "local_identity_unknown" | "nonlocal_ref" | "invalid_ref" | "unsupported_harness"
    | "capture_failed" | "capture_timeout" | "capture_truncated" | "capture_capacity" | "aborted" | "target_changed" | null;
  coverage: { capturedBytes: number; maxBytes: number; truncated: boolean };
  prompt: HostAttentionPrompt | null;
};
export type HerdrHostAttentionRead = {
  schema: "scout.herdr-host-attention/v1";
  scope: "machine-local-operator";
  nodeId: string | null;
  observedAt: number;
  availability: HostReadAvailability;
  observations: HerdrHostAttentionObservation[];
  coverage: TmuxHostAttentionRead["coverage"];
};

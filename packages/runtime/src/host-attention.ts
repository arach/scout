/** Machine-local operator operations. No enumeration, capture or process work
 * happens on import. A rendered prompt is an observation, not answer authority. */
import { createHash } from "node:crypto";
import { CLAUDE_PERMISSION_DIALOG_LIMITS, claudePermissionAnswerKeys, detectClaudePermissionDialog, type ClaudePermissionDialog } from "./claude-permission-dialog.js";
import { formatTerminalSurfaceId } from "@openscout/protocol";
import type { TmuxHostAttentionAnswer, HostReadAvailability, TmuxHostAttentionObservation, TmuxHostAttentionRead, TmuxHostAttentionTarget } from "@openscout/protocol";

export const TMUX_HOST_ATTENTION_LIMITS = Object.freeze({
  maxCandidates: 24, captureConcurrency: 6, captureTimeoutMs: 2_000,
  ...CLAUDE_PERMISSION_DIALOG_LIMITS,
});
export type TmuxHostAttentionCapture = (
  ref: TmuxHostAttentionTarget["ref"],
  options: { signal: AbortSignal; maxBytes: number; target: Omit<TmuxHostAttentionTarget, "ref"> },
) => Promise<string | null | { body: string; truncated?: boolean }>;

export { detectClaudePermissionDialog, detectClaudePermissionDialog as detectClaudeTmuxHostAttention } from "./claude-permission-dialog.js";
export type { ClaudePermissionDialog, ClaudePermissionDialog as ClaudeTmuxAttentionDialog } from "./claude-permission-dialog.js";

/** Call only from a trusted same-machine operator context. A null local node
 * means identity is unavailable, not permission to capture another machine. */
export async function collectTmuxHostAttention(input: {
  nodeId: string | null;
  targets: readonly TmuxHostAttentionTarget[];
  capture: TmuxHostAttentionCapture;
  now?: number;
  limits?: { maxCandidates?: number; captureConcurrency?: number; captureTimeoutMs?: number };
}): Promise<TmuxHostAttentionRead> {
  const limits = TMUX_HOST_ATTENTION_LIMITS, now = input.now ?? Date.now();
  const nodeId = input.nodeId, capturePane = input.capture, requested = input.targets.length;
  const maxCandidates = ceiling(input.limits?.maxCandidates, limits.maxCandidates, 0);
  const concurrency = ceiling(input.limits?.captureConcurrency, limits.captureConcurrency, 1);
  const timeoutMs = ceiling(input.limits?.captureTimeoutMs, limits.captureTimeoutMs, 1);
  const targets = input.targets.slice(0, maxCandidates).map(target => ({
    ...target, ref: { ...target.ref }, nativeSession: target.nativeSession ? { ...target.nativeSession } : undefined,
  }));
  const rows: TmuxHostAttentionObservation[] = targets.map(target => ({
    ...target, label: typeof target.label === "string" ? clamp(target.label, limits.summaryChars) : "", ref: { ...target.ref }, nativeSession: target.nativeSession ? { ...target.nativeSession } : undefined,
    observedAt: now, source: "tmux_pane", provenance: "inferred", detector: target.harness === "claude" ? "claude_permission_dialog" : null, availability: "not_scanned",
    reason: "capture_capacity", coverage: { capturedBytes: 0, maxBytes: limits.maxCaptureBytes, truncated: false }, prompt: null,
  }));
  let next = 0, scanned = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
    while (next < targets.length) {
      const index = next++, target = targets[index]!, row = rows[index]!;
      if (!nodeId?.trim()) { row.availability = "unknown"; row.reason = "local_identity_unknown"; continue; }
      if (typeof target.label !== "string" || !validRef(target.ref) || (target.nativeSession && (target.nativeSession.nodeId !== target.ref.nodeId
        || target.nativeSession.harness !== target.harness || !validIdentity(target.nativeSession.nativeSessionId)))) {
        row.availability = "unknown"; row.reason = "invalid_ref"; continue;
      }
      if (target.ref.nodeId !== nodeId) { row.availability = "unavailable"; row.reason = "nonlocal_ref"; continue; }
      if (target.harness !== "claude") { row.availability = "unknown"; row.reason = "unsupported_harness"; continue; }
      scanned++;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = Symbol("timeout");
      try {
        const capture = Promise.resolve().then(() => capturePane({ ...target.ref }, {
          signal: controller.signal, maxBytes: limits.maxCaptureBytes,
          target: { harness: target.harness, label: target.label, agentId: target.agentId,
            nativeSession: target.nativeSession ? { ...target.nativeSession } : undefined },
        }));
        const result = await Promise.race([capture, new Promise<typeof timeout>(resolve => {
          timer = setTimeout(() => { controller.abort(); resolve(timeout); }, timeoutMs);
        })]);
        if (result === timeout) {
          row.availability = "unavailable"; row.reason = "capture_timeout";
          // An injected capture may ignore abort. Retire this slot rather than
          // fan out more work while its original operation is still pending.
          return;
        }
        if (result === null) { row.availability = "unavailable"; row.reason = "capture_failed"; continue; }
        const body = typeof result === "string" ? result : result.body;
        const bytes = Buffer.byteLength(body);
        row.coverage.capturedBytes = Math.min(bytes, limits.maxCaptureBytes);
        row.coverage.truncated = bytes > limits.maxCaptureBytes || (typeof result !== "string" && result.truncated === true);
        if (row.coverage.truncated) {
          row.availability = "partial"; row.reason = "capture_truncated";
          continue; // Incomplete text cannot bind a complete dialog version.
        }
        row.availability = "available"; row.reason = null;
        const dialog = detectClaudePermissionDialog(body);
        if (dialog) row.prompt = {
          title: dialog.title, summary: dialog.summary, detail: dialog.detail, promptIdentity: null,
          promptVersion: tmuxPromptVersion(target, dialog),
        };
      } catch { row.availability = "unavailable"; row.reason = "capture_failed"; }
      finally { if (timer !== undefined) clearTimeout(timer); }
    }
  }));
  const omitted = requested - targets.length;
  const complete = omitted === 0 && rows.every(row => row.availability === "available") && !!nodeId?.trim();
  let availability: HostReadAvailability = complete ? "available" : "unknown";
  if (complete) availability = "available";
  else if (!nodeId?.trim()) availability = "unknown";
  else if (!rows.length && omitted) availability = "not_scanned";
  else if (omitted || rows.some(row => row.availability === "available" || row.availability === "partial")) availability = complete ? "available" : "partial";
  else if (rows.every(row => row.availability === "unavailable")) availability = "unavailable";
  else if (rows.every(row => row.availability === "not_scanned")) availability = "not_scanned";
  return {
    schema: "scout.tmux-host-attention/v1", scope: "machine-local-operator", nodeId: nodeId, observedAt: now,
    availability, observations: rows, coverage: { kind: "provided_terminal_refs", requested,
      scanned, omitted, complete, maxCandidates, captureConcurrency: concurrency, captureTimeoutMs: timeoutMs, maxCaptureBytes: limits.maxCaptureBytes },
  };
}
function tmuxPromptVersion(target: TmuxHostAttentionTarget, dialog: ClaudePermissionDialog): string {
  return `sha256:${createHash("sha256").update(JSON.stringify([
    "claude-tmux-permission-v1", formatTerminalSurfaceId(target.ref),
    target.nativeSession ? [target.nativeSession.nodeId, target.nativeSession.harness, target.nativeSession.nativeSessionId] : null,
    null, dialog.content,
  ])).digest("hex")}`;
}

export const TMUX_HOST_ATTENTION_ANSWER_LIMITS = Object.freeze({
  captureTimeoutMs: 2_000, sendTimeoutMs: 2_000, verificationTimeoutMs: 2_000,
  verificationIntervalMs: 50, maxVerificationCaptures: 8, maxConcurrentAnswers: 6, maxAttempts: 256,
});
export type { TmuxHostAttentionAnswer, HerdrHostAttentionAnswer } from "@openscout/protocol";
export type TmuxHostAttentionAnswerInput = {
  target: TmuxHostAttentionTarget;
  promptVersion: string;
  option: "approve" | "deny";
  signal?: AbortSignal;
};
export type TmuxHostAttentionSendKeys = (
  ref: TmuxHostAttentionTarget["ref"], keys: readonly string[], options: { signal: AbortSignal },
) => Promise<void>;

/** One retained answerer per local operator/transport owner. It serializes a
 * pane and consumes each content version before a send attempt. These guards
 * are in-process only; external writers still require caller coordination.
 * Capture/send must honor abort or globally bound their own outstanding I/O.
 */
export function createTmuxHostAttentionAnswerer(deps: {
  nodeId: string | null;
  capture: TmuxHostAttentionCapture;
  sendKeys: TmuxHostAttentionSendKeys;
  limits?: { [K in Exclude<keyof typeof TMUX_HOST_ATTENTION_ANSWER_LIMITS, "verificationIntervalMs">]?: number };
}): (input: TmuxHostAttentionAnswerInput) => Promise<TmuxHostAttentionAnswer> {
  const { nodeId, capture, sendKeys } = deps;
  const hard = TMUX_HOST_ATTENTION_ANSWER_LIMITS;
  const limits = Object.fromEntries(Object.entries(hard).map(([key, value]) => [key,
    key === "verificationIntervalMs" ? value : ceiling(deps.limits?.[key as keyof NonNullable<typeof deps.limits>], value, 1),
  ])) as Record<keyof typeof hard, number>;
  const busy = new Map<string, number>(), attempted = new Set<string>();
  let active = 0;
  return async function answerTmuxHostAttention(input): Promise<TmuxHostAttentionAnswer> {
    const result = (outcome: TmuxHostAttentionAnswer["outcome"], reason: TmuxHostAttentionAnswer["reason"],
      effect: TmuxHostAttentionAnswer["effect"] = "not_sent"): TmuxHostAttentionAnswer => ({ outcome, reason, effect });
    if (!nodeId?.trim()) return result("refused", "local_identity_unknown");
    const supplied = input.target;
    if (!supplied || !supplied.ref || !validRef(supplied.ref) || !/^%\d+$/u.test(supplied.ref.paneId ?? "")
      || supplied.harness !== "claude" || !/^sha256:[a-f0-9]{64}$/u.test(input.promptVersion)
      || !["approve", "deny"].includes(input.option)
      || (supplied.nativeSession && (supplied.nativeSession.nodeId !== supplied.ref.nodeId
        || supplied.nativeSession.harness !== supplied.harness || !validIdentity(supplied.nativeSession.nativeSessionId)))) {
      return result("refused", "invalid_request");
    }
    const target = { ...supplied, ref: { ...supplied.ref }, nativeSession: supplied.nativeSession ? { ...supplied.nativeSession } : undefined };
    const expected = input.promptVersion, option = input.option, signal = input.signal;
    if (target.ref.nodeId !== nodeId) return result("refused", "nonlocal_ref");
    if (signal?.aborted) return result("failed", "aborted");
    const paneKey = JSON.stringify([nodeId, target.ref.paneId]);
    const attemptKey = JSON.stringify([formatTerminalSurfaceId(target.ref), expected]);
    if (busy.has(paneKey) || active >= limits.maxConcurrentAnswers) {
      const heldSince = busy.get(paneKey) ?? Math.min(...busy.values());
      return { ...result("refused", "busy"), heldForMs: Math.max(0, performance.now() - heldSince) };
    }
    if (attempted.has(attemptKey)) return result("refused", "already_attempted");
    if (attempted.size >= limits.maxAttempts) return result("refused", "attempt_capacity");
    busy.set(paneKey, performance.now()); active++;
    const pending = new Set<Promise<unknown>>();
    type Operation<T> = { state: "ok"; value: T } | { state: "failed" | "timeout" | "aborted" };
    async function bounded<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number): Promise<Operation<T>> {
      if (signal?.aborted) return { state: "aborted" };
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let abort = () => {};
      const stop = new Promise<Operation<T>>(resolve => {
        abort = () => { resolve({ state: "aborted" }); controller.abort(); };
        signal?.addEventListener("abort", abort, { once: true });
        timer = setTimeout(() => { resolve({ state: "timeout" }); controller.abort(); }, ms);
      });
      const task = Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new Error("aborted");
        return fn(controller.signal);
      });
      pending.add(task);
      void task.then(() => pending.delete(task), () => pending.delete(task));
      try { return await Promise.race([task.then(value => ({ state: "ok" as const, value }), () => ({ state: "failed" as const })), stop]); }
      finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
    }
    async function snapshot(ms: number): Promise<{ dialog: ClaudePermissionDialog | null } | { reason: TmuxHostAttentionAnswer["reason"] }> {
      const read = await bounded(s => capture({ ...target.ref }, { signal: s, maxBytes: TMUX_HOST_ATTENTION_LIMITS.maxCaptureBytes,
        target: { harness: target.harness, label: target.label, agentId: target.agentId,
          nativeSession: target.nativeSession ? { ...target.nativeSession } : undefined } }), ms);
      if (read.state !== "ok") return { reason: read.state === "timeout" ? "capture_timeout" : read.state === "aborted" ? "aborted" : "capture_failed" };
      const value = read.value;
      if (value === null || (typeof value !== "string" && typeof value !== "object")) return { reason: "capture_failed" };
      const body = typeof value === "string" ? value : value.body;
      if (typeof body !== "string") return { reason: "capture_failed" };
      if ((typeof value !== "string" && value.truncated) || Buffer.byteLength(body) > TMUX_HOST_ATTENTION_LIMITS.maxCaptureBytes) {
        return { reason: "capture_truncated" };
      }
      return { dialog: detectClaudePermissionDialog(body) };
    }
    try {
      const before = await snapshot(limits.captureTimeoutMs);
      if ("reason" in before) return result("failed", before.reason);
      if (signal?.aborted) return result("failed", "aborted");
      if (!before.dialog) return result("gone", "prompt_gone");
      if (tmuxPromptVersion(target, before.dialog) !== expected) return result("stale", "prompt_changed");
      const keys = claudePermissionAnswerKeys(before.dialog, option);
      if (!keys) return result("refused", "unsupported_options");
      if (attempted.size >= limits.maxAttempts) return result("refused", "attempt_capacity");
      // Consume before transport: a rejected/timed-out send may still have acted.
      attempted.add(attemptKey);
      const sent = await bounded(s => sendKeys({ ...target.ref }, keys, { signal: s }), limits.sendTimeoutMs);
      if (sent.state !== "ok") return result(sent.state === "failed" ? "failed" : "unverified",
        sent.state === "timeout" ? "send_timeout" : sent.state === "aborted" ? "aborted" : "send_failed", "unknown");
      const deadline = performance.now() + limits.verificationTimeoutMs;
      for (let i = 0; i < limits.maxVerificationCaptures; i++) {
        if (signal?.aborted) return result("unverified", "aborted", "sent");
        const remaining = deadline - performance.now();
        if (remaining <= 0) return result("unverified", "dialog_still_present", "sent");
        const after = await snapshot(Math.min(limits.captureTimeoutMs, remaining));
        if ("reason" in after) return result("unverified", after.reason, "sent");
        if (signal?.aborted) return result("unverified", "aborted", "sent");
        if (performance.now() > deadline) return result("unverified", "capture_timeout", "sent");
        if (!after.dialog) {
          // Observed disappearance ends this occurrence; identical content can recur.
          attempted.delete(attemptKey);
          return result("answered", "dialog_disappeared", "sent");
        }
        if (tmuxPromptVersion(target, after.dialog) !== expected) return result("unverified", "different_dialog", "sent");
        if (i + 1 < limits.maxVerificationCaptures) await new Promise(resolve => setTimeout(resolve,
          Math.min(limits.verificationIntervalMs, Math.max(0, deadline - performance.now()))));
      }
      return result("unverified", "dialog_still_present", "sent");
    } finally {
      const release = () => { busy.delete(paneKey); active--; };
      // A timeout does not free an occupied callback slot. Never overlap a
      // second send/capture while an abort-ignoring callback is still running.
      if (pending.size) void Promise.allSettled([...pending]).then(release);
      else release();
    }
  };
}
function validRef(ref: TmuxHostAttentionTarget["ref"]): boolean {
  return ref.backend === "tmux" && [ref.nodeId, ref.hostSession, ...(ref.paneId === undefined ? [] : [ref.paneId])]
    .every(validIdentity);
}
function validIdentity(value: string): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 1024 && value.trim() === value && !/[\x00-\x1f\x7f]/u.test(value);
}
function ceiling(value: number | undefined, maximum: number, minimum: number): number {
  return value !== undefined && Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, Math.floor(value))) : maximum;
}
function normalize(value: string): string { return value.replace(/\s+/gu, " ").trim(); }
function clamp(value: string, max: number): string {
  const text = normalize(value);
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export { collectHerdrHostAttention, HERDR_HOST_ATTENTION_LIMITS } from "./herdr-host-attention.js";
export type { HerdrHostAttentionCapture, HerdrHostAttentionCaptureEvidence } from "./herdr-host-attention.js";

export { createHerdrHostAttentionAnswerer, HERDR_HOST_ATTENTION_ANSWER_LIMITS } from "./herdr-host-attention-answer.js";
export type { HerdrHostAttentionAnswerInput, HerdrHostAttentionAttempt, HerdrHostAttentionClaim,
  HerdrHostAttentionAdmission, HerdrHostAttentionIntent, HerdrHostAttentionFinalization,
  HerdrHostAttentionAdmissionFailure, HerdrHostAttentionAnswerDependencies } from "./herdr-host-attention-answer.js";

export type { HerdrHostAttentionJournal, HerdrHostAttentionJournalClaim,
  HerdrHostAttentionJournalIntent, HerdrHostAttentionJournalAudit } from "./herdr-host-attention-journal.js";
export { herdrHostAttentionJournalConformanceCases } from "./herdr-host-attention-journal-conformance.js";
export type { HerdrHostAttentionJournalConformanceHarness, HerdrHostAttentionJournalConformanceFactory,
  HerdrHostAttentionJournalConformanceCase } from "./herdr-host-attention-journal-conformance.js";

/** Inactive injected primitive. This module supplies no native dispatch or claim store. */
import { randomUUID } from "node:crypto";
import type { HerdrHostAttentionAnswer, HerdrHostAttentionTarget } from "@openscout/protocol";
import { claudePermissionAnswerKeys } from "./claude-permission-dialog.js";
import { copyHerdrHostAttentionTarget, HERDR_HOST_ATTENTION_LIMITS, inspectHerdrHostAttentionCapture,
  isHerdrHostAttentionBinding, type HerdrHostAttentionCapture } from "./herdr-host-attention.js";

export const HERDR_HOST_ATTENTION_ANSWER_LIMITS = Object.freeze({
  preflightTimeoutMs: 2_000, captureTimeoutMs: 2_000, sendTimeoutMs: 2_000, verificationTimeoutMs: 2_000,
  finalizationTimeoutMs: 2_000, verificationIntervalMs: 50, maxVerificationCaptures: 8, maxConcurrentAnswers: 6, maxAttempts: 256,
});
export type HerdrHostAttentionAnswerInput = {
  target: HerdrHostAttentionTarget; promptVersion: string; option: "approve" | "deny"; signal?: AbortSignal;
};
export type HerdrHostAttentionAttempt = {
  attemptId: string; paneKey: string; attemptKey: string;
  target: HerdrHostAttentionTarget; promptVersion: string; option: "approve" | "deny"; keys: readonly string[];
};
/** Owner identity, not merely a string-key unlock. Every durable transition must
 * atomically compare BOTH fields against the current owner, including after await.
 */
export type HerdrHostAttentionClaim = { id: string; attemptId: string };
export type HerdrHostAttentionAdmissionFailure = "authority_refused" | "claimed_elsewhere" | "claim_unavailable" | "audit_failed";
export type HerdrHostAttentionAdmission =
  | { ok: true; claim: HerdrHostAttentionClaim }
  | { ok: false; reason: HerdrHostAttentionAdmissionFailure };
export type HerdrHostAttentionIntent = { ok: true } | { ok: false; reason: HerdrHostAttentionAdmissionFailure };
export type HerdrHostAttentionFinalization = {
  attempt: HerdrHostAttentionAttempt; claim: HerdrHostAttentionClaim; result: HerdrHostAttentionAnswer;
  disposition: "cancel_unsent" | "retain_unresolved" | "verified_answer";
};
export type HerdrHostAttentionAnswerDependencies = {
  nodeId: string | null;
  capture: HerdrHostAttentionCapture;
  /** Authenticate/recheck the operator or grant and prepare an exclusive claim.
   * Must reject a durable unresolved incident even after reconstruction/restart.
   */
  admit: (attempt: HerdrHostAttentionAttempt, options: { signal: AbortSignal }) => Promise<HerdrHostAttentionAdmission>;
  /** Durably record owned send intent AND the required audit row before resolving ok.
   * A timeout/rejection may already have written intent. Never auto-expire it.
   */
  writeSendIntent: (attempt: HerdrHostAttentionAttempt, claim: HerdrHostAttentionClaim, options: { signal: AbortSignal }) => Promise<HerdrHostAttentionIntent>;
  /** Exact-terminal dispatch only. Resolution is input acceptance, not an answer. */
  sendKeys: (target: HerdrHostAttentionTarget, keys: readonly string[], options: { signal: AbortSignal }) => Promise<void>;
  /** Owner-token CAS only; never delete the current claim by pane/key alone.
   * Preserve unresolved send effects, honor abort and reject late/unowned finalization.
   * Existing legacy writers must honor this same protocol before adoption.
   */
  finalize: (input: HerdrHostAttentionFinalization, options: { signal: AbortSignal }) => Promise<{ status: "settled" | "not_owner" | "unavailable" }>;
  limits?: { [K in Exclude<keyof typeof HERDR_HOST_ATTENTION_ANSWER_LIMITS, "verificationIntervalMs">]?: number };
};
/** One retained answerer per local owner. All callbacks are mandatory; no callback
 * default, authority, durable journal or native capability is supplied here.
 * Callbacks must honor abort or globally bound I/O; reconstruction is not recovery.
 */
export function createHerdrHostAttentionAnswerer(deps: HerdrHostAttentionAnswerDependencies):
  (input: HerdrHostAttentionAnswerInput) => Promise<HerdrHostAttentionAnswer> {
  const { nodeId, capture, admit, writeSendIntent, sendKeys, finalize } = deps;
  for (const callback of [capture, admit, writeSendIntent, sendKeys, finalize]) {
    if (typeof callback !== "function") throw new TypeError("Herdr answer callbacks are required; no defaults are available");
  }
  const hard = HERDR_HOST_ATTENTION_ANSWER_LIMITS;
  const limits = Object.fromEntries(Object.entries(hard).map(([key, value]) => [key,
    key === "verificationIntervalMs" ? value : ceiling(deps.limits?.[key as keyof NonNullable<typeof deps.limits>], value),
  ])) as Record<keyof typeof hard, number>;
  const busy = new Map<string, number>(), attempted = new Set<string>();
  return async function answerHerdrHostAttention(input) {
    if (!nodeId?.trim()) return receipt("refused", "local_identity_unknown");
    if (!input || !isHerdrHostAttentionBinding(input.target) || input.target.harness !== "claude"
      || typeof input.target.label !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(input.promptVersion)
      || !["approve", "deny"].includes(input.option)) return receipt("refused", "invalid_request");
    const target = copyHerdrHostAttentionTarget(input.target), expected = input.promptVersion, option = input.option, signal = input.signal;
    if (target.ref.nodeId !== nodeId) return receipt("refused", "nonlocal_ref");
    if (signal?.aborted) return receipt("failed", "aborted");
    const paneKey = JSON.stringify([nodeId, target.ref.hostSession, target.terminalId]);
    const attemptKey = JSON.stringify(["herdr-answer-attempt-v1", paneKey, expected]); // Decision deliberately excluded.
    if (busy.has(paneKey) || busy.size >= limits.maxConcurrentAnswers) return { ...receipt("refused", "busy"),
      heldForMs: Math.max(0, performance.now() - (busy.get(paneKey) ?? Math.min(...busy.values()))) };
    if (attempted.has(attemptKey)) return receipt("refused", "already_attempted");
    if (attempted.size >= limits.maxAttempts) return receipt("refused", "attempt_capacity");
    busy.set(paneKey, performance.now());
    const pending = new Set<Promise<unknown>>();
    let claim: HerdrHostAttentionClaim | null = null, attempt: HerdrHostAttentionAttempt | null = null, sendStarted = false;
    const deadline = performance.now() + limits.preflightTimeoutMs;
    type Operation<T> = { state: "ok"; value: T } | { state: "failed" | "timeout" | "aborted" };
    async function bounded<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number, observeCaller = true): Promise<Operation<T>> {
      if (observeCaller && signal?.aborted) return { state: "aborted" };
      if (ms <= 0) return { state: "timeout" };
      const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined; let abort = () => {};
      const stopped = new Promise<Operation<T>>(resolve => {
        abort = () => { resolve({ state: "aborted" }); controller.abort(); };
        if (observeCaller) signal?.addEventListener("abort", abort, { once: true });
        timer = setTimeout(() => { resolve({ state: "timeout" }); controller.abort(); }, ms);
      });
      const task = Promise.resolve().then(() => { controller.signal.throwIfAborted(); return fn(controller.signal); });
      pending.add(task); void task.then(() => pending.delete(task), () => pending.delete(task));
      try { return await Promise.race([task.then(value => ({ state: "ok" as const, value }), () => ({ state: "failed" as const })), stopped]); }
      finally { clearTimeout(timer); if (observeCaller) signal?.removeEventListener("abort", abort); }
    }
    async function read(ms: number) {
      const value = await bounded(s => capture(copyHerdrHostAttentionTarget(target), { signal: s, maxBytes: HERDR_HOST_ATTENTION_LIMITS.maxCaptureBytes }), Math.min(limits.captureTimeoutMs, ms));
      if (value.state !== "ok") return { reason: value.state === "timeout" ? "capture_timeout" as const : value.state === "aborted" ? "aborted" as const : "capture_failed" as const };
      return inspectHerdrHostAttentionCapture(target, value.value);
    }
    async function preflight() {
      const before = await read(deadline - performance.now());
      if (before.reason) return receipt(before.reason === "target_changed" ? "stale" : "failed", before.reason);
      if (signal?.aborted) return receipt("failed", "aborted");
      if (performance.now() > deadline) return receipt("failed", "capture_timeout");
      if (!("dialog" in before) || !before.dialog) return receipt("gone", "prompt_gone");
      if (before.promptVersion !== expected) return receipt("stale", "prompt_changed");
      const keys = claudePermissionAnswerKeys(before.dialog, option);
      if (!keys) return receipt("refused", "unsupported_options");
      return keys.map(key => key === "Escape" ? "esc" : key);
    }
    async function finish(result: HerdrHostAttentionAnswer): Promise<HerdrHostAttentionAnswer> {
      if (!claim || !attempt) return result;
      const input: HerdrHostAttentionFinalization = { attempt: structuredClone(attempt), claim: { ...claim }, result: { ...result },
        disposition: !sendStarted ? "cancel_unsent" : result.outcome === "answered" ? "verified_answer" : "retain_unresolved" };
      // Persist the ending even when the caller disconnected. Separate bounded signal.
      const ending = await bounded(s => finalize(input, { signal: s }), limits.finalizationTimeoutMs, false);
      if (input.disposition === "cancel_unsent") {
        if (ending.state === "ok" && ending.value?.status === "settled") attempted.delete(attemptKey);
        else attempted.add(attemptKey); // An unsettled cancellation still needs its durable backstop.
      } else if (result.outcome === "answered") {
        if (ending.state !== "ok" || ending.value?.status !== "settled") return receipt("unverified", "claim_unavailable", "sent");
        attempted.delete(attemptKey);
      }
      return result;
    }
    try {
      const first = await preflight();
      if (!Array.isArray(first)) return first;
      attempt = { attemptId: randomUUID(), paneKey, attemptKey, target: copyHerdrHostAttentionTarget(target), promptVersion: expected, option, keys: first };
      const admission = await bounded(s => admit(structuredClone(attempt!), { signal: s }), deadline - performance.now());
      if (admission.state !== "ok") return receipt("failed", admission.state === "aborted" ? "aborted" : "claim_unavailable");
      if (!admission.value || admission.value.ok !== true) return admissionFailure(admission.value);
      const owned = admission.value.claim;
      if (!owned || !identity(owned.id) || owned.attemptId !== attempt.attemptId) return receipt("failed", "claim_unavailable");
      claim = { id: owned.id, attemptId: owned.attemptId };
      const confirmed = await preflight();
      if (!Array.isArray(confirmed)) return await finish(confirmed);
      if (attempted.size >= limits.maxAttempts) return await finish(receipt("refused", "attempt_capacity"));
      // Intent may have persisted even if its callback later rejects/times out.
      attempted.add(attemptKey);
      const intent = await bounded(s => writeSendIntent(structuredClone(attempt!), { ...claim! }, { signal: s }), deadline - performance.now());
      if (intent.state !== "ok") return await finish(receipt("failed", intent.state === "aborted" ? "aborted" : "claim_unavailable"));
      if (!intent.value || intent.value.ok !== true) return await finish(admissionFailure(intent.value));
      const last = await preflight(); // Intent/audit can await: recapture once more before transport.
      if (!Array.isArray(last)) return await finish(last);
      const sent = await bounded(s => {
        const sendTarget = copyHerdrHostAttentionTarget(target), keys = [...attempt!.keys];
        sendStarted = true; // The transport boundary is invocation, not intent persistence or scheduling.
        return sendKeys(sendTarget, keys, { signal: s });
      }, limits.sendTimeoutMs);
      if (sent.state !== "ok") return await finish(receipt(sent.state === "failed" ? "failed" : "unverified",
        sent.state === "timeout" ? "send_timeout" : sent.state === "aborted" ? "aborted" : "send_failed", "unknown"));
      const verifyDeadline = performance.now() + limits.verificationTimeoutMs;
      for (let i = 0; i < limits.maxVerificationCaptures; i++) {
        const after = await read(verifyDeadline - performance.now());
        if (after.reason) return await finish(receipt("unverified", after.reason, "sent"));
        if (signal?.aborted) return await finish(receipt("unverified", "aborted", "sent"));
        if (performance.now() > verifyDeadline) return await finish(receipt("unverified", "capture_timeout", "sent"));
        if (!("dialog" in after) || !after.dialog) return await finish(receipt("answered", "dialog_disappeared", "sent"));
        if (after.promptVersion !== expected) return await finish(receipt("unverified", "different_dialog", "sent"));
        if (i + 1 < limits.maxVerificationCaptures) await new Promise(resolve => setTimeout(resolve,
          Math.min(limits.verificationIntervalMs, Math.max(0, verifyDeadline - performance.now()))));
      }
      return await finish(receipt("unverified", "dialog_still_present", "sent"));
    } finally {
      const release = () => { busy.delete(paneKey); };
      if (pending.size) void Promise.allSettled([...pending]).then(release); else release();
    }
  };
}
function receipt(outcome: HerdrHostAttentionAnswer["outcome"], reason: HerdrHostAttentionAnswer["reason"], effect: HerdrHostAttentionAnswer["effect"] = "not_sent"): HerdrHostAttentionAnswer { return { outcome, reason, effect }; }
function admissionFailure(value: unknown): HerdrHostAttentionAnswer {
  const reason = value && typeof value === "object" && "reason" in value ? value.reason : undefined;
  const allowed = ["authority_refused", "claimed_elsewhere", "claim_unavailable", "audit_failed"] as const;
  const named = allowed.find(candidate => candidate === reason) ?? "claim_unavailable";
  return receipt(named === "authority_refused" || named === "claimed_elsewhere" ? "refused" : "failed", named);
}
function identity(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 1024 && value.trim() === value && !/[\x00-\x1f\x7f]/u.test(value); }
function ceiling(value: number | undefined, maximum: number): number { return value !== undefined && Number.isFinite(value) ? Math.max(1, Math.min(maximum, Math.floor(value))) : maximum; }

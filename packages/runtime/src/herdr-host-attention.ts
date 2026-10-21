/** Injected local reads only. No default transport, host enumeration or actuation. */
import { createHash } from "node:crypto";
import type { HerdrHostAttentionBinding, HerdrHostAttentionObservation, HerdrHostAttentionRead, HerdrHostAttentionTarget } from "@openscout/protocol";
import { detectClaudeTmuxHostAttention } from "./host-attention.js";

export const HERDR_HOST_ATTENTION_LIMITS = Object.freeze({
  maxCandidates: 24, captureConcurrency: 6, captureTimeoutMs: 2_000,
  maxCaptureBytes: 48 * 1024, summaryChars: 200,
});
/** The adapter must make uncached live binding reads before and after a complete
 * visible capture. These are adapter claims, not cryptographic identity proof.
 * Do not wrap a cached digest, saved layout or text-only legacy capture here.
 */
export type HerdrHostAttentionCaptureEvidence = {
  source: "herdr_visible";
  freshness: "live";
  before: HerdrHostAttentionBinding;
  after: HerdrHostAttentionBinding;
  body: string;
  truncated: boolean;
};
export type HerdrHostAttentionCapture = (
  target: HerdrHostAttentionTarget, options: { signal: AbortSignal; maxBytes: number },
) => Promise<HerdrHostAttentionCaptureEvidence | null>;

/** One bounded observation of provided refs, not a fleet scan or answer authority.
 * Capture must honor abort or bound its I/O globally. Do not overlap collections
 * while an earlier collection's abort-ignoring callbacks remain pending.
 */
export async function collectHerdrHostAttention(input: {
  nodeId: string | null;
  targets: readonly HerdrHostAttentionTarget[];
  capture: HerdrHostAttentionCapture;
  signal?: AbortSignal;
  now?: number;
  limits?: { maxCandidates?: number; captureConcurrency?: number; captureTimeoutMs?: number };
}): Promise<HerdrHostAttentionRead> {
  const hard = HERDR_HOST_ATTENTION_LIMITS;
  const nodeId = input.nodeId, signal = input.signal, capture = input.capture, observedAt = input.now ?? Date.now();
  const requested = input.targets.length;
  const maxCandidates = ceiling(input.limits?.maxCandidates, hard.maxCandidates, 0);
  const concurrency = ceiling(input.limits?.captureConcurrency, hard.captureConcurrency, 1);
  const timeoutMs = ceiling(input.limits?.captureTimeoutMs, hard.captureTimeoutMs, 1);
  const targets = input.targets.slice(0, maxCandidates).map(copyTarget);
  const rows: HerdrHostAttentionObservation[] = targets.map(target => ({
    ...copyTarget(target), label: target.label.slice(0, hard.summaryChars), observedAt,
    source: "herdr_visible", provenance: "inferred", detector: target.harness === "claude" ? "claude_permission_dialog" : null,
    availability: "not_scanned", reason: "capture_capacity",
    coverage: { capturedBytes: 0, maxBytes: hard.maxCaptureBytes, truncated: false }, prompt: null,
  }));
  let next = 0, scanned = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
    while (next < targets.length) {
      const index = next++, target = targets[index]!, row = rows[index]!;
      if (!nodeId?.trim()) { row.availability = "unknown"; row.reason = "local_identity_unknown"; continue; }
      if (!validBinding(target)) { row.availability = "unknown"; row.reason = "invalid_ref"; continue; }
      if (target.ref.nodeId !== nodeId) { row.availability = "unavailable"; row.reason = "nonlocal_ref"; continue; }
      if (target.harness !== "claude") { row.availability = "unknown"; row.reason = "unsupported_harness"; continue; }
      if (signal?.aborted) { row.availability = "unavailable"; row.reason = "aborted"; continue; }
      scanned++;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let abort = () => {};
      const timeout = Symbol("timeout"), cancelled = Symbol("cancelled");
      const stopped = new Promise<typeof timeout | typeof cancelled>(resolve => {
        abort = () => { resolve(cancelled); controller.abort(); };
        signal?.addEventListener("abort", abort, { once: true });
        timer = setTimeout(() => { resolve(timeout); controller.abort(); }, timeoutMs);
      });
      try {
        const task = Promise.resolve().then(() => {
          controller.signal.throwIfAborted();
          return capture(copyTarget(target), { signal: controller.signal, maxBytes: hard.maxCaptureBytes });
        });
        const value: unknown = await Promise.race([task, stopped]);
        if (value === timeout || value === cancelled || signal?.aborted) {
          row.availability = "unavailable"; row.reason = value === timeout ? "capture_timeout" : "aborted";
          return; // Retire this worker: its callback may still be running.
        }
        if (!record(value) || value.source !== "herdr_visible" || value.freshness !== "live"
          || typeof value.body !== "string" || typeof value.truncated !== "boolean"
          || !validBinding(value.before) || !validBinding(value.after)) {
          row.availability = "unavailable"; row.reason = "capture_failed"; continue;
        }
        if (bindingKey(value.before) !== bindingKey(target) || bindingKey(value.after) !== bindingKey(target)) {
          row.availability = "unavailable"; row.reason = "target_changed"; continue;
        }
        const bytes = Buffer.byteLength(value.body);
        row.coverage.capturedBytes = Math.min(bytes, hard.maxCaptureBytes);
        row.coverage.truncated = value.truncated || bytes > hard.maxCaptureBytes;
        if (row.coverage.truncated) { row.availability = "partial"; row.reason = "capture_truncated"; continue; }
        row.availability = "available"; row.reason = null;
        const dialog = detectClaudeTmuxHostAttention(value.body);
        if (dialog) row.prompt = {
          title: dialog.title, summary: dialog.summary, detail: dialog.detail, promptIdentity: null,
          promptVersion: `sha256:${createHash("sha256").update(JSON.stringify([
            "claude-herdr-permission-v1", bindingKey(target), null, dialog.content,
          ])).digest("hex")}`,
        };
      } catch { row.availability = "unavailable"; row.reason = signal?.aborted ? "aborted" : "capture_failed"; }
      finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
    }
  }));
  const omitted = requested - targets.length;
  const complete = omitted === 0 && !!nodeId?.trim() && rows.every(row => row.availability === "available");
  const availability = complete ? "available" : !nodeId?.trim() ? "unknown"
    : omitted || rows.some(row => row.availability === "available" || row.availability === "partial") ? rows.length ? "partial" : "not_scanned"
      : rows.every(row => row.availability === "unavailable") ? "unavailable"
        : rows.every(row => row.availability === "not_scanned") ? "not_scanned" : "unknown";
  return { schema: "scout.herdr-host-attention/v1", scope: "machine-local-operator", nodeId, observedAt,
    availability, observations: rows, coverage: { kind: "provided_terminal_refs", requested, scanned, omitted, complete,
      maxCandidates, captureConcurrency: concurrency, captureTimeoutMs: timeoutMs, maxCaptureBytes: hard.maxCaptureBytes } };
}
function copyTarget(target: HerdrHostAttentionTarget): HerdrHostAttentionTarget {
  return { ...target, ref: { ...target.ref }, nativeSession: target.nativeSession ? { ...target.nativeSession } : undefined };
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function identity(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1024 && value.trim() === value && !/[\x00-\x1f\x7f]/u.test(value);
}
function validBinding(value: unknown): value is HerdrHostAttentionBinding {
  if (!record(value) || !record(value.ref) || value.ref.backend !== "herdr"
    || ![value.ref.nodeId, value.ref.hostSession, value.ref.paneId, value.terminalId, value.workspaceId, value.tabId, value.harness].every(identity)) return false;
  const native = value.nativeSession;
  return native === undefined || (record(native) && native.agent === value.harness
    && [native.kind, native.source, native.value].every(identity));
}
function bindingKey(binding: HerdrHostAttentionBinding): string {
  return JSON.stringify([binding.ref.nodeId, binding.ref.backend, binding.ref.hostSession, binding.ref.paneId,
    binding.terminalId, binding.workspaceId, binding.tabId, binding.harness,
    binding.nativeSession ? [binding.nativeSession.agent, binding.nativeSession.kind, binding.nativeSession.source, binding.nativeSession.value] : null]);
}
function ceiling(value: number | undefined, maximum: number, minimum: number): number {
  return value !== undefined && Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, Math.floor(value))) : maximum;
}

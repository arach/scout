/** Machine-local operator reads only. No enumeration, capture or process work
 * happens on import. A rendered prompt is an observation, not answer authority. */
import { createHash } from "node:crypto";
import { formatTerminalSurfaceId } from "@openscout/protocol";
import type { HostReadAvailability, TmuxHostAttentionObservation, TmuxHostAttentionRead, TmuxHostAttentionTarget } from "@openscout/protocol";

export const TMUX_HOST_ATTENTION_LIMITS = Object.freeze({
  maxCandidates: 24, captureConcurrency: 6, captureTimeoutMs: 2_000,
  maxCaptureBytes: 48 * 1024, summaryChars: 200, detailChars: 500,
});
export type TmuxHostAttentionCapture = (
  ref: TmuxHostAttentionTarget["ref"],
  options: { signal: AbortSignal; maxBytes: number; target: Omit<TmuxHostAttentionTarget, "ref"> },
) => Promise<string | null | { body: string; truncated?: boolean }>;

/** Unclamped normalized fields bind the content version, not just its preview. */
export type ClaudeTmuxAttentionDialog = {
  title: string;
  summary: string;
  detail: string | null;
  content: { dialog: string; header: string | null; command: string | null; permissionRule: string; question: string; options: string[]; footer: string };
};
const CLAUDE_CONFIRMATION_FOOTER = /\bEsc to cancel\b.*\bTab to amend\b/i;
const CLAUDE_PERMISSION_RULE = /\bPermission\s+rule\s+(.+?)\s+requires confirmation for this command\./i;
const CLAUDE_PROCEED_QUESTION = /\bDo you want to proceed\?/i;
const CLAUDE_POST_PROMPT_ACTIVITY = /(?:^|\n)\s*(?:⏺|●)\s+(?:Bash|Edit|Glob|Grep|Read|Search|Task|Update|WebFetch|WebSearch|Write)\b/imu;
const CLAUDE_READY_COMPOSER = /^\s*(?:[❯›]\s*|[│┃]\s*[>❯]\s*)/mu;
const ANSI_CSI = /\x1B\[[0-?]*[ -/]*[@-~]/gu;
const ANSI_OSC = /\x1B\][^\x07]*(?:\x07|\x1B\\)/gu;

/** Pure detection over bounded pane text; no host or native session is invented. */
export function detectClaudeTmuxHostAttention(paneBody: string): ClaudeTmuxAttentionDialog | null {
  if (Buffer.byteLength(paneBody) > TMUX_HOST_ATTENTION_LIMITS.maxCaptureBytes) return null;
  const lines = paneBody.replace(ANSI_OSC, "").replace(ANSI_CSI, "").replaceAll("\r", "").split("\n");
  const lastContentIndex = findLastIndex(lines, line => line.trim().length > 0);
  if (lastContentIndex < 0) return null;
  const footerIndex = findLastIndex(lines, line => CLAUDE_CONFIRMATION_FOOTER.test(line));
  if (footerIndex < 0) return null;
  const after = lines.slice(footerIndex + 1, lastContentIndex + 1).join("\n");
  if (CLAUDE_POST_PROMPT_ACTIVITY.test(after) || CLAUDE_READY_COMPOSER.test(after)) return null;
  const questionIndex = findLastIndex(lines, (line, i) => i < footerIndex && CLAUDE_PROCEED_QUESTION.test(line));
  if (questionIndex < 0 || footerIndex - questionIndex > 12) return null;
  const permissionIndex = findLastIndex(lines, (line, i) => i < questionIndex && CLAUDE_PERMISSION_RULE.test(line));
  if (permissionIndex < 0 || questionIndex - permissionIndex > 8) return null;
  const permission = lines[permissionIndex]?.match(CLAUDE_PERMISSION_RULE)?.[1]?.trim();
  if (!permission) return null;
  const foundHeader = findLastIndex(lines, (line, i) => i < permissionIndex && /^\s*(?:Bash command|Edit file|Write file)\s*$/i.test(line));
  const headerIndex = foundHeader >= 0 && permissionIndex - foundHeader <= 12 ? foundHeader : -1;
  const commandLines = headerIndex < 0 ? [] : lines.slice(headerIndex + 1, permissionIndex);
  const detail = commandLines.map(line => line.trim()).find(Boolean);
  return {
    title: "Claude needs permission",
    summary: clamp(`Permission rule ${permission} requires confirmation.`, TMUX_HOST_ATTENTION_LIMITS.summaryChars),
    detail: detail ? clamp(detail, TMUX_HOST_ATTENTION_LIMITS.detailChars) : null,
    content: {
      dialog: normalize(lines.slice(headerIndex < 0 ? permissionIndex : headerIndex, footerIndex + 1).map(stripOptionCursor).join("\n")),
      header: headerIndex < 0 ? null : normalize(lines[headerIndex]!),
      command: commandLines.length ? normalize(commandLines.join("\n")) : null,
      permissionRule: normalize(permission), question: normalize(lines[questionIndex]!),
      options: lines.slice(questionIndex + 1, footerIndex).map(line => normalize(stripOptionCursor(line))).filter(Boolean),
      footer: normalize(lines[footerIndex]!),
    },
  };
}

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
    ...target, label: clamp(target.label, limits.summaryChars), ref: { ...target.ref }, nativeSession: target.nativeSession ? { ...target.nativeSession } : undefined,
    observedAt: now, source: "tmux_pane", provenance: "inferred", detector: target.harness === "claude" ? "claude_permission_dialog" : null, availability: "not_scanned",
    reason: "capture_capacity", coverage: { capturedBytes: 0, maxBytes: limits.maxCaptureBytes, truncated: false }, prompt: null,
  }));
  let next = 0, scanned = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
    while (next < targets.length) {
      const index = next++, target = targets[index]!, row = rows[index]!;
      if (!nodeId?.trim()) { row.availability = "unknown"; row.reason = "local_identity_unknown"; continue; }
      if (!validRef(target.ref) || (target.nativeSession && (target.nativeSession.nodeId !== target.ref.nodeId
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
        const dialog = detectClaudeTmuxHostAttention(body);
        if (dialog) row.prompt = {
          title: dialog.title, summary: dialog.summary, detail: dialog.detail, promptIdentity: null,
          promptVersion: `sha256:${createHash("sha256").update(JSON.stringify([
            "claude-tmux-permission-v1", formatTerminalSurfaceId(target.ref),
            target.nativeSession ? [target.nativeSession.nodeId, target.nativeSession.harness, target.nativeSession.nativeSessionId] : null,
            null, dialog.content,
          ])).digest("hex")}`,
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
function stripOptionCursor(line: string): string { return line.replace(/^\s*[❯›>]\s*(?=\d+\.)/u, ""); }
function normalize(value: string): string { return value.replace(/\s+/gu, " ").trim(); }
function clamp(value: string, max: number): string {
  const text = normalize(value);
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
function findLastIndex(values: readonly string[], predicate: (value: string, index: number) => boolean): number {
  for (let index = values.length - 1; index >= 0; index--) if (predicate(values[index]!, index)) return index;
  return -1;
}

import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { createHistorySessionSnapshot } from "@openscout/agent-sessions";
import type { SessionState, HistorySessionEvent } from "@openscout/agent-sessions";
import type { ObservedSessionMaterials, ObservedSessionMaterialFile, ObservedSessionIdentity } from "@openscout/protocol";
import { getCachedTailDiscovery } from "./tail/index.js";
import { buildObservedSessionInventory, selectObservedSession, observedHarness, ObservedSessionReadError, type ObservedSessionReadDeps } from "./broker-observed-sessions-read.js";

export const SESSION_MATERIAL_MAX_BYTES = 2 * 1024 * 1024;
export const SESSION_MATERIAL_MAX_LINES = 10_000;
const MAX_FILES = 500;
class MaterialReadError extends Error {
  constructor(public code: string, public status = 503) { super(code); }
}

/** Open only a cached transcript; callers cannot supply filesystem paths. */
async function readBoundedTranscript(path: string): Promise<{ content: string; bytes: number }> {
  const fd = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const before = await fd.stat();
    if (!before.isFile()) throw new MaterialReadError("session_materials_source_unavailable");
    if (before.size > SESSION_MATERIAL_MAX_BYTES) throw new MaterialReadError("session_materials_byte_budget", 413);
    const buffer = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await fd.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await fd.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || length !== before.size) throw new MaterialReadError("session_materials_changed_during_read");
    return { content: new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length)), bytes: length };
  } finally { await fd.close(); }
}

function verifyNativeIdentity(content: string, identity: ObservedSessionIdentity): number {
  let lines = 0;
  const ids = new Set<string>();
  const worktrees = new Set<string>();
  // The public parsers project actions. These envelope fields verify which
  // native transcript was opened; never overwrite a mismatched id with input.
  for (const line of content.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    if (++lines > SESSION_MATERIAL_MAX_LINES) throw new MaterialReadError("session_materials_line_budget", 413);
    const record = JSON.parse(line) as Record<string, unknown>;
    if (!record || typeof record !== "object" || Array.isArray(record)) throw new MaterialReadError("session_materials_invalid_history");
    let id: unknown;
    if (identity.harness === "claude") id = record.session_id ?? record.sessionId;
    if (identity.harness === "codex" && record.type === "session_meta") id = (record.payload as Record<string, unknown> | undefined)?.id;
    if (identity.harness === "pi" && record.type === "session") id = record.id;
    const context = identity.harness === "codex" && ["session_meta", "turn_context"].includes(String(record.type)) ? record.payload as Record<string, unknown> | undefined : record;
    if (typeof context?.cwd === "string" && isAbsolute(context.cwd)) worktrees.add(resolve(context.cwd));
    if (worktrees.size > 1) throw new MaterialReadError("session_materials_multiple_worktrees");
    if (typeof id === "string") {
      if (id.length > 1024) throw new MaterialReadError("session_materials_identity_unverified");
      ids.add(id);
      if (ids.size > 1) throw new MaterialReadError("session_materials_identity_mismatch", 409);
    }
  }
  if (ids.size !== 1) throw new MaterialReadError("session_materials_identity_unverified");
  if (!ids.has(identity.nativeSessionId)) throw new MaterialReadError("session_materials_identity_mismatch", 409);
  return lines;
}

function projectFiles(snapshot: SessionState, cwd: string, events: HistorySessionEvent[]) {
  const files = new Map<string, ObservedSessionMaterialFile>();
  let excluded = 0, pending = 0, failed = 0, blocks = 0;
  const times = new Map<string, number>();
  for (const entry of events) if (entry.event.event === "block:start" && Number.isFinite(entry.capturedAt)) times.set(entry.event.block.id, entry.capturedAt);
  for (const turn of snapshot.turns) for (const { block } of turn.blocks) {
    if (++blocks > 20_000) throw new MaterialReadError("session_materials_block_budget", 413);
    if (block.type !== "action") continue;
    const action = block.action;
    let path: unknown, state: ObservedSessionMaterialFile["state"] | undefined;
    if (action.kind === "file_change") { path = action.path; state = "modified"; }
    if (action.kind === "tool_call") {
      const input = action.input as Record<string, unknown> | undefined;
      path = input?.file_path ?? input?.path;
      const tool = action.toolName.toLowerCase();
      if (["read", "view", "grep", "glob", "search"].includes(tool)) state = "read";
      if (["edit", "multiedit"].includes(tool)) state = "modified";
      if (tool === "write") state = "modified"; // A write does not prove creation.
    }
    if (!state || typeof path !== "string" || !path) continue;
    if (action.status !== "completed") { if (action.status === "failed") failed++; else pending++; continue; }
    if (path.length > 4096 || /[\x00-\x1f]/u.test(path)) throw new MaterialReadError("session_materials_invalid_path");
    const scoped = relative(cwd, resolve(cwd, path));
    if (!scoped || scoped === ".." || scoped.startsWith(`..${sep}`) || isAbsolute(scoped)) { excluded++; continue; }
    const prior = files.get(scoped);
    const rank = { read: 1, modified: 2 };
    const touchedAt = times.get(block.id) ?? null;
    if (prior) {
      prior.touches++;
      if (rank[state] > rank[prior.state]) prior.state = state;
      if (touchedAt !== null) prior.lastTouchedAt = Math.max(prior.lastTouchedAt ?? 0, touchedAt);
    } else {
      if (files.size >= MAX_FILES) throw new MaterialReadError("session_materials_file_budget", 413);
      files.set(scoped, { path: scoped, state, touches: 1, lastTouchedAt: touchedAt });
    }
  }
  return { files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)), excluded, pending, failed };
}

/** One history parser at a time; no queues of large snapshots on a tight host. */
export function createSessionMaterialsRead(deps: ObservedSessionReadDeps) {
  let active = false;
  return async (url: URL): Promise<{ status: number; body: unknown }> => {
    if (active) return { status: 503, body: { error: "session_materials_busy", retryable: true } };
    active = true;
    try {
      for (const key of url.searchParams.keys()) if (!["nodeId", "harness", "nativeSessionId", "ref"].includes(key) || url.searchParams.getAll(key).length !== 1) throw new ObservedSessionReadError(400, "invalid_session_query");
      const cached = (deps.readCache ?? getCachedTailDiscovery)();
      const inventory = buildObservedSessionInventory({ ...deps, readCache: () => cached }, 2_000);
      const row = selectObservedSession(inventory, url);
      const adapterType = row.identity.harness === "claude" ? "claude-code" : row.identity.harness;
      if (!["claude-code", "codex", "pi"].includes(adapterType)) throw new MaterialReadError("session_materials_unsupported_harness", 501);
      const transcripts = cached.transcripts.slice(0, 2_000).filter(transcript => observedHarness(transcript.source) === row.identity.harness && transcript.sessionId === row.identity.nativeSessionId);
      const paths = [...new Set(transcripts.map(transcript => transcript.transcriptPath))];
      if (paths.length !== 1) throw new MaterialReadError("session_materials_identity_unverified", 409);
      const { content, bytes } = await readBoundedTranscript(paths[0]);
      const lines = verifyNativeIdentity(content, row.identity);
      const parsed = createHistorySessionSnapshot({ path: paths[0], content, adapterType, cwd: row.cwd, sessionId: row.identity.nativeSessionId });
      if (!parsed.parsedLineCount) throw new MaterialReadError("session_materials_invalid_history");
      const cwd = parsed.snapshot.session.cwd ?? row.cwd;
      if (!cwd || !isAbsolute(cwd)) throw new MaterialReadError("session_materials_worktree_unavailable");
      const worktreePath = resolve(cwd);
      const projected = projectFiles(parsed.snapshot, worktreePath, parsed.events);
      const changedFiles = projected.files.filter(file => file.state !== "read").length;
      const body: ObservedSessionMaterials = { schema: "scout.session-materials/v1", identity: row.identity, links: row.links, source: "history", worktreePath,
        files: projected.files, counts: { files: projected.files.length, changedFiles, readFiles: projected.files.length - changedFiles },
        coverage: { kind: "observed_tool_paths", bytes, lines, maxBytes: SESSION_MATERIAL_MAX_BYTES, maxLines: SESSION_MATERIAL_MAX_LINES,
          excludedOutsideWorktree: projected.excluded, pendingActions: projected.pending, failedActions: projected.failed, skippedRecords: parsed.skippedLineCount, complete: projected.pending === 0 && projected.failed === 0 && parsed.skippedLineCount === 0 } };
      return { status: 200, body };
    } catch (error) {
      if (error instanceof ObservedSessionReadError) return { status: error.status, body: { error: error.code, ...(error.candidates.length ? { candidates: error.candidates, candidatesTruncated: error.candidatesTruncated } : {}) } };
      return error instanceof MaterialReadError ? { status: error.status, body: { error: error.code } } : { status: 503, body: { error: "session_materials_source_unavailable" } };
    } finally { active = false; }
  };
}

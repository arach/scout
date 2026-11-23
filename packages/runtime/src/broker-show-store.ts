import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { SHOW_LIMITS, type ScoutShow } from "@openscout/protocol";
import { execSystemFile } from "./system-probes/exec.js";

export class ShowError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
// Check both lexical and resolved paths: a harmless symlink must not launder a secret.
export function assertShowPath(path: string): void {
  const parts = resolve(path).toLowerCase().split(/[\\/]/);
  if (parts.some(p => /^(\.env[^/]*|\.git|\.ssh|\.gnupg|\.aws|\.azure|\.kube|\.config|\.codex|\.claude|\.kimi-code|\.openscout|\.scout|keys?|keychains?|\.credentials|\.secrets|\.docker|credentials?|secrets?|sessions|transcripts|\.local|\.opencode|\.pi|\.grok|node_modules)$/.test(p))
    || /(?:^|[._-])(?:credentials?|secrets?|tokens?)(?:[._-]|$)/i.test(basename(path))
    || /\.(?:pem|key|p12|pfx|keystore)$/i.test(path)
    || /^(?:id_rsa|id_ed25519|id_dsa|id_ecdsa|authorized_keys|known_hosts|\.npmrc|\.netrc|\.pypirc)$/i.test(basename(path))) {
    throw new ShowError("show_path_forbidden", 403);
  }
}
async function git(cwd: string, args: string[]): Promise<string> {
  try { return (await execSystemFile("git", args, { cwd, timeoutMs: 2000 })).stdout.trim(); }
  catch { return ""; }
}
/** The caller's checkout: linked worktrees join their main project root. */
export async function resolveShowWorkspace(currentDirectory: string): Promise<{ cwd: string; worktree: string; projectRoot: string; branch?: string }> {
  const cwd = await realpath(currentDirectory);
  const worktree = await git(cwd, ["rev-parse", "--show-toplevel"]) || cwd;
  const common = await git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const projectRoot = common ? await realpath(dirname(common)) : worktree;
  return { cwd, worktree, projectRoot, branch: await git(cwd, ["symbolic-ref", "--short", "HEAD"]) || undefined };
}
type ShowInput = { path: string; currentDirectory: string; agentId: string; sessionId?: string; harness?: string; caption?: string; requestId?: string };
export class BrokerShowStore {
  private busy = false;
  private listeners = new Set<(record: ScoutShow) => void>();
  constructor(readonly directory: string, readonly nodeId: string, readonly limits: { fileBytes: number; storeBytes: number; records: number } = SHOW_LIMITS) {}
  subscribe(listener: (record: ScoutShow) => void): () => void {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  private async records(): Promise<ScoutShow[]> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const files = await readdir(this.directory);
    const records: ScoutShow[] = [];
    for (const file of files.filter(f => /^[a-f0-9-]+\.json$/.test(f))) {
      try { records.push(JSON.parse(await readFile(join(this.directory, file), "utf8")) as ScoutShow); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    return records.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }
  async list(projectRoot: string, since = 0): Promise<ScoutShow[]> {
    const root = await realpath(projectRoot);
    return (await this.records()).filter(r => r.projectRoot === root && r.createdAt > since);
  }
  /** Every project's shows after `since`, oldest first. */
  async listAll(since = 0): Promise<ScoutShow[]> {
    return (await this.records()).filter(r => r.createdAt > since);
  }
  async get(id: string): Promise<ScoutShow> {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new ShowError("show_not_found", 404);
    try { return JSON.parse(await readFile(join(this.directory, `${id}.json`), "utf8")); }
    catch { throw new ShowError("show_not_found", 404); }
  }
  blobPath(id: string): string { return join(this.directory, `${id}.blob`); }
  async show(input: ShowInput): Promise<ScoutShow> {
    return (await this.showRequest(input)).show;
  }
  /**
   * `replayed` is true when the caller's `requestId` already made a show: that
   * show is returned and nothing is copied. The same request id with another
   * path or caption is refused, so a retry cannot quietly change content.
   */
  showRequest(input: ShowInput): Promise<{ show: ScoutShow; replayed: boolean }> {
    if (this.busy) return Promise.reject(new ShowError("show_busy_retry", 409));
    this.busy = true;
    return this.commit(input).finally(() => { this.busy = false; });
  }
  private async commit(input: ShowInput): Promise<{ show: ScoutShow; replayed: boolean }> {
    if (input.caption && input.caption.length > SHOW_LIMITS.captionCharacters) throw new ShowError("show_caption_too_long");
    if (input.requestId !== undefined && (!input.requestId.trim() || input.requestId.length > SHOW_LIMITS.requestIdCharacters)) throw new ShowError("invalid_show_request_id");
    const lexical = resolve(input.currentDirectory, input.path);
    assertShowPath(lexical);
    const sourcePath = await realpath(lexical);
    assertShowPath(sourcePath);
    const { worktree, projectRoot, branch } = await resolveShowWorkspace(input.currentDirectory);
    // Only files in the caller's workspace; arbitrary host file disclosure is not this verb.
    const rel = relative(worktree, sourcePath);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new ShowError("show_outside_worktree", 403);
    const records = await this.records();
    // A request id is scoped to the agent that sent it. An evicted show is gone,
    // so a retry after its eviction makes a new version.
    const earlier = input.requestId === undefined ? undefined : records.find(r => r.requestId === input.requestId && r.agentId === input.agentId);
    if (earlier) {
      if (earlier.sourcePath !== sourcePath || earlier.caption !== input.caption) throw new ShowError("show_request_id_reused_with_other_content", 409);
      return { show: earlier, replayed: true };
    }
    // Recover uncommitted files from interrupted writes. Only this serialized writer owns the directory.
    const live = new Set(records.flatMap(r => [`${r.id}.json`, `${r.id}.blob`]));
    for (const file of await readdir(this.directory)) if (!live.has(file)) await rm(join(this.directory, file), { force: true });
    const id = randomUUID();
    const temporary = join(this.directory, `${id}.tmp`);
    const handle = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let byteSize = 0;
    const hash = createHash("sha256");
    try {
      const before = await handle.stat();
      if (!before.isFile()) throw new ShowError("show_requires_regular_file");
      if (before.nlink > 1) throw new ShowError("show_hardlink_forbidden", 403);
      if (before.size > this.limits.fileBytes) throw new ShowError("show_file_too_large", 413);
      const output = await open(temporary, "wx", 0o600);
      try {
        const buffer = Buffer.alloc(1024 * 1024);
        while (true) {
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
          if (!bytesRead) break;
          byteSize += bytesRead;
          if (byteSize > this.limits.fileBytes) throw new ShowError("show_file_too_large", 413);
          const chunk = buffer.subarray(0, bytesRead); hash.update(chunk);
          await output.writeFile(chunk);
        }
        await output.sync();
      } finally { await output.close(); }
      assertShowPath(await realpath(lexical));
      const after = await handle.stat();
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new ShowError("show_source_changed_retry", 409);
      const itemId = createHash("sha256").update(JSON.stringify([projectRoot, worktree, sourcePath])).digest("hex");
      const previous = records.filter(r => r.itemId === itemId).at(-1);
      const newest = new Map(records.map(r => [r.itemId, r.id]));
      const victims: ScoutShow[] = [];
      let total = records.reduce((sum, r) => sum + r.byteSize, 0) + byteSize;
      let count = records.length + 1;
      for (const r of records) {
        if (total <= this.limits.storeBytes && count <= this.limits.records) break;
        if (newest.get(r.itemId) === r.id) continue;
        victims.push(r); total -= r.byteSize; count--;
      }
      if (total > this.limits.storeBytes || count > this.limits.records) throw new ShowError("show_store_full_newest_protected", 507);
      const extension = extname(sourcePath).toLowerCase();
      const mediaType = ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".pdf": "application/pdf", ".txt": "text/plain", ".md": "text/markdown", ".html": "text/html", ".svg": "image/svg+xml", ".csv": "text/csv", ".json": "application/json", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation", ".rtf": "application/rtf", ".odt": "application/vnd.oasis.opendocument.text" } as Record<string, string>)[extension] || "application/octet-stream";
      const record: ScoutShow = { id, itemId, ...(previous ? { supersedes: previous.id } : {}), agentId: input.agentId, sessionId: input.sessionId, harness: input.harness, nodeId: this.nodeId, projectRoot, worktree, branch, sourcePath,
        kind: mediaType.startsWith("image/") ? "image" : mediaType.startsWith("video/") ? "video" : mediaType.startsWith("text/") || mediaType === "application/pdf" || [".json", ".docx", ".xlsx", ".pptx", ".rtf", ".odt"].includes(extension) ? "document" : "other",
        mediaType, byteSize, sha256: hash.digest("hex"), caption: input.caption, ...(input.requestId !== undefined ? { requestId: input.requestId } : {}), createdAt: Math.max(Date.now(), (records.at(-1)?.createdAt ?? 0) + 1) };
      // Admission is complete. Evict only superseded versions; every existing latest survives until commit.
      for (const r of victims) { await rm(join(this.directory, `${r.id}.json`), { force: true }); await rm(this.blobPath(r.id), { force: true }); }
      await rename(temporary, this.blobPath(id));
      const metadata = join(this.directory, `${id}.pending`);
      await writeFile(metadata, JSON.stringify(record), { mode: 0o600 });
      await rename(metadata, join(this.directory, `${id}.json`));
      for (const listener of this.listeners) { try { listener(record); } catch {} }
      return { show: record, replayed: false };
    } finally { await handle.close(); await rm(temporary, { force: true }); }
  }
}

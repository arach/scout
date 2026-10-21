import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, opendir, rename, unlink, type FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ATTACHMENT_LIMITS, type MessageBlobRef } from "@openscout/protocol";
import { AttachmentError } from "./attachment-contract.js";
import { assertTestIsolatedUserData, resolveOpenScoutSupportPaths } from "./support-paths.js";

export const attachmentHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const BLOB_GRACE_MS = 10 * 60_000;
type Entry = { name: string; size: number; time: number };
export type AttachmentBlobStoreOptions = {
  supportDirectory?: string;
  maxBytes?: number;
  now?: () => number;
  graceMs?: number;
  /** Authoritative hot AND cold message bindings; throw if coverage is unavailable. */
  references: (candidates: ReadonlySet<string>, signal?: AbortSignal) => Promise<Set<string>>;
  /** Deterministic failure seam. Never used by production composition. */
  beforeRename?: () => Promise<void>;
};
/** One broker owns this store. The serial lease spans file durability AND canonical
 * acceptance, so no local GC can collect a commit in flight. Crash leftovers get
 * a grace period; reads never expose files without a committed message binding. */
export class AttachmentBlobStore {
  private readonly root: string;
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private readonly cap: number;
  constructor(private readonly options: AttachmentBlobStoreOptions) {
    if (!options.supportDirectory) assertTestIsolatedUserData("write attachment blobs", "OPENSCOUT_SUPPORT_DIRECTORY");
    this.root = join(options.supportDirectory ?? resolveOpenScoutSupportPaths().supportDirectory, "blobs", "sha256");
    this.cap = options.maxBytes ?? ATTACHMENT_LIMITS.storeBytes;
    if (!Number.isSafeInteger(this.cap) || this.cap < 1 || this.cap > ATTACHMENT_LIMITS.storeBytes) throw new AttachmentError("attachments_unavailable");
  }
  private now() { return (this.options.now ?? Date.now)(); }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    // Avoid retaining an unbounded queue of 25 MiB decoded uploads.
    if (this.pending >= 2) return Promise.reject(new AttachmentError("attachments_busy"));
    this.pending++;
    const run = this.queue.then(work).catch(error => {
      if (error instanceof AttachmentError) throw error;
      throw new AttachmentError("attachment_unavailable");
    }).finally(() => { this.pending--; });
    this.queue = run.catch(() => {}); return run;
  }
  private async syncDirectory(path: string) {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { await file.sync(); } finally { await file.close(); }
  }
  private async ready() {
    // Reject symlinks at store-owned directory boundaries. The support root is
    // chosen by trusted runtime composition, never by a request.
    for (const path of [dirname(this.root), this.root]) {
      await mkdir(path, { recursive: true, mode: 0o700 });
      const stat = await lstat(path);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new AttachmentError("attachments_unavailable");
      await this.syncDirectory(path); await this.syncDirectory(dirname(path));
    }
  }
  private async inventory(): Promise<Entry[]> {
    const rows: Entry[] = [];
    for await (const entry of await opendir(this.root)) {
      if (!/^(?:[a-f0-9]{64}|\.tmp-[a-f0-9-]+)$/.test(entry.name)) throw new AttachmentError("attachments_unavailable");
      if (rows.length >= 4096) throw new AttachmentError("attachments_unavailable");
      const stat = await lstat(join(this.root, entry.name));
      if (!stat.isFile() || stat.isSymbolicLink()) throw new AttachmentError("attachments_unavailable");
      rows.push({ name: entry.name, size: stat.size, time: stat.mtimeMs });
    }
    return rows.sort((a,b) => a.time-b.time || a.name.localeCompare(b.name));
  }
  private async sweep(rows: Entry[], pinned: Set<string>, reserve: number, count: number, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const grace = this.options.graceMs ?? BLOB_GRACE_MS;
    const candidates = new Set(rows.filter(e => !e.name.startsWith(".")).map(e => e.name));
    // A failed history read must never turn into proof that all blobs are orphaned.
    const referenced = await this.options.references(candidates, signal);
    signal?.throwIfAborted();
    let bytes = rows.reduce((sum,e) => sum+e.size, 0), files = rows.length;
    let changed = false;
    for (const row of rows) {
      signal?.throwIfAborted();
      if (pinned.has(row.name) || this.now()-row.time < grace) continue;
      const orphan = row.name.startsWith(".") || !referenced.has(row.name);
      if (!orphan && bytes+reserve <= this.cap && files+count <= 4096) continue;
      await unlink(join(this.root, row.name)); changed = true;
      bytes -= row.size; files--;
    }
    if (changed) await this.syncDirectory(this.root);
    // Backpressure instead of violating the cap or the orphan grace period.
    if (bytes+reserve > this.cap || files+count > 4096) throw new AttachmentError("attachments_capacity", 507);
  }
  async withBlobs<T>(blobs: Array<{ ref: MessageBlobRef; bytes: Uint8Array }>, commit: () => Promise<T>): Promise<T> {
    return this.serial(async () => {
      await this.ready();
      const unique = new Map(blobs.map(blob => [blob.ref.sha256, blob]));
      const rows = await this.inventory(), existing = new Set(rows.map(e => e.name));
      const fresh = [...unique.values()].filter(b => !existing.has(b.ref.sha256));
      await this.sweep(rows, new Set(unique.keys()), fresh.reduce((n,b) => n+b.bytes.length,0), fresh.length);
      for (const { ref, bytes } of unique.values()) {
        if (attachmentHash(bytes) !== ref.sha256 || bytes.length !== ref.byteSize) throw new AttachmentError("invalid_attachment_binding", 400);
        if (existing.has(ref.sha256)) {
          const file = await open(join(this.root, ref.sha256), constants.O_RDONLY | constants.O_NOFOLLOW);
          try {
            const stat = await file.stat();
            if (!stat.isFile() || stat.size !== ref.byteSize || attachmentHash(await file.readFile()) !== ref.sha256) throw new AttachmentError("attachment_unavailable");
          } finally { await file.close(); }
          // A recovered orphan's rename might not have reached disk. Reassert
          // both barriers before allowing a later canonical message to commit.
          const durable = await open(join(this.root, ref.sha256), constants.O_RDONLY | constants.O_NOFOLLOW);
          try { await durable.sync(); } finally { await durable.close(); }
          await this.syncDirectory(this.root); continue;
        }
        const temporary = join(this.root, `.tmp-${randomUUID()}`);
        let file: FileHandle | undefined;
        try {
          file = await open(temporary, "wx", 0o600); await file.writeFile(bytes); await file.sync(); await file.close(); file = undefined;
          await this.options.beforeRename?.();
          await rename(temporary, join(this.root, ref.sha256)); await this.syncDirectory(this.root);
        } finally { await file?.close(); await unlink(temporary).catch(() => {}); }
      }
      return commit();
    });
  }
  async read(ref: MessageBlobRef): Promise<Buffer> {
    if (ref.byteSize > ATTACHMENT_LIMITS.readBytes) throw new AttachmentError("attachment_too_large", 413);
    return this.serial(async () => {
      await this.ready();
      if (!/^[a-f0-9]{64}$/.test(ref.sha256)) throw new AttachmentError("invalid_attachment_binding", 400);
      const file = await open(join(this.root, ref.sha256), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size !== ref.byteSize || stat.size > ATTACHMENT_LIMITS.readBytes) throw new AttachmentError("attachment_unavailable");
        const bytes = await file.readFile();
        if (bytes.length !== ref.byteSize || attachmentHash(bytes) !== ref.sha256) throw new AttachmentError("attachment_unavailable");
        return bytes;
      } finally { await file.close(); }
    });
  }
  async collect(signal?: AbortSignal): Promise<void> { return this.serial(async () => { signal?.throwIfAborted(); await this.ready(); await this.sweep(await this.inventory(), new Set(), 0, 0, signal); }); }
}

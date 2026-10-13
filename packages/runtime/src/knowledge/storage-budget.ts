import { lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { Database } from "bun:sqlite";
import type { OpenScoutKnowledgePaths } from "./paths.js";
import { KNOWLEDGE_MAX_BYTES } from "./limits.js";

export function fileBytes(path: string): number {
  try { const info = lstatSync(path); if (info.isSymbolicLink()) throw new KnowledgeCapacityError("symlinked storage file is not supported"); return info.size; } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return 0; throw e; }
}
export function directoryBytes(path: string): number {
  try {
    const info = lstatSync(path);
    if (info.isSymbolicLink()) throw new KnowledgeCapacityError("symlinked QMD storage is not supported");
    if (!info.isDirectory()) return info.size;
    return readdirSync(path).reduce((sum, name) => sum + directoryBytes(join(path, name)), 0);
  } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return 0; throw e; }
}
export function knowledgeStorageUsage(paths: OpenScoutKnowledgePaths) {
  const sqliteBytes = fileBytes(paths.sqlitePath);
  const walBytes = fileBytes(`${paths.sqlitePath}-wal`);
  const qmdBytes = directoryBytes(paths.qmdRoot);
  return { sqliteBytes, walBytes, qmdBytes, totalBytes: sqliteBytes + walBytes + qmdBytes, maxBytes: KNOWLEDGE_MAX_BYTES };
}

export class KnowledgeCapacityError extends Error {
  constructor(message: string) { super(`Local search storage paused: ${message}`); this.name = "KnowledgeCapacityError"; }
}

/** Held for the complete indexing/maintenance job, including QMD publication.
 * SQLite's per-transaction lock alone cannot reserve bytes for filesystem writes. */
export function acquireKnowledgeWriter(paths: OpenScoutKnowledgePaths): () => void {
  const lock = `${paths.sqlitePath}.writer`;
  mkdirSync(dirname(lock), { recursive: true });
  for (let attempt = 0; ; attempt++) {
    try { mkdirSync(lock); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let pid: number;
      try { pid = Number(readFileSync(join(lock, "pid"), "utf8")); } catch { throw new KnowledgeCapacityError("another writer is starting; retry shortly"); }
      if (!Number.isSafeInteger(pid) || pid <= 0 || attempt > 0) throw new KnowledgeCapacityError("another writer holds the index");
      try { process.kill(pid, 0); throw new KnowledgeCapacityError("another writer holds the index"); }
      catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e;
        rmSync(lock, { recursive: true });
      }
    }
  }
  try { writeFileSync(join(lock, "pid"), String(process.pid)); }
  catch (error) { rmSync(lock, { recursive: true, force: true }); throw error; }
  return () => rmSync(lock, { recursive: true, force: true });
}

export function removeCollectionQmd(paths: OpenScoutKnowledgePaths, path: string): void {
  try { if (lstatSync(paths.qmdRoot).isSymbolicLink()) throw new KnowledgeCapacityError("symlinked QMD root is not supported"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const root = resolve(paths.qmdRoot);
  const rel = relative(root, resolve(path));
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new KnowledgeCapacityError("collection QMD path escapes the index");
  // Never traverse a symlink into source material or another index.
  let parent = root;
  for (const segment of rel.split(/[\\/]/u)) {
    parent = join(parent, segment);
    try { if (lstatSync(parent).isSymbolicLink()) throw new KnowledgeCapacityError("symlink in collection QMD path"); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
  rmSync(path, { recursive: true, force: true });
}

/** Physical byte ceiling, not a text-size estimate. Reserve a full database's
 * worth of WAL frames BEFORE any transaction, disable cache spills (one frame
 * per dirty page), and enforce SQLite max_page_count. A pinned reader refuses
 * the next write rather than letting WAL grow. This intentionally leaves some
 * of 256 MiB unused at rest so even worst-case indexing fits the same ceiling. */
export class KnowledgeStorageBudget {
  private qmdBytes = 0;
  readonly maxBytes: number;
  constructor(private readonly db: Database, private readonly paths: OpenScoutKnowledgePaths,
    private readonly evictOldest: (protectedId?: string) => number | false,
    options: { maxBytes?: number; freeDiskBytes?: () => number } = {}) {
    this.maxBytes = options.maxBytes ?? KNOWLEDGE_MAX_BYTES;
    this.freeDiskBytes = options.freeDiskBytes ?? (() => { const s = statfsSync(dirname(paths.sqlitePath)); return s.bavail * s.bsize; });
    db.exec("PRAGMA cache_spill = OFF; PRAGMA wal_autocheckpoint = 0;");
  }
  private readonly freeDiskBytes: () => number;
  private pragma(name: string): number { return Number(Object.values(this.db.query(`PRAGMA ${name}`).get() as object)[0]); }
  checkpoint(required = true): void {
    const row = this.db.query("PRAGMA wal_checkpoint(TRUNCATE)").get() as { busy: number };
    if (required && row.busy) throw new KnowledgeCapacityError("a reader is holding the WAL; retry when it finishes");
  }
  private pageLimit(extraQmdBytes: number): number {
    // Also reserve a second database image for FTS segment merges during
    // eviction. Each image needs WAL frame headroom; this is a physical ceiling,
    // not an estimate based on compressibility of transcript text.
    return Math.floor((this.maxBytes - this.qmdBytes - extraQmdBytes - Math.max(65536, Math.min(4 * 1024 * 1024, this.maxBytes / 8))) / (4 * this.pragma("page_size") + 48));
  }
  private evict(protectedId?: string): boolean {
    this.checkpoint();
    // FTS deletion can allocate tombstone/merge pages. Give maintenance the
    // insertion reserve, still within the physical DB+WAL ceiling.
    const pages = Math.floor((this.maxBytes - this.qmdBytes - 65536) / (2 * this.pragma("page_size") + 24));
    if (pages > 0) this.pragma(`max_page_count = ${pages}`);
    const removed = this.evictOldest(protectedId);
    if (removed === false) return false;
    this.qmdBytes = Math.max(0, this.qmdBytes - removed);
    return true;
  }
  reclaim(): void {
    this.checkpoint();
    if (this.pragma("freelist_count") === 0) return;
    if (this.pragma("auto_vacuum") === 2) {
      this.db.exec("PRAGMA incremental_vacuum;");
    } else {
      const size = fileBytes(this.paths.sqlitePath);
      let free = 0;
      try { free = this.freeDiskBytes(); } catch { /* unknown space is not permission */ }
      if (free < size * 2) throw new KnowledgeCapacityError("VACUUM needs free disk of at least 2× the database size; no new indexing was admitted");
      this.db.exec("PRAGMA auto_vacuum = INCREMENTAL; VACUUM;");
    }
    this.checkpoint();
  }
  prepare(extraQmdBytes = 0, protectedId?: string): void {
    // The cross-process writer lease prevents concurrent QMD publication.
    // Measure once, subtract each evicted tree, then remeasure on the next
    // admission (after any publication). Avoid scanning the whole tree per
    // legacy collection during a multi-thousand-session eviction.
    this.qmdBytes = directoryBytes(this.paths.qmdRoot);
    this.checkpoint();
    const minimumDatabaseRoom = 32 * (4 * this.pragma("page_size") + 48) + Math.max(65536, Math.min(4 * 1024 * 1024, this.maxBytes / 8));
    if (extraQmdBytes + minimumDatabaseRoom >= this.maxBytes) throw new KnowledgeCapacityError("this collection's QMD files cannot fit the 256 MiB budget");
    let limit = this.pageLimit(extraQmdBytes);
    // Existing installs can have QMD alone above the entire cap. Those are
    // evictable bytes, not an oversized incoming collection.
    while (limit < 32) {
      if (!this.evict(protectedId)) throw new KnowledgeCapacityError("retained QMD files exceed the byte budget");
      limit = this.pageLimit(extraQmdBytes);
    }
    if (this.pragma("page_count") > limit) {
      // Evict whole collections, always oldest updated_at first. Reclaim only
      // once enough pages are free (VACUUM-per-collection is quadratic).
      while (this.pragma("page_count") - this.pragma("freelist_count") > limit) {
        if (!this.evict(protectedId)) throw new KnowledgeCapacityError("collection or retained files exceed the byte budget");
        this.checkpoint();
        limit = this.pageLimit(extraQmdBytes);
      }
      this.reclaim();
    }
    const effective = this.pragma(`max_page_count = ${limit}`);
    if (effective > limit) throw new KnowledgeCapacityError("unable to reclaim enough database pages");
  }
  run<T>(action: () => T, extraQmdBytes = 0, protectedId?: string): T {
    for (;;) {
      this.prepare(extraQmdBytes, protectedId);
      try {
        const result = (this.db as Database & { transaction<T>(fn: () => T): () => T }).transaction(action)();
        this.checkpoint(false);
        return result;
      } catch (error) {
        if ((error as { code?: string }).code !== "SQLITE_FULL" && !String(error).includes("database or disk is full")) throw error;
        // SQLite rolled back the complete collection. No partial FTS/QMD is
        // published. Free the oldest collection and retry under the same limit.
        this.checkpoint();
        if (!this.evict(protectedId)) throw new KnowledgeCapacityError("one collection exceeds the bounded index capacity");
        this.reclaim();
      }
    }
  }
}

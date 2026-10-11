import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink, type FileHandle } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { BrokerBusyError } from "./broker-storage-pressure.js";
import { resolveOpenScoutSupportPaths } from "./support-paths.js";

export function canonicalRequest(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalRequest).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalRequest(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export type RequestReceipt = { requesterId: string; requestId: string; operation: string; fingerprint: string; state: "unknown" | "done"; result?: unknown };
type ReceiptLease = { resize: (bytes: number) => void; release: () => void };
export type BrokerRequestReceiptOptions = {
  maxOperations?: number;
  maxBytes?: number;
  /** Persistence seam for deterministic storage delay/failure checks. */
  sync?: (file: FileHandle, kind: "file" | "directory" | "parent_directory", record: Readonly<RequestReceipt>) => Promise<void>;
};

/** Broker-owned intent/receipt ledger. Never re-execute a reserved but unsettled mutation.
 * A lost response is recoverable; a broker crash during acceptance stays explicitly unknown.
 * Filesystem waits never occupy the broker event loop. Per-key work is registered
 * synchronously, before the first read, so concurrent retries cannot both execute.
 */
export class BrokerRequestReceipts {
  private running = new Map<string, { fingerprint?: string; promise: Promise<RequestReceipt> }>();
  private pendingOperations = 0;
  private pendingBytes = 0;
  private directoryReady?: Promise<void>;
  private directoryParents = new Set<string>();
  constructor(
    private readonly directory = join(resolveOpenScoutSupportPaths().controlHome, "request-receipts"),
    private readonly options: BrokerRequestReceiptOptions = {},
  ) {}
  status() { return { pendingOperations: this.pendingOperations, pendingBytes: this.pendingBytes,
    maxOperations: this.options.maxOperations ?? 256, maxBytes: this.options.maxBytes ?? 32 * 1024 * 1024 }; }
  private reserve(bytes: number): ReceiptLease {
    const maxBytes = this.options.maxBytes ?? 32 * 1024 * 1024;
    if (this.pendingOperations >= (this.options.maxOperations ?? 256) || this.pendingBytes + bytes > maxBytes) {
      throw new BrokerBusyError("the request receipt queue is at capacity");
    }
    this.pendingOperations++; this.pendingBytes += bytes;
    let reserved = bytes, released = false;
    return {
      // Charge each pending operation for its largest encoded request/receipt.
      // Stat checks the read size before allocating the file payload.
      resize: next => {
        if (next <= reserved) return;
        if (this.pendingBytes + next - reserved > maxBytes) throw new BrokerBusyError("the request receipt byte queue is at capacity");
        this.pendingBytes += next - reserved; reserved = next;
      },
      release: () => { if (!released) { released = true; this.pendingOperations--; this.pendingBytes -= reserved; } },
    };
  }
  private path(requesterId: string, requestId: string, operation: string) {
    return join(this.directory, `${createHash("sha256").update(canonicalRequest([requesterId, requestId, operation])).digest("hex")}.json`);
  }
  private async read(path: string, lease: ReceiptLease): Promise<RequestReceipt | null> {
    let file: FileHandle;
    try { file = await open(path, "r"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    try {
      lease.resize((await file.stat()).size);
      const payload = await file.readFile("utf8");
      const corrupt = () => new Error("request_outcome_unknown: corrupt request receipt; source preserved for inspection");
      let parsed: unknown;
      try { parsed = JSON.parse(payload); } catch { throw corrupt(); }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw corrupt();
      const record = parsed as Record<string, unknown>;
      if (typeof record.requesterId !== "string" || !record.requesterId.trim()
        || typeof record.requestId !== "string" || !record.requestId.trim()
        || typeof record.operation !== "string" || !record.operation.trim()
        || typeof record.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(record.fingerprint)
        || (record.state !== "unknown" && record.state !== "done")
        || this.path(record.requesterId, record.requestId, record.operation) !== path) throw corrupt();
      // Only an absent file means no reservation. Invalid data or a receipt
      // copied from another key must never authorize fresh execution.
      return record as RequestReceipt;
    } finally { await file.close(); }
  }
  async get(requesterId: string, requestId: string, operation: string): Promise<RequestReceipt | null> {
    const lease = this.reserve(0);
    try { return await this.read(this.path(requesterId, requestId, operation), lease); }
    finally { lease.release(); }
  }
  private ensureDirectory(record: Readonly<RequestReceipt>): Promise<void> {
    if (!this.directoryReady) {
      this.directoryReady = (async () => {
        const firstCreated = await mkdir(this.directory, { recursive: true, mode: 0o700 });
        let parent = dirname(resolve(this.directory));
        const boundary = firstCreated ? dirname(resolve(firstCreated)) : parent;
        // Flush the ledger's parent once per instance, also covering a previous
        // process that failed during creation. Recursive creation additionally
        // needs each new ancestor's entry persisted in its own parent.
        for (;;) {
          this.directoryParents.add(parent);
          if (parent === boundary) break;
          parent = dirname(parent);
        }
        for (const path of this.directoryParents) {
          const directory = await open(path, "r");
          try {
            if (this.options.sync) await this.options.sync(directory, "parent_directory", record); else await directory.sync();
          } finally { await directory.close(); }
        }
        this.directoryParents.clear();
      })().catch(error => {
        // Keep the ancestor set for retry: mkdir may now report that the paths
        // exist even though their previous parent flush did not complete.
        this.directoryReady = undefined;
        throw error;
      });
    }
    return this.directoryReady;
  }
  private async save(record: RequestReceipt, lease: ReceiptLease): Promise<void> {
    const payload = JSON.stringify(record);
    lease.resize(Buffer.byteLength(payload));
    await this.ensureDirectory(record);
    const path = this.path(record.requesterId, record.requestId, record.operation);
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(payload);
        if (this.options.sync) await this.options.sync(file, "file", record); else await file.sync();
      } finally { await file.close(); }
      await rename(temporary, path);
      const directory = await open(this.directory, "r");
      try {
        if (this.options.sync) await this.options.sync(directory, "directory", record); else await directory.sync();
      } finally { await directory.close(); }
    } catch (error) {
      // A failed directory sync may leave an unknown reservation. Preserve it:
      // absence of a successful receipt never authorizes another execution.
      await unlink(temporary).catch(() => {});
      throw error;
    }
  }
  async recover(requesterId: string, requestId: string, operation: string, result: unknown): Promise<RequestReceipt> {
    const key = this.path(requesterId, requestId, operation);
    const active = this.running.get(key);
    if (active) {
      try { return await active.promise; }
      catch { return this.recover(requesterId, requestId, operation, result); }
    }
    const lease = this.reserve(Buffer.byteLength(JSON.stringify(result) ?? "null"));
    const pending = Promise.resolve().then(async () => {
      const record = await this.read(key, lease);
      if (!record) throw new Error("cannot recover an unreserved request");
      if (record.state === "done") return record;
      const recovered: RequestReceipt = { ...record, state: "done", result };
      await this.save(recovered, lease);
      return recovered;
    }).finally(() => { this.running.delete(key); lease.release(); });
    this.running.set(key, { promise: pending });
    return pending;
  }
  async run<T>(requesterId: string, requestId: string, operation: string, payload: unknown, execute: () => Promise<T>, reconcile?: () => Promise<T | null>, admit?: () => (() => void)): Promise<T> {
    if (!requesterId || !requestId.trim() || requestId.length > 256) throw new Error("invalid requester/request id");
    const key = this.path(requesterId, requestId, operation);
    const active = this.running.get(key);
    // Reject a new key at the count bound before encoding its body. Replays
    // still validate content but reuse their existing operation's slot.
    const lease = active ? null : this.reserve(0);
    let fingerprint: string;
    try {
      const encoded = canonicalRequest(payload);
      lease?.resize(Buffer.byteLength(encoded));
      fingerprint = createHash("sha256").update(encoded).digest("hex");
    } catch (error) { lease?.release(); throw error; }
    const checkFingerprint = (value: string) => { if (value !== fingerprint) throw new Error("request id already assigned to different content"); };
    if (active) {
      if (active.fingerprint) checkFingerprint(active.fingerprint);
      const receipt = await active.promise;
      checkFingerprint(receipt.fingerprint);
      return receipt.result as T;
    }
    const ownedLease = lease!;
    const pending = Promise.resolve().then(async (): Promise<RequestReceipt> => {
      const prior = await this.read(key, ownedLease);
      if (prior) {
        checkFingerprint(prior.fingerprint);
        if (prior.state === "done") return prior;
        const recovered = await reconcile?.();
        if (recovered === undefined || recovered === null) throw new Error("request_outcome_unknown: reconcile this request; do not replace it");
        const receipt: RequestReceipt = { ...prior, state: "done", result: recovered };
        await this.save(receipt, ownedLease);
        return receipt;
      }
      const record: RequestReceipt = { requesterId, requestId, operation, fingerprint, state: "unknown" };
      // Actual command admission follows the read so completed receipts remain
      // observable under command pressure, but precedes durable reservation.
      const release = admit?.();
      try {
        await this.save(record, ownedLease);
        const result = await execute();
        const receipt: RequestReceipt = { ...record, state: "done", result };
        await this.save(receipt, ownedLease);
        return receipt;
      } finally { release?.(); }
    }).finally(() => { this.running.delete(key); ownedLease.release(); });
    this.running.set(key, { fingerprint, promise: pending });
    return (await pending).result as T;
  }
}

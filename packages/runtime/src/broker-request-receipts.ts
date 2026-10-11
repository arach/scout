import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveOpenScoutSupportPaths } from "./support-paths.js";

export function canonicalRequest(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalRequest).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalRequest(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export type RequestReceipt = { requesterId: string; requestId: string; operation: string; fingerprint: string; state: "unknown" | "done"; result?: unknown };

/** Broker-owned intent/receipt ledger. Never re-execute a reserved but unsettled mutation.
 * A lost response is recoverable; a broker crash during acceptance stays explicitly unknown.
 */
export class BrokerRequestReceipts {
  private running = new Map<string, Promise<unknown>>();
  constructor(private readonly directory = join(resolveOpenScoutSupportPaths().controlHome, "request-receipts")) {}
  private path(requesterId: string, requestId: string, operation: string) {
    return join(this.directory, `${createHash("sha256").update(canonicalRequest([requesterId, requestId, operation])).digest("hex")}.json`);
  }
  get(requesterId: string, requestId: string, operation: string): RequestReceipt | null {
    const path = this.path(requesterId, requestId, operation);
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as RequestReceipt : null;
  }
  private save(record: RequestReceipt) {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const path = this.path(record.requesterId, record.requestId, record.operation);
    const temporary = `${path}.${randomUUID()}.tmp`;
    const fd = openSync(temporary, "wx", 0o600);
    try { writeFileSync(fd, JSON.stringify(record)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, path);
    const dir = openSync(this.directory, "r");
    try { fsyncSync(dir); } finally { closeSync(dir); }
  }
  recover(requesterId: string, requestId: string, operation: string, result: unknown): RequestReceipt {
    const record = this.get(requesterId, requestId, operation);
    if (!record) throw new Error("cannot recover an unreserved request");
    if (record.state === "done") return record;
    const recovered: RequestReceipt = { ...record, state: "done", result };
    this.save(recovered);
    return recovered;
  }
  async run<T>(requesterId: string, requestId: string, operation: string, payload: unknown, execute: () => Promise<T>): Promise<T> {
    if (!requesterId || !requestId.trim() || requestId.length > 256) throw new Error("invalid requester/request id");
    const key = this.path(requesterId, requestId, operation);
    const fingerprint = createHash("sha256").update(canonicalRequest(payload)).digest("hex");
    const prior = this.get(requesterId, requestId, operation);
    if (prior && prior.fingerprint !== fingerprint) throw new Error("request id already assigned to different content");
    const active = this.running.get(key);
    if (active) return active as Promise<T>;
    if (prior?.state === "done") return prior.result as T;
    if (prior) throw new Error("request_outcome_unknown: reconcile this request; do not replace it");
    const record: RequestReceipt = { requesterId, requestId, operation, fingerprint, state: "unknown" };
    this.save(record); // reserve before *any* routing/session/message side effect
    const pending = (async () => {
      const result = await execute();
      this.save({ ...record, state: "done", result });
      return result;
    })();
    this.running.set(key, pending);
    try { return await pending; } finally { this.running.delete(key); }
  }
}

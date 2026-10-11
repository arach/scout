import { parentPort, workerData } from "node:worker_threads";
import { FileBackedBrokerJournal, type BrokerJournalReplayBoundary } from "./broker-journal.js";
import { RecoverableSQLiteProjection, type SQLiteProjectionJournal } from "./sqlite-projection.js";
import type { ThreadEventEnvelope } from "@openscout/protocol";

if (!parentPort) throw new Error("SQLite projection worker requires a parent port");
const port = parentPort;
const data = workerData as { dbPath: string; journalPath: string; historyDirectory?: string; heartbeatMs?: number };
const reader = new FileBackedBrokerJournal(data.journalPath);
const cursors = new Map<string, { fileIdentity: string; endByte: number }>();
const replay = { fullReplays: 0, tailReplays: 0, bytes: 0 };
let nextSourceId = 0;
const sourceRequests = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
function source(operation: "boundary" | "threadEvents", value: unknown): Promise<any> {
  const id = ++nextSourceId;
  return new Promise((resolve, reject) => {
    sourceRequests.set(id, { resolve, reject });
    port.postMessage({ kind: "source", id, operation, value });
  });
}
// This reader never loads/compacts the journal or maintains a second hot state.
// Every canonical barrier is written by the parent broker's journal queue.
const journal: SQLiteProjectionJournal = {
  captureReplayBoundary: options => source("boundary", options ?? {}),
  replay: async (visit, boundary, options) => {
    const previous = options?.afterBarrier && cursors.get(options.afterBarrier.id);
    const tail = previous && boundary?.fileIdentity === previous.fileIdentity
      && previous.endByte <= boundary.endByteExclusive;
    const report = await reader.replay(visit, boundary, tail ? { startByteInclusive: previous.endByte } : options);
    if (tail) replay.tailReplays++; else replay.fullReplays++;
    replay.bytes += (boundary?.endByteExclusive ?? 0) - (tail ? previous.endByte : 0);
    if (report.afterBarrierFound && boundary?.barrier && boundary.fileIdentity) {
      cursors.set(boundary.barrier.id, { fileIdentity: boundary.fileIdentity, endByte: boundary.endByteExclusive });
      while (cursors.size > 8) cursors.delete(cursors.keys().next().value!);
    }
    return report;
  },
  listDeliveries: () => [],
  verificationRecords: () => { throw new Error("Worker verification requires captured expected records"); },
};
const projection = new RecoverableSQLiteProjection(data.dbPath, journal, {
  historyDirectory: data.historyDirectory, quarantinePath: `${data.journalPath}.quarantine.sqlite`,
});
const publish = async (events: ThreadEventEnvelope[]) => {
  // The engine's replay batches are bounded. Await parent consumption before
  // producing another batch so MessagePort is not an unbounded event queue.
  await source("threadEvents", events);
};
function state() { return { status: projection.statusSnapshot(), health: projection.health(), replay, progress: projection.progressRevision() }; }
const stateTimer = setInterval(() => port.postMessage({ kind: "state", ...state() }), data.heartbeatMs ?? 250);
stateTimer.unref();

port.on("message", async (packet: { kind: string; id: number; method?: string; args?: unknown[]; value?: unknown; error?: string }) => {
  if (packet.kind === "sourceResult") {
    const request = sourceRequests.get(packet.id); if (!request) return;
    sourceRequests.delete(packet.id);
    if (packet.error) request.reject(new Error(packet.error)); else request.resolve(packet.value);
    return;
  }
  if (packet.kind !== "request" || typeof packet.method !== "string") return;
  try {
    let value: unknown;
    if (packet.method === "catchUpStartup") {
      value = await projection.catchUpStartup(packet.args?.[0] as BrokerJournalReplayBoundary, publish);
    } else {
      const method = (projection as unknown as Record<string, unknown>)[packet.method];
      if (typeof method !== "function" || packet.method.startsWith("_") || packet.method === "constructor") throw new Error("Unknown projection operation");
      value = await method.apply(projection, packet.args ?? []);
    }
    port.postMessage({ kind: "result", id: packet.id, value, ...state() });
  } catch (error) {
    port.postMessage({ kind: "result", id: packet.id, error: error instanceof Error ? error.message : String(error), ...state() });
  }
});

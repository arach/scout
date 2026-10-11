import { afterEach, expect, test } from "bun:test";
import { appendFile, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileBackedBrokerJournal, type BrokerJournalEntry } from "./broker-journal.js";
import { BrokerMessageHistory } from "./broker-message-history.js";
import { readMessageRecord } from "./broker-message-records.js";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const actor = (index: number): BrokerJournalEntry => ({ kind: "actor.upsert", actor: { id: "actor", kind: "agent", displayName: `Actor ${index}` } });
const message = (id: string): BrokerJournalEntry => ({ kind: "message.record", message: {
  id, conversationId: "conversation", actorId: "actor", originNodeId: "node", class: "agent", body: `body-${id}`,
  visibility: "private", policy: "durable", createdAt: 1_700_000_000_000,
} });
async function setup(diskHistory = false) {
  const root = await mkdtemp(join(tmpdir(), "scout-live-compact-")); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "journal.jsonl");
  const history = diskHistory ? await BrokerMessageHistory.create(path) : undefined;
  if (history) cleanup.push(() => history.close());
  const journal = new FileBackedBrokerJournal(path, { messageHistory: history, compactionPolicy: { minimumReclaimBytes: 1 } });
  await journal.load();
  await journal.appendEntries([actor(0), actor(1), actor(2), message("old")]);
  return { root, path, journal, history };
}
const compact = { minimumBytes: 0, minimumIntervalMs: 0 };

test("live compaction retains the complete accepted suffix and coalesces overlapping runs", async () => {
  const { journal, path } = await setup();
  await journal.captureReplayBoundary({ barrier: { id: "checkpoint", projectionId: "control-plane", projectionVersion: 1, createdAt: 1 } });
  const capture = journal.captureReplayBoundary.bind(journal);
  let captured!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => { captured = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  journal.captureReplayBoundary = async (...args) => { const boundary = await capture(...args); captured(); await gate; return boundary; };
  const running = journal.compactIfNeeded(compact);
  expect(journal.compactIfNeeded(compact)).toBe(running);
  await ready;
  await journal.appendEntries([actor(3), message("late")]);
  release();
  const result = await running;
  expect(result.state).toBe("compacted");
  journal.captureReplayBoundary = capture;
  const entries = await journal.readEntries();
  expect(entries.filter(entry => entry.kind === "actor.upsert")).toHaveLength(2);
  expect(entries.filter(entry => entry.kind === "journal.replay_barrier")).toHaveLength(1);
  const restored = new FileBackedBrokerJournal(path); await restored.load();
  expect(restored.snapshot().actors.actor?.displayName).toBe("Actor 3");
  expect(Object.keys(restored.snapshot().messages).sort()).toEqual(["late", "old"]);
});

test("live compaction drops only records named by committed rotation markers", async () => {
  const { journal, path } = await setup();
  await journal.appendEntries(message("keep"));
  await journal.appendEntries({ kind: "history.rotate", cutoff: 1_800_000_000_000, rotatedAt: 1_800_000_000_000,
    evicted: { messageIds: ["old"], invocationIds: [], flightIds: [], deliveryIds: [], deliveryAttemptIds: [], collaborationEventIds: [] } });
  await journal.compactIfNeeded(compact);
  await journal.appendEntries([actor(4), actor(5), message("old")]);
  // A new version of an old ID written after its marker remains protected.
  expect((await journal.compactIfNeeded(compact)).state).toBe("compacted");
  const restored = new FileBackedBrokerJournal(path); await restored.load();
  expect(Object.keys(restored.snapshot().messages).sort()).toEqual(["keep", "old"]);
});

test("compaction scan budget preserves original bytes and leaves no partial file", async () => {
  const { journal, root, path } = await setup();
  const before = await readFile(path);
  expect((await journal.compactIfNeeded({ ...compact, maxEntries: 1 })).state).toBe("budget");
  expect(await readFile(path)).toEqual(before);
  expect((await readdir(root)).filter(name => name.endsWith(".tmp"))).toEqual([]);
  expect((await journal.compactIfNeeded({ ...compact, maxTrackedKeys: 0 })).state).toBe("budget");
  expect(await readFile(path)).toEqual(before);
});

test("only explicitly archived control events can leave the canonical journal", async () => {
  const { journal } = await setup();
  const events = ["archived", "protected"].map(id => ({ kind: "control.event.record", event: { id, kind: "message.created", actorId: "actor", nodeId: "node", ts: 1, payload: { context: [id] } } }) as BrokerJournalEntry);
  await journal.appendEntries(events);
  await journal.appendEntries({ kind: "history.rotate", cutoff: 100, rotatedAt: 100, evicted: {
    messageIds: [], invocationIds: [], flightIds: [], deliveryIds: [], deliveryAttemptIds: [], collaborationEventIds: [], controlEventIds: ["archived"],
  } });
  expect((await journal.compactIfNeeded(compact)).state).toBe("compacted");
  const retained = (await journal.readEntries()).filter(entry => entry.kind === "control.event.record");
  expect(retained).toEqual([events[1]]);
});

test("disk message history refreshes after atomic journal replacement", async () => {
  const { journal } = await setup(true);
  expect((await readMessageRecord(journal.snapshot().messages, "old"))?.body).toBe("body-old");
  expect((await journal.compactIfNeeded(compact)).state).toBe("compacted");
  await journal.appendEntries(message("later"));
  expect((await readMessageRecord(journal.snapshot().messages, "old"))?.body).toBe("body-old");
  expect((await readMessageRecord(journal.snapshot().messages, "later"))?.body).toBe("body-later");
});

test("receipt markers survive restart compaction until their exact prefix has applied cleanup", async () => {
  const { journal, path } = await setup();
  const evicted = { messageIds: [], invocationIds: [], flightIds: [], deliveryIds: [], deliveryAttemptIds: [], collaborationEventIds: [] };
  const receipt = { partition: "a".repeat(64), records: [], payloadBytes: 0 };
  await journal.appendEntries({ kind: "history.rotate", cutoff: 1, rotatedAt: 1, evicted, publications: [receipt] });
  const cleanupBoundary = await journal.captureReplayBoundary();
  await journal.appendEntries({ kind: "history.rotate", cutoff: 2, rotatedAt: 2, evicted, publications: [receipt] });
  await journal.appendEntries({ kind: "history.rotate", cutoff: 3, rotatedAt: 3, evicted });
  // A generic live or startup compaction cannot certify SQL cleanup.
  await journal.compactIfNeeded(compact);
  expect((await journal.readEntries()).filter(entry => entry.kind === "history.rotate")).toHaveLength(3);
  const restored = new FileBackedBrokerJournal(path, { compactionPolicy: { minimumReclaimBytes: 1 } }); await restored.load();
  expect((await restored.readEntries()).filter(entry => entry.kind === "history.rotate")).toHaveLength(3);
  // A stale inode proof never authorizes discarding receipts after replacement.
  await restored.compactIfNeeded({ ...compact, historicalCleanupApplied: true, historicalCleanupBoundary: cleanupBoundary });
  expect((await restored.readEntries()).filter(entry => entry.kind === "history.rotate")).toHaveLength(3);
  const currentBoundary = await restored.captureReplayBoundary();
  await restored.compactIfNeeded({ ...compact, historicalCleanupApplied: true, historicalCleanupBoundary: currentBoundary });
  expect((await restored.readEntries()).filter(entry => entry.kind === "history.rotate")).toHaveLength(1);
});

test("receipt cleanup byte proof includes blank lines and never authorizes a newer marker", async () => {
  const { journal, path } = await setup();
  await appendFile(path, "\n".repeat(4096));
  const evicted = { messageIds: [], invocationIds: [], flightIds: [], deliveryIds: [], deliveryAttemptIds: [], collaborationEventIds: [] };
  const receipt = { partition: "a".repeat(64), records: [], payloadBytes: 0 };
  await journal.appendEntries({ kind: "history.rotate", cutoff: 1, rotatedAt: 1, evicted, publications: [receipt] });
  const historicalCleanupBoundary = await journal.captureReplayBoundary();
  await journal.appendEntries({ kind: "history.rotate", cutoff: 2, rotatedAt: 2, evicted, publications: [receipt] });
  await journal.appendEntries({ kind: "history.rotate", cutoff: 3, rotatedAt: 3, evicted });
  await journal.compactIfNeeded({ ...compact, historicalCleanupApplied: true, historicalCleanupBoundary });
  expect((await journal.readEntries()).filter(entry => entry.kind === "history.rotate").map(entry => entry.cutoff)).toEqual([2, 3]);
});

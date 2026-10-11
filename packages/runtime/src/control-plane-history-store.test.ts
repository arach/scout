import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ControlPlaneHistoryReader, ControlPlaneHistoryStore, historicalRecordKey, HISTORY_PARTITION_LIMITS } from "./control-plane-history-store.js";
import { openControlPlaneSqliteDatabase } from "./sqlite-adapter.js";
const roots: string[] = [];
const stores: ControlPlaneHistoryStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function create() {
  const root = mkdtempSync(join(tmpdir(), "openscout-history-partitions-")); roots.push(root);
  const store = new ControlPlaneHistoryStore(root); stores.push(store); return { root, store };
}

test("partition reopen preserves full payload/context, exact locations, and indexed conversation pages", () => {
  const { root, store } = create();
  const message = { id: "m1", body: "雪🚀", metadata: { context: { instructions: "all context", nested: [1, { arbitraryNewField: true }] } },
    replyToMessageId: "older", attachments: [{ id: "blob", blobKey: "full-original", metadata: { unknown: "preserved" } }], mentions: [{ actorId: "a", label: "@a" }] };
  const first = store.publishPage([{ kind: "message", id: "m1", record: message, conversationId: "c", timestamp: 1 }]);
  const second = store.publishPage([{ kind: "message", id: "m2", record: { id: "m2", body: "second" }, conversationId: "c", timestamp: 2 },
    { kind: "message", id: "other", record: { id: "other" }, conversationId: "different", timestamp: 3 }]);
  expect(first.partition).not.toBe(second.partition);
  expect(store.read("message", "m1")).toEqual(message);
  expect(store.read("message", "missing")).toBeUndefined();
  expect(store.page({ kind: "message", conversationId: "c", limit: 1 }).map(row => row.id)).toEqual(["m1"]);
  expect(store.page({ kind: "message", conversationId: "c", after: { timestamp: 1, id: "m1" } }).map(row => row.id)).toEqual(["m2"]);
  const reopened = new ControlPlaneHistoryStore(root); stores.push(reopened);
  expect(reopened.read("message", "m1")).toEqual(message);
  expect(reopened.readLocation(first.records[0]!)).toEqual(message);
  expect(reopened.publishPage([{ kind: "message", id: "m1", record: message, conversationId: "c", timestamp: 1 }]).partition).toBe(first.partition);
  expect(readdirSync(join(root, "partitions")).filter(path => path.endsWith(".sqlite"))).toHaveLength(2);
});

test("archive corrections require compare-and-swap and every older full version remains readable", () => {
  const { store } = create();
  const original = store.publishPage([{ kind: "message", id: "m", record: { body: "original", context: [1, 2] } }]);
  expect(() => store.publishPage([{ kind: "message", id: "m", record: { body: "changed" } }])).toThrow("history_version_conflict");
  expect(store.read("message", "m")).toEqual({ body: "original", context: [1, 2] });
  const next = store.publishPage([{ kind: "message", id: "m", record: { body: "changed" } }], {
    expectedDigests: new Map([[historicalRecordKey("message", "m"), original.records[0]!.digest]]),
  });
  expect(next.partition).not.toBe(original.partition);
  expect(store.read("message", "m")).toEqual({ body: "changed" });
  expect(store.readLocation(original.records[0]!)).toEqual({ body: "original", context: [1, 2] });
});

test("bounded publication rejects oversized pages before creating a partition", () => {
  const { root, store } = create();
  expect(() => store.publishPage(Array.from({ length: HISTORY_PARTITION_LIMITS.records + 1 }, (_, id) => ({ kind: "message", id: String(id), record: {} })))).toThrow("history_partition_record_limit");
  expect(() => store.publishPage([{ kind: "message", id: "huge", record: { body: "x".repeat(HISTORY_PARTITION_LIMITS.payloadBytes) } }])).toThrow("history_partition_byte_limit");
  expect(readdirSync(join(root, "partitions"))).toEqual([]);
});

test("a corrupt archived payload fails closed instead of reporting missing history", () => {
  const { root, store } = create();
  const receipt = store.publishPage([{ kind: "message", id: "m", record: { body: "original" } }]);
  store.close(); stores.splice(stores.indexOf(store), 1);
  const partition = openControlPlaneSqliteDatabase(join(root, "partitions", receipt.partition + ".sqlite"));
  partition.query("UPDATE records SET payload_json='{}'").run(); partition.close?.();
  const reopened = new ControlPlaneHistoryStore(root); stores.push(reopened);
  expect(() => reopened.read("message", "m")).toThrow("history_record_missing_or_corrupt");
});


test("read-only reader creates no absent files and observes subsequent worker publication", () => {
  const root = mkdtempSync(join(tmpdir(), "openscout-history-reader-")); roots.push(root);
  const directory = join(root, "not-created");
  const reader = new ControlPlaneHistoryReader(directory);
  expect(reader.read("message", "m")).toBeUndefined();
  expect(reader.page({ kind: "message" })).toEqual([]);
  expect(existsSync(directory)).toBe(false);
  const writer = new ControlPlaneHistoryStore(directory); stores.push(writer);
  writer.publishPage([{ kind: "message", id: "m", record: { body: "worker bytes" } }]);
  expect(reader.read("message", "m")).toEqual({ body: "worker bytes" });
  reader.close();
});

test("catalog version conflict rolls back the complete publication page", () => {
  const { store } = create();
  store.publishPage([{ kind: "message", id: "z", record: { body: "original" } }]);
  expect(() => store.publishPage([{ kind: "message", id: "a", record: { body: "new" } },
    { kind: "message", id: "z", record: { body: "conflict" } }])).toThrow("history_version_conflict");
  expect(store.read("message", "a")).toBeUndefined();
  expect(store.read("message", "z")).toEqual({ body: "original" });
});

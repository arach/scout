import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { SQLiteKnowledgeStore } from "./store.js";
import { knowledgeStorageUsage, KnowledgeStorageBudget } from "./storage-budget.js";
import { stripHarnessBoilerplate } from "./boilerplate.js";
import { indexRecentSessionKnowledge } from "./session-indexer.js";
import type { KnowledgeCollection, KnowledgeChunk } from "./types.js";
const roots: string[] = [];
const oldSupport = process.env.OPENSCOUT_SUPPORT_DIRECTORY;
const oldControl = process.env.OPENSCOUT_CONTROL_HOME;
afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
  if (oldSupport === undefined) delete process.env.OPENSCOUT_SUPPORT_DIRECTORY; else process.env.OPENSCOUT_SUPPORT_DIRECTORY = oldSupport;
  if (oldControl === undefined) delete process.env.OPENSCOUT_CONTROL_HOME; else process.env.OPENSCOUT_CONTROL_HOME = oldControl;
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "scout-knowledge-budget-")); roots.push(root);
  return { knowledgeRoot: root, sqlitePath: join(root, "knowledge.sqlite"), qmdRoot: join(root, "qmd") };
}
function put(store: SQLiteKnowledgeStore, paths: ReturnType<typeof fixture>, id: string, time: number, bytes = 16_000) {
  const text = randomBytes(bytes).toString("hex").match(/.{1,16}/g)!.join(" ");
  const collection: KnowledgeCollection = { id, kind: "sessions", title: id, qmdPath: join(paths.qmdRoot, id),
    status: "ready", contentHash: id, extractorVersion: "test", chunkPolicyVersion: "test", createdAt: time, updatedAt: time,
    facets: { harness: "codex", touchedPath: ["src/one.ts"] }, sourceRefs: [] };
  const chunk: KnowledgeChunk = { id: `c-${id}`, collectionId: id, documentId: `d-${id}`, documentPath: "events.md", ordinal: 0,
    text: `needle ${text}`, textHash: id, origin: "mechanical", ownership: "derived", sourceRefs: [], facets: { documentKind: "events" } };
  store.replaceCollection(collection, [{ id: chunk.documentId, collectionId: id, path: chunk.documentPath, kind: "events", origin: "mechanical", contentHash: id }], [{ chunk }], { "events.md": text, "manifest.json": "{}" });
}
test("pre-insert physical limit includes QMD and WAL; evicts oldest whole collections", () => {
  const paths = fixture(); const maxBytes = 2 * 1024 * 1024;
  const store = new SQLiteKnowledgeStore(paths.sqlitePath, paths, { maxBytes });
  try {
    for (let i = 0; i < 25; i++) {
      put(store, paths, `session-${i}`, i);
      expect(knowledgeStorageUsage(paths).totalBytes).toBeLessThanOrEqual(maxBytes);
    }
    expect(store.getCollection("session-0")).toBeNull();
    expect(existsSync(join(paths.qmdRoot, "session-0"))).toBe(false);
    expect(store.getCollection("session-24")?.status).toBe("ready");
    expect(store.assessCoverage().kind).toBe("bounded");
    const hit = store.searchLexical({ q: "needle", facets: { touchedPath: "src/one.ts" } })[0];
    expect(hit?.facets.touchedPath).toEqual(["src/one.ts"]);
  } finally { store.close(); }
  const db = new Database(paths.sqlitePath);
  expect(db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  const chunks = db.query("SELECT count(*) n FROM chunks").get() as { n: number };
  expect(db.query("SELECT count(*) n FROM chunks_fts").get()).toEqual(chunks);
  db.close();
});
test("a pinned WAL reader prevents further writes, rather than unbounded WAL growth", () => {
  const paths = fixture(); const store = new SQLiteKnowledgeStore(paths.sqlitePath, paths, { maxBytes: 2 * 1024 * 1024 });
  const reader = new Database(paths.sqlitePath, { readonly: true });
  try {
    reader.exec("BEGIN"); reader.query("SELECT * FROM collections").all();
    store.createIndexJob({ source: "sessions" });
    const before = knowledgeStorageUsage(paths);
    expect(() => store.createIndexJob({ source: "sessions" })).toThrow("reader is holding the WAL");
    expect(knowledgeStorageUsage(paths).totalBytes).toBe(before.totalBytes);
  } finally { reader.exec("ROLLBACK"); reader.close(); store.close(); }
}, 15_000);
test("oversized collection never publishes partial rows or QMD", () => {
  const paths = fixture(); const store = new SQLiteKnowledgeStore(paths.sqlitePath, paths, { maxBytes: 1024 * 1024 });
  try {
    expect(() => put(store, paths, "huge", 1, 3 * 1024 * 1024)).toThrow("cannot fit");
    expect(store.getCollection("huge")).toBeNull();
    expect(existsSync(join(paths.qmdRoot, "huge"))).toBe(false);
    expect(knowledgeStorageUsage(paths).totalBytes).toBeLessThanOrEqual(1024 * 1024);
  } finally { store.close(); }
});
test("second writer is refused, while readers are allowed", () => {
  const paths = fixture(); const store = new SQLiteKnowledgeStore(paths.sqlitePath, paths);
  try {
    expect(() => new SQLiteKnowledgeStore(paths.sqlitePath, paths)).toThrow("another writer");
    const reader = new SQLiteKnowledgeStore(paths.sqlitePath, paths, { readonly: true }); reader.close();
  } finally { store.close(); }
  const next = new SQLiteKnowledgeStore(paths.sqlitePath, paths); next.close();
});
test("legacy VACUUM refuses insufficient or unknown free disk", () => {
  const paths = fixture(); const db = new Database(paths.sqlitePath);
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE big (text); INSERT INTO big VALUES (zeroblob(100000)); DELETE FROM big;");
  const budget = new KnowledgeStorageBudget(db, paths, () => false, { freeDiskBytes: () => 0 });
  expect(() => budget.reclaim()).toThrow("2×");
  db.close();
});
test("default-off index calls do not discover, create a DB, or create a job", async () => {
  const paths = fixture(); process.env.OPENSCOUT_SUPPORT_DIRECTORY = join(paths.knowledgeRoot, "support"); process.env.OPENSCOUT_CONTROL_HOME = join(paths.knowledgeRoot, "control");
  const result = await indexRecentSessionKnowledge();
  expect(result.enabled).toBe(false); expect(result.failed).toBe(0); expect(result.message).toContain("Settings › System");
  expect(existsSync(process.env.OPENSCOUT_CONTROL_HOME)).toBe(false);
  mkdirSync(process.env.OPENSCOUT_SUPPORT_DIRECTORY);
  writeFileSync(join(process.env.OPENSCOUT_SUPPORT_DIRECTORY, "settings.json"), JSON.stringify({ version: 1 }));
  expect((await indexRecentSessionKnowledge()).enabled).toBe(false);
});
test("removes multiple and truncated harness blocks, preserves the actual request", () => {
  expect(stripHarnessBoilerplate("<recommended_plugins>massive list</recommended_plugins>\nFix parser\n<system-reminder>instruction</system-reminder> <local-command-caveat>local</local-command-caveat>")).toBe("Fix parser");
  expect(stripHarnessBoilerplate("Keep this <system-reminder>truncated")).toBe("Keep this");
});

test("startup evicts legacy QMD larger than the entire cap, oldest first", () => {
  const paths = fixture(); const large = new SQLiteKnowledgeStore(paths.sqlitePath, paths);
  put(large, paths, "old", 1, 1000); put(large, paths, "recent", 2, 1000); large.close();
  writeFileSync(join(paths.qmdRoot, "old", "legacy.md"), Buffer.alloc(3 * 1024 * 1024));
  const bounded = new SQLiteKnowledgeStore(paths.sqlitePath, paths, { maxBytes: 2 * 1024 * 1024 });
  try {
    expect(bounded.getCollection("old")).toBeNull();
    expect(bounded.getCollection("recent")).not.toBeNull();
    expect(knowledgeStorageUsage(paths).totalBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
  } finally { bounded.close(); }
});

test("rejects symlinked QMD roots and descendants before maintenance can delete external files", () => {
  for (const child of [false, true]) {
    const paths = fixture(); const outside = fixture().knowledgeRoot;
    mkdirSync(join(outside, "victim"));
    writeFileSync(join(outside, "victim", "manifest.json"), "{}");
    writeFileSync(join(outside, "victim", "sentinel"), "source data");
    if (child) mkdirSync(paths.qmdRoot);
    symlinkSync(outside, child ? join(paths.qmdRoot, "linked") : paths.qmdRoot);
    expect(() => new SQLiteKnowledgeStore(paths.sqlitePath, paths)).toThrow("symlinked QMD");
    expect(existsSync(join(outside, "victim", "sentinel"))).toBe(true);
    expect(existsSync(`${paths.sqlitePath}.writer`)).toBe(false);
  }
});

test("legacy duplicated facets migrate to one collection fact without losing filters", () => {
  const paths = fixture(); const first = new SQLiteKnowledgeStore(paths.sqlitePath, paths); put(first, paths, "legacy-facets", 1); first.close();
  const legacy = new Database(paths.sqlitePath);
  legacy.exec("PRAGMA user_version=2; DROP INDEX idx_chunks_document;");
  legacy.query("INSERT INTO facets(collection_id,chunk_id,key,value) VALUES (?,?,?,?)").run("legacy-facets", "c-legacy-facets", "toolName", "Read");
  legacy.query("INSERT INTO facets(collection_id,chunk_id,key,value) VALUES (?,?,?,?)").run("legacy-facets", "c-legacy-facets", "toolName", "Read");
  legacy.query("UPDATE chunks SET facets_json=?").run(JSON.stringify({ documentKind: "events", toolName: ["Read"] })); legacy.close();
  const migrated = new SQLiteKnowledgeStore(paths.sqlitePath, paths);
  expect(migrated.searchLexical({ q: "needle", facets: { toolName: "Read" } }).length).toBeGreaterThan(0); migrated.close();
  const db = new Database(paths.sqlitePath, { readonly: true });
  expect(db.query("SELECT chunk_id,key,value FROM facets WHERE key='toolName'").all()).toEqual([{ chunk_id: null, key: "toolName", value: "Read" }]);
  expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]); db.close();
});

test("read-only legacy coverage does not require the new storage metadata table", () => {
  const paths = fixture(); const first = new SQLiteKnowledgeStore(paths.sqlitePath, paths); put(first, paths, "old-reader", 1); first.close();
  const legacy = new Database(paths.sqlitePath); legacy.exec("DROP TABLE storage_state"); legacy.close();
  const reader = new SQLiteKnowledgeStore(paths.sqlitePath, paths, { readonly: true });
  try { expect(reader.assessCoverage().kind).toBe("not_warmed"); } finally { reader.close(); }
});

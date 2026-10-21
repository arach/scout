import { afterEach, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteKnowledgeStore } from "./store.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "scout-knowledge-schema-")); roots.push(root);
  return { knowledgeRoot: root, sqlitePath: join(root, "knowledge.sqlite"), qmdRoot: join(root, "qmd") };
}

// Pause the actual constructor's schema exec exactly before index_jobs. A second
// connection runs on the same thread, so this cannot depend on polling or luck.
function duringBootstrap(observe: (paths: ReturnType<typeof fixture>) => void) {
  const paths = fixture(), exec = Database.prototype.exec;
  let paused = false;
  const intercept = spyOn(Database.prototype, "exec").mockImplementation(function (this: Database, sql: string, ...bindings: any[]) {
    const split = sql.indexOf("CREATE TABLE IF NOT EXISTS index_jobs (");
    if (!paused && split >= 0) {
      paused = true;
      exec.call(this, sql.slice(0, split));
      observe(paths);
      return exec.call(this, sql.slice(split));
    }
    return exec.call(this, sql, ...bindings);
  });
  let writer: SQLiteKnowledgeStore | undefined;
  try {
    writer = new SQLiteKnowledgeStore(paths.sqlitePath, paths);
    expect(paused).toBe(true);
    expect(writer.status().activeJobs).toEqual([]);
  } finally { intercept.mockRestore(); writer?.close(); }
}

test("fresh bootstrap publishes all schema tables atomically to another connection", () => {
  let tables: unknown[] = [];
  duringBootstrap((paths) => {
    const reader = new Database(paths.sqlitePath, { readonly: true });
    try { tables = reader.query("SELECT name FROM sqlite_master WHERE type='table'").all(); }
    finally { reader.close(); }
  });
  expect(tables).toEqual([]);
});

test("status during fresh bootstrap is an empty read, not a missing index_jobs error", () => {
  let error: unknown, status: ReturnType<SQLiteKnowledgeStore["status"]> | undefined;
  duringBootstrap((paths) => {
    let reader: SQLiteKnowledgeStore | undefined;
    try { reader = new SQLiteKnowledgeStore(paths.sqlitePath, paths, { readonly: true }); status = reader.status(); }
    catch (cause) { error = cause; }
    finally { reader?.close(); }
  });
  expect(error).toBeUndefined();
  expect(status?.collections).toBe(0);
  expect(status?.chunks).toBe(0);
  expect(status?.activeJobs).toEqual([]);
  expect(status?.warmSpans).toEqual([]);
});

test("failed bootstrap rolls back its DDL and releases the writer for retry", () => {
  const paths = fixture(), exec = Database.prototype.exec;
  const intercept = spyOn(Database.prototype, "exec").mockImplementation(function (this: Database, sql: string, ...bindings: any[]) {
    const split = sql.indexOf("CREATE TABLE IF NOT EXISTS index_jobs (");
    if (split >= 0) {
      exec.call(this, sql.slice(0, split));
      throw new Error("fixture interrupted bootstrap");
    }
    return exec.call(this, sql, ...bindings);
  });
  try { expect(() => new SQLiteKnowledgeStore(paths.sqlitePath, paths)).toThrow("fixture interrupted bootstrap"); }
  finally { intercept.mockRestore(); }
  const disk = new Database(paths.sqlitePath, { readonly: true });
  try { expect(disk.query("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([]); }
  finally { disk.close(); }
  const retry = new SQLiteKnowledgeStore(paths.sqlitePath, paths);
  try { expect(retry.createIndexJob({ source: "sessions" }).state).toBe("queued"); }
  finally { retry.close(); }
});

for (const missing of ["collections", "documents", "chunks", "chunks_fts", "facets", "source_refs", "index_jobs", "warm_spans", "storage_state"]) {
  test(`read-only cache missing ${missing} is empty without repairing the on-disk schema`, () => {
    const paths = fixture();
    new SQLiteKnowledgeStore(paths.sqlitePath, paths).close();
    const legacy = new Database(paths.sqlitePath);
    legacy.exec("PRAGMA foreign_keys=OFF");
    legacy.exec(`INSERT INTO collections VALUES ('legacy','sessions','legacy','[]','unused','ready','hash','v1','v1',1,1,'{}')`);
    legacy.exec(`DROP TABLE ${missing}`);
    const schema = legacy.query("SELECT name, sql FROM sqlite_master ORDER BY name").all();
    const version = legacy.query("PRAGMA schema_version").get();
    try {
      const reader = new SQLiteKnowledgeStore(paths.sqlitePath, paths, { readonly: true });
      try {
        const status = reader.status();
        expect(status.collections).toBe(0);
        expect(status.chunks).toBe(0);
        expect(status.activeJobs).toEqual([]);
        expect(status.warmSpans).toEqual([]);
        expect(reader.searchLexical({ q: "needle" })).toEqual([]);
        expect(reader.assessCoverage().kind).toBe("empty_index");
      } finally { reader.close(); }
      expect(legacy.query("SELECT name, sql FROM sqlite_master ORDER BY name").all()).toEqual(schema);
      expect(legacy.query("PRAGMA schema_version").get()).toEqual(version);
    } finally { legacy.close(); }
  });
}

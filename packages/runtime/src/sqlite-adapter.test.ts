import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GuestGrantStore } from "./guest-access.js";
import { openRuntimeSqliteDatabase, type ControlPlaneSqliteTransactionalDatabase } from "./sqlite-adapter.js";

function afterFirstGrantRead(db: ControlPlaneSqliteTransactionalDatabase, afterRead: () => void): ControlPlaneSqliteTransactionalDatabase {
  let pending = true;
  return {
    exec: sql => db.exec(sql),
    transaction: callback => db.transaction(callback),
    query(sql) {
      const statement = db.query(sql);
      return {
        all: (...params) => statement.all(...params) as never[],
        run: (...params) => statement.run(...params),
        get: (...params) => {
          const row = statement.get(...params);
          if (pending && sql === "SELECT * FROM guest_grants WHERE request_id = ?1") {
            pending = false;
            afterRead();
          }
          return row as never;
        },
      };
    },
  };
}

// Also compiled and executed in a real Node process below, not Bun's node:sqlite shim.
function assertTransactionContract(db: ControlPlaneSqliteTransactionalDatabase, other: ControlPlaneSqliteTransactionalDatabase, check: typeof assert): void {
  db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000; CREATE TABLE entries (id INTEGER PRIMARY KEY)");
  other.exec("PRAGMA busy_timeout=0");
  let callbacks = 0;
  const outer = db.transaction((id: number) => {
    callbacks += 1;
    // No SELECT has run yet: this proves writer reservation precedes the callback.
    check.throws(() => other.exec("INSERT INTO entries VALUES (90)"), /locked|busy/i);
    db.query("SELECT * FROM entries").all();
    check.throws(() => other.exec("INSERT INTO entries VALUES (91)"), /locked|busy/i);
    db.query("INSERT INTO entries VALUES (?)").run(id);
    check.throws(() => db.transaction(() => {
      db.exec("INSERT INTO entries VALUES (2)");
      throw new Error("nested rollback");
    })(), /nested rollback/);
    db.exec("INSERT INTO entries VALUES (3)");
    return "committed";
  });
  check.equal(outer(1), "committed");
  check.equal(callbacks, 1);
  check.deepEqual(db.query<{ id: number }>("SELECT id FROM entries ORDER BY id").all().map(row => row.id), [1, 3]);
  check.throws(() => db.transaction(() => {
    db.exec("INSERT INTO entries VALUES (4)");
    db.transaction(() => db.exec("INSERT INTO entries VALUES (5)"))();
    throw new Error("outer rollback");
  })(), /outer rollback/);
  other.exec("INSERT INTO entries VALUES (6)");
  check.deepEqual(db.query<{ id: number }>("SELECT id FROM entries ORDER BY id").all().map(row => row.id), [1, 3, 6]);
}

describe("runtime SQLite writer transaction contract", () => {
  for (const immediate of [false, true]) {
    test(`${immediate ? "runtime immediate" : "native deferred baseline"}: guest installation under a concurrent WAL writer`, () => {
      const directory = mkdtempSync(join(tmpdir(), "scout-sqlite-guest-"));
      const path = join(directory, "test.db");
      const primary = (immediate ? openRuntimeSqliteDatabase(path) : new Database(path)) as ControlPlaneSqliteTransactionalDatabase;
      const other = new Database(path);
      try {
        primary.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000; CREATE TABLE projection_writes (id INTEGER PRIMARY KEY)");
        other.exec("PRAGMA busy_timeout=0");
        let hookCalls = 0;
        let competingWriteError: unknown;
        const grants = new GuestGrantStore(afterFirstGrantRead(primary, () => {
          hookCalls += 1;
          try { other.exec("INSERT INTO projection_writes VALUES (1)"); }
          catch (error) { competingWriteError = error; }
        }));
        const key = generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }).toString("base64");
        const input = { requestId: "request-1", clientPublicKey: key, label: "Synthetic guest", allowedTargets: ["owned.agent"] };
        const now = 1_800_000_000_000;
        if (immediate) {
          const first = grants.install(input, now);
          expect(first.created).toBe(true);
          expect(String(competingWriteError)).toMatch(/locked|busy/i);
          const retry = grants.install(input, now + 1_000);
          expect(retry.created).toBe(false);
          expect(retry.grant).toEqual(first.grant);
          expect(() => grants.install({ ...input, allowedTargets: ["other.agent"] }, now)).toThrow(/different grant/);
          expect(grants.list()).toHaveLength(1);
          other.exec("INSERT INTO projection_writes VALUES (2)");
          expect(other.query("SELECT id FROM projection_writes").all()).toEqual([{ id: 2 }]);
        } else {
          expect(() => grants.install(input, now)).toThrow(/locked|busy/i);
          expect(competingWriteError).toBeUndefined();
          expect(grants.list()).toHaveLength(0);
          expect(other.query("SELECT id FROM projection_writes").all()).toEqual([{ id: 1 }]);
        }
        expect(hookCalls).toBe(1);
      } finally { primary.close?.(); other.close(); rmSync(directory, { recursive: true, force: true }); }
    });
  }

  test("Bun reserves before callback and preserves arguments, return, nested rollback and outer rollback", () => {
    const directory = mkdtempSync(join(tmpdir(), "scout-sqlite-bun-"));
    const path = join(directory, "test.db");
    const db = openRuntimeSqliteDatabase(path) as ControlPlaneSqliteTransactionalDatabase;
    const other = openRuntimeSqliteDatabase(path) as ControlPlaneSqliteTransactionalDatabase;
    try { assertTransactionContract(db, other, assert); }
    finally { db.close?.(); other.close?.(); rmSync(directory, { recursive: true, force: true }); }
  });

  test("Bun keeps native explicit transaction modes, receiver, database and statement capabilities", () => {
    const db = openRuntimeSqliteDatabase(":memory:") as unknown as Database;
    try {
      db.exec("CREATE TABLE entries (id INTEGER PRIMARY KEY)");
      const receiver = { value: 42 };
      const transaction = db.transaction(function (this: typeof receiver, id: number) {
        db.prepare("INSERT INTO entries VALUES (?)").run(id);
        return this.value;
      });
      expect(transaction.call(receiver, 1)).toBe(42);
      expect(transaction.deferred.call(receiver, 2)).toBe(42);
      expect(transaction.immediate.call(receiver, 3)).toBe(42);
      expect(transaction.exclusive.call(receiver, 4)).toBe(42);
      expect((transaction as unknown as { default: typeof transaction }).default.call(receiver, 5)).toBe(42);
      expect(transaction.database instanceof Database).toBe(true);
      expect(db instanceof Database).toBe(true);
      expect(db.query("SELECT id FROM entries")).toBe(db.query("SELECT id FROM entries"));
      expect(db.query("SELECT id FROM entries ORDER BY id").values()).toEqual([[1], [2], [3], [4], [5]]);
    } finally { db.close(); }
  });

  test("actual Node retains the same immediate and nested transaction contract", async () => {
    const directory = mkdtempSync(join(tmpdir(), "scout-sqlite-node-"));
    try {
      const entrypoint = join(directory, "probe.ts");
      writeFileSync(entrypoint, `import assert from 'node:assert/strict';
import { openRuntimeSqliteDatabase } from ${JSON.stringify(join(import.meta.dir, "sqlite-adapter.ts"))};
assert.equal(typeof globalThis.Bun, 'undefined');
const db = openRuntimeSqliteDatabase(${JSON.stringify(join(directory, "test.db"))});
const other = openRuntimeSqliteDatabase(${JSON.stringify(join(directory, "test.db"))});
try { (${assertTransactionContract.toString()})(db, other, assert); console.log('node-immediate-contract: passed'); }
finally { db.close(); other.close(); }
`);
      const built = await Bun.build({ entrypoints: [entrypoint], outdir: directory, naming: "probe.mjs", target: "node" });
      expect(built.success).toBe(true);
      const child = Bun.spawn(["node", join(directory, "probe.mjs")], {
        env: { ...process.env, OPENSCOUT_RUNTIME_HOST: "node" }, stdout: "pipe", stderr: "pipe",
      });
      const deadline = setTimeout(() => child.kill("SIGKILL"), 5_000);
      try {
        const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        expect({ exitCode, stderr: stderr.replace(/\(node:\d+\) ExperimentalWarning:[^\n]*\n(?:\(Use `node[^\n]*\n)?/g, "") }).toEqual({ exitCode: 0, stderr: "" });
        expect(stdout.trim()).toBe("node-immediate-contract: passed");
      } finally {
        clearTimeout(deadline);
        if (child.exitCode === null) child.kill("SIGKILL");
        await child.exited;
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 10_000);
});

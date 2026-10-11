import { expect, test } from "bun:test";
import { handleBrokerQuarantineRoute, type BrokerQuarantineQueries } from "./broker-quarantine-http-service.js";
import { BrokerQuarantine } from "./broker-quarantine.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function call(path: string, queries?: BrokerQuarantineQueries, method = "GET", remote = false) {
  let status = 0; let value: any;
  const handled = await handleBrokerQuarantineRoute({ method, ...(remote ? { transportContext: { transport: "remote" } } : {}) } as never,
    {} as never, new URL(path, "http://localhost"), queries, (_res, code, data) => { status = code; value = data; });
  return { handled, status, value };
}
test("local acknowledgement suppresses only the scoped warning and preserves exact bytes across reopen", async () => {
  const directory = mkdtempSync(join(tmpdir(), "scout-quarantine-http-"));
  const file = join(directory, "quarantine.sqlite");
  let store = new BrokerQuarantine(file);
  const queries: BrokerQuarantineQueries = { status: () => store.status(), list: input => store.list(input),
    read: id => store.read(id), acknowledge: id => store.acknowledge(id) };
  try {
    const bytes = Buffer.from([0, 255, 10, 13, 195, 40]);
    const entry = store.preserve({ kind: "message.append", reason: "malformed source", bytes,
      source: { path: "journal.jsonl", startByte: 10, endByte: 16 }, entries: [{ message: { id: "bad-message", actorId: "session:bad", body: null } }] });
    const list = await call("/v1/quarantine?sessionId=session%3Abad", queries);
    expect(list.status).toBe(200); expect(list.value.status.openCount).toBe(1);
    expect(list.value.records.map((row: any) => row.id)).toEqual([entry.id]);
    expect(list.value.records[0].payload).toBeUndefined();
    expect((await call("/v1/quarantine?sessionId=session%3Ahealthy", queries)).value.records).toEqual([]);
    expect((await call(`/v1/quarantine/${entry.id}/acknowledge`, queries, "POST")).value.record.status).toBe("acknowledged");
    store.close(); store = new BrokerQuarantine(file);
    const after = await call(`/v1/quarantine/${entry.id}`, queries);
    expect(Buffer.from(after.value.record.payload, "base64")).toEqual(bytes);
    expect(after.value.record.source).toEqual({ path: "journal.jsonl", startByte: 10, endByte: 16 });
    expect(after.value.record.status).toBe("acknowledged");
    expect((await call("/v1/quarantine", queries)).value.records).toEqual([]);
    expect((await call("/v1/quarantine?status=acknowledged", queries)).value.records.length).toBe(1);
    expect((await call(`/v1/quarantine/${entry.id}/acknowledge`, queries, "POST")).status).toBe(200);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
test("quarantine is local, bounded, and distinguishes storage errors from missing evidence", async () => {
  const id = `quarantine-${"f".repeat(64)}`;
  const queries: BrokerQuarantineQueries = { status: () => ({ openCount: 0, acknowledgedCount: 0, samples: [] }),
    list: () => [], read: () => null, acknowledge: () => null };
  expect((await call("/v1/quarantine", queries, "GET", true)).status).toBe(403);
  expect((await call(`/v1/quarantine/${id}/acknowledge`, queries, "POST", true)).status).toBe(403);
  for (const path of ["?limit=0", "?limit=101", "?limit=1.5", "?status=deleted", "?sessionId="]) {
    expect((await call(`/v1/quarantine${path}`, queries)).status).toBe(400);
  }
  expect((await call(`/v1/quarantine/${id}/acknowledge`, queries)).status).toBe(405);
  expect((await call(`/v1/quarantine/${id}`, queries, "DELETE")).status).toBe(405);
  expect((await call(`/v1/quarantine/${id}`, queries)).status).toBe(404);
  expect((await call(`/v1/quarantine/${id}/acknowledge`, queries, "POST")).status).toBe(404);
  expect((await call("/v1/quarantine")).status).toBe(503);
  expect((await call("/v1/quarantine", { ...queries, list: () => { throw new Error("ledger unavailable"); } })).status).toBe(503);
  expect((await call("/v1/quarantine/%zz", queries)).status).toBe(400);
  expect((await call("/v1/unrelated", queries)).handled).toBe(false);
});

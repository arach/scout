import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrokerRequestReceipts } from "./broker-request-receipts.js";

describe("broker requester-scoped request receipts", () => {
  test("concurrent calls and reopened ledger return original receipt; changed content conflicts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scout-receipts-"));
    try {
      const ledger = new BrokerRequestReceipts(dir);
      let calls = 0;
      const execute = async () => { calls++; await Bun.sleep(10); return { flightId: "flt-1" }; };
      const results = await Promise.all([ledger.run("scoutbot", "key", "deliver", { body: "build" }, execute), ledger.run("scoutbot", "key", "deliver", { body: "build" }, execute)]);
      expect(results).toEqual([{ flightId: "flt-1" }, { flightId: "flt-1" }]);
      expect(calls).toBe(1);
      expect(await new BrokerRequestReceipts(dir).run("scoutbot", "key", "deliver", { body: "build" }, execute)).toEqual(results[0]);
      await expect(ledger.run("scoutbot", "key", "deliver", { body: "different" }, execute)).rejects.toThrow("different content");
      await ledger.run("other-agent", "key", "deliver", { body: "build" }, execute);
      expect(calls).toBe(2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  test("ambiguous acceptance is never re-executed, even across reopen", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scout-receipts-"));
    try {
      let calls = 0;
      await expect(new BrokerRequestReceipts(dir).run("scoutbot", "key", "deliver", {}, async () => { calls++; throw new Error("lost receipt"); })).rejects.toThrow();
      await expect(new BrokerRequestReceipts(dir).run("scoutbot", "key", "deliver", {}, async () => { calls++; return {}; })).rejects.toThrow("request_outcome_unknown");
      expect(calls).toBe(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

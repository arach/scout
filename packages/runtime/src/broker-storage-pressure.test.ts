import { expect, test } from "bun:test";
import { BrokerCommandAdmission, BrokerBusyError } from "./broker-storage-pressure.js";
import { BrokerRequestReceipts } from "./broker-request-receipts.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("acceptance capacity rejects before request reservation and reopens after release", async () => {
  const root = mkdtempSync(join(tmpdir(), "scout-admission-"));
  try {
    const admission = new BrokerCommandAdmission({ maxCommands: 1 }); const ledger = new BrokerRequestReceipts(root);
    const release = admission.reserve({ body: "existing" }); let executions = 0;
    const run = () => ledger.run("operator", "retry-key", "deliver", {}, async () => { executions++; return { accepted: true }; }, undefined, () => admission.reserve({}));
    await expect(run()).rejects.toBeInstanceOf(BrokerBusyError);
    expect(await ledger.get("operator", "retry-key", "deliver")).toBeNull(); expect(executions).toBe(0);
    release(); release(); expect(admission.status().pendingCommands).toBe(0);
    expect(await run()).toEqual({ accepted: true }); expect(executions).toBe(1);
    const second = admission.reserve({}); expect(await run()).toEqual({ accepted: true }); second();
    expect(executions).toBe(1); expect(admission.status().pendingBytes).toBe(0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("byte and disk reserves are explicit pressure instead of a dropped command", () => {
  expect(() => new BrokerCommandAdmission({ maxBytes: 4 }).reserve({ body: "large" })).toThrow("capacity");
  expect(() => new BrokerCommandAdmission({ pressure: () => "disk full" }).reserve({})).toThrow("same request ID");
});

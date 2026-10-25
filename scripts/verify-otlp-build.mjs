import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { otlpBaseUrl, otlpPaths } from "../packages/runtime/dist/otlp/config.js";

const run = promisify(execFile);
const entry = fileURLToPath(new URL("../packages/runtime/bin/openscout-runtime.mjs", import.meta.url));

test("compiled Node standalone OTLP serve/status/tail and graceful shutdown", { timeout: 15_000 }, async () => {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const directory = await mkdtemp(join(tmpdir(), "scout-otlp-node-smoke-"));
  const child = spawn(process.execPath, [entry, "otel", "serve", "--database", join(directory, "observations.sqlite"), "--port", String(port)], {
    stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, OPENSCOUT_RUNTIME_ENTRYPOINT: "dist" },
  });
  const exited = once(child, "exit");
  let errors = "";
  child.stderr.on("data", (chunk) => { errors = (errors + String(chunk)).slice(-4000); });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`OTLP standalone startup timeout: ${errors}`)), 5000);
      let output = "";
      const earlyExit = () => { clearTimeout(timeout); reject(new Error(`OTLP standalone exited during startup: ${errors}`)); };
      child.once("exit", earlyExit);
      child.stdout.on("data", (chunk) => {
        output += String(chunk);
        if (output.includes("Scout OTLP inspection receiver listening")) {
          clearTimeout(timeout);
          child.off("exit", earlyExit);
          resolve();
        }
      });
    });
    const base = otlpBaseUrl(port);
    const response = await fetch(new URL(otlpPaths.logs, base), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resourceLogs: [{ resource: { attributes: [{ key: "service.name", value: { stringValue: "synthetic-node-smoke" } }] }, scopeLogs: [{ logRecords: [{ timeUnixNano: "1789872335795123456", body: { stringValue: "NEVER STORE THIS" } }] }] }] }),
    });
    assert.equal(response.status, 200);
    let persisted = [];
    for (let attempt = 0; attempt < 40; attempt++) {
      persisted = await (await fetch(new URL(otlpPaths.observations, base))).json();
      if (persisted.length === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(persisted.length, 1);
    const status = await run(process.execPath, [entry, "otel", "status", "--port", String(port)], { timeout: 5000 });
    assert.equal(JSON.parse(status.stdout).accepted.logs, 1);
    const tail = await run(process.execPath, [entry, "otel", "tail", "--port", String(port), "--limit", "1"], { timeout: 5000 });
    const record = JSON.parse(tail.stdout.trim());
    assert.equal(record.resource["service.name"], "synthetic-node-smoke");
    assert.equal(record.data.timeUnixNano, "1789872335795123456");
    assert.ok(!tail.stdout.includes("NEVER STORE THIS"));
    child.kill("SIGTERM");
    const [code] = await exited;
    assert.equal(code, 0);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
      await exited;
      clearTimeout(timer);
    }
    await rm(directory, { recursive: true, force: true });
  }
});

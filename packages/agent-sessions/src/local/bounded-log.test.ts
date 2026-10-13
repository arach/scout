import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendBoundedLog, boundedLogPipeCommand } from "./bounded-log.js";
const roots: string[] = [];
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });
function fixture() { const root = mkdtempSync(join(tmpdir(), "scout-bounded-log-")); roots.push(root); return join(root, "stdout.log"); }
test("rotates at the byte ceiling and retains exactly one old file", async () => {
  const path = fixture();
  await appendBoundedLog(path, "abcdefghij", 10);
  await appendBoundedLog(path, "klmnopqrstuv", 10);
  expect(readFileSync(`${path}.1`, "utf8")).toBe("klmnopqrst");
  expect(readFileSync(path, "utf8")).toBe("uv");
});
test("bounds oversized existing logs, large UTF-8 writes, and concurrent callbacks", async () => {
  const path = fixture();
  writeFileSync(path, "old".repeat(1000));
  writeFileSync(`${path}.1`, "older".repeat(1000));
  await Promise.all(Array.from({ length: 12 }, () => appendBoundedLog(path, "🙂".repeat(25), 100)));
  expect(statSync(path).size).toBe(100);
  expect(statSync(`${path}.1`).size).toBe(100);
  expect(readFileSync(path, "utf8")).toBe("🙂".repeat(25));
});

test("tmux pipe runs under Bun and Node ESM with shell metacharacters in its paths", () => {
  const path = fixture() + " ' $dollar `uname`";
  const bun = spawnSync("/bin/sh", ["-c", boundedLogPipeCommand(path)], { input: "bounded log output" });
  expect(bun.status).toBe(0); expect(readFileSync(path, "utf8")).toBe("bounded log output");
  const node = spawnSync("/bin/sh", ["-c", boundedLogPipeCommand(path, "node")], {
    input: " node output", env: { ...process.env, NODE_OPTIONS: "--no-experimental-detect-module" },
  });
  expect(node.status).toBe(0); expect(readFileSync(path, "utf8")).toBe("bounded log output node output");
});


test("tmux log pipe remains self-contained when bundled into a server entry", async () => {
  const path = fixture();
  const entry = fixture() + ".ts";
  writeFileSync(entry, `export { boundedLogPipeCommand } from ${JSON.stringify(fileURLToPath(import.meta.resolve("./bounded-log.ts")))};`);
  const build = await Bun.build({ entrypoints: [entry], target: "bun", minify: true });
  expect(build.success).toBe(true);
  const output = fixture() + ".mjs";
  writeFileSync(output, await build.outputs[0]!.text());
  const bundled = await import(pathToFileURL(output).href);
  const piped = spawnSync("/bin/sh", ["-c", bundled.boundedLogPipeCommand(path)], { input: "bundled output" });
  expect(piped.stderr.toString()).toBe(""); expect(piped.status).toBe(0);
  expect(readFileSync(path, "utf8")).toBe("bundled output");
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

test("imported CLI output drains a slow pipe beyond 64 KiB before forced exit", async () => {
  const root = mkdtempSync(join(tmpdir(), "scout-drain-"));
  try {
    mkdirSync(join(root, "bin"));
    mkdirSync(join(root, "dist", "node"), { recursive: true });
    for (const name of ["scout.mjs", "lifecycle-preflight.mjs", "bun-preflight.mjs"]) {
      copyFileSync(new URL("../bin/" + name, import.meta.url), join(root, "bin", name));
    }
    writeFileSync(join(root, "package.json"), '{"version":"0.0.0"}');
    const payload = { agents: Array.from({ length: 4000 }, (_, i) => ({ id: i, text: "x".repeat(80) })) };
    const expected = JSON.stringify(payload) + "\n";
    writeFileSync(join(root, "dist", "node", "main.mjs"), `process.stdout.write(${JSON.stringify(expected)});`);
    for (const runtime of ["node", "bun"]) {
      const child = spawn(runtime, [join(root, "bin", "scout.mjs"), "--json", "who"], {
        env: { ...process.env, OPENSCOUT_RUNTIME_HOST: "node" }, stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", chunk => {
        output += chunk;
        child.stdout.pause();
        setTimeout(() => child.stdout.resume(), 5);
      });
      let stderr = "";
      child.stderr.on("data", chunk => { stderr += chunk; });
      const code = await new Promise((resolve, reject) => {
        child.on("error", reject); child.on("close", resolve);
      });
      assert.equal(code, 0, stderr);
      assert.equal(output.length, expected.length, runtime);
      assert.deepEqual(JSON.parse(output), payload);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

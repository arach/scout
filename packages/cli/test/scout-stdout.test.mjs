import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { isolatedEnvironment, packageDirectory, temporaryDirectory } from "./helpers/cli-fixture.mjs";

const fixture = temporaryDirectory("scout-stdout-");
mkdirSync(join(fixture, "bin"));
mkdirSync(join(fixture, "dist", "node"), { recursive: true });
for (const name of ["scout.mjs", "lifecycle-preflight.mjs", "bun-preflight.mjs"]) {
  copyFileSync(join(packageDirectory, "bin", name), join(fixture, "bin", name));
}
writeFileSync(join(fixture, "package.json"), '{"type":"module","version":"0.0.0"}');
const payload = { rows: Array.from({ length: 6_000 }, (_, id) => ({ id, title: "mini → project ".repeat(12) })), end: "last-row-present" };
const output = `${JSON.stringify(payload, null, 2)}\n`;
const stderr = "diagnostic\n".repeat(30_000);
// Use the real CLI writer. Its isTTY check initializes process.stdout before
// output, which exposes Bun's native console buffering difference.
const contextModule = join(fixture, "dist/context.mjs");
execFileSync("bun", ["build", resolve(packageDirectory, "../../packages/cli/src/cli/context.ts"), "--target=node", "--format=esm", "--outfile", contextModule], { stdio: "pipe" });
// Deliberately leave a live handle: simply removing process.exit would hang.
const entry = `import { createScoutCommandContext } from ${JSON.stringify(pathToFileURL(contextModule).href)};\nconst context = createScoutCommandContext({ outputMode: "json" });\ncontext.output.writeValue(${JSON.stringify(payload)});\nif (!process.env.TEST_STDOUT_ONLY) context.stderr(${JSON.stringify(stderr.slice(0, -1))});\nprocess.exitCode = Number(process.env.TEST_EXIT_CODE ?? "0");\nif (!process.env.TEST_NATURAL_EXIT) setInterval(() => {}, 1000);\nif (process.env.TEST_PERSISTENT) setTimeout(() => { context.stdout("after import"); process.exit(0); }, 150);\n`;
for (const file of ["main.mjs", "node/main.mjs", "chat.mjs"]) writeFileSync(join(fixture, "dist", file), entry);

for (const [name, executable, env, args] of [
  ["Bun in-process", "bun", {}, ["who", "--json"]],
  ["Bun stdout only", "bun", { TEST_STDOUT_ONLY: "1" }, ["who", "--json"]],
  ["Node in-process", process.execPath, { OPENSCOUT_RUNTIME_HOST: "node", TEST_EXIT_CODE: "7" }, ["who", "--json"]],
  ["Node spawning Bun", process.execPath, { OPENSCOUT_RUNTIME_HOST: "bun" }, ["who", "--json"]],
  ["standalone chat", "bun", { TEST_NATURAL_EXIT: "1" }, ["chat", "--json"]],
  ["leading global flag", "bun", {}, ["--json", "who"]],
  ["relay compatibility prefix", "bun", {}, ["relay", "who", "--json"]],
  ["recent", "bun", {}, ["recent", "--json"]],
  ["Node recent with leading global flag", process.execPath, { OPENSCOUT_RUNTIME_HOST: "node" }, ["--json", "recent"]],
]) {
  test(`${name} drains large piped output before forced exit and preserves exitCode`, { timeout: 10_000 }, async () => {
    const child = spawn(executable, [join(fixture, "bin/scout.mjs"), ...args], { env: isolatedEnvironment(env), stdio: ["ignore", "pipe", "pipe"] });
    const stdoutChunks = [];
    const stderrChunks = [];
    const completion = new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code, signal) => resolve({ code, signal }));
    });
    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.stdout.pause();
    child.stderr.pause();
    // Let the child fill the pipes, like a slow downstream JSON consumer.
    setTimeout(() => { child.stdout.resume(); child.stderr.resume(); }, 100);
    const guard = setTimeout(() => child.kill("SIGKILL"), 8_000);
    try {
      const result = await completion;
      assert.deepEqual(result, { code: Number(env.TEST_EXIT_CODE ?? "0"), signal: null });
      const actual = Buffer.concat(stdoutChunks).toString("utf8");
      assert.equal(Buffer.byteLength(actual), Buffer.byteLength(output));
      assert.ok(actual === output, "stdout content is complete");
      assert.equal(JSON.parse(actual).end, "last-row-present");
      const expectedStderr = env.TEST_STDOUT_ONLY ? "" : stderr;
      assert.equal(Buffer.concat(stderrChunks).byteLength, Buffer.byteLength(expectedStderr));
      assert.ok(Buffer.concat(stderrChunks).toString("utf8") === expectedStderr, "stderr content is complete");
    } finally {
      clearTimeout(guard);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  });
}

for (const command of ["mcp", "chat"]) {
  test(`${command} retains its persistent transport lifecycle after import`, () => {
    const actual = execFileSync("bun", [join(fixture, "bin/scout.mjs"), command], {
      env: isolatedEnvironment({ TEST_PERSISTENT: "1", TEST_STDOUT_ONLY: "1" }),
      encoding: "utf8", timeout: 5_000, maxBuffer: 3_000_000,
    });
    assert.ok(actual.endsWith("after import\n"), "stream remains open for later transport output");
  });
}

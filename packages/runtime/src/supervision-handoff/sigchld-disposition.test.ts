import { expect, test } from "bun:test";
import { join } from "node:path";
import { inspectSigchldDisposition } from "./sigchld-disposition.js";

for (const [name, handler, flags, expected] of [
  ["default", 0n, 0, { safe: true }],
  ["custom handler", 1234n, 0x0040, { safe: true }], // foreign native reaping is not observable here
  ["SIG_IGN", 1n, 0, { safe: false, reason: "sigchld_ignored" }],
  ["SA_NOCLDWAIT", 0n, 0x0020, { safe: false, reason: "sigchld_no_cldwait" }],
] as const) test(`Darwin disposition decoding: ${name}`, () => {
  const bytes = Buffer.alloc(16); bytes.writeBigUInt64LE(handler, 0); bytes.writeUInt32LE(flags, 12);
  expect(inspectSigchldDisposition(bytes)).toEqual(expected);
});
test("invalid disposition ABI evidence refuses", () => {
  expect(inspectSigchldDisposition(Buffer.alloc(15))).toEqual({ safe: false, reason: "sigchld_probe_failed" });
});
const nativeTest = process.platform === "darwin" && ["arm64", "x64"].includes(process.arch) ? test : test.skip;
nativeTest.each(["default", "ignore", "no-cldwait", "default-again"])("isolated SIGCHLD %s is probed, never changed in the runner", async mode => {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "sigchld-disposition.fixture.ts"), mode], {
    stdout: "pipe", stderr: "pipe", env: { ...process.env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit).toBe(0); expect(stderr).toBe("");
    const result = JSON.parse(stdout);
    const safe = mode === "default" || mode === "default-again";
    expect(result.capability).toEqual(safe ? { available: true, backend: "darwin-event-loop-wait4/1" }
      : { available: false, reason: mode === "ignore" ? "sigchld_ignored" : "sigchld_no_cldwait" });
    expect(result.probe).toEqual(safe ? { safe: true } : { safe: false, reason: mode === "ignore" ? "sigchld_ignored" : "sigchld_no_cldwait" });
    if (mode === "default-again") expect(result.first).toEqual({ available: false, reason: "sigchld_ignored" });
  } finally { clearTimeout(timer); child.kill("SIGKILL"); await child.exited; }
}, 10_000);

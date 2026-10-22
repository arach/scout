import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as catalog from "./harness-catalog.js";

const roots: string[] = [];
const oldPath = process.env.PATH;
afterEach(() => { process.env.PATH = oldPath; for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function root() {
  const path = realpathSync(mkdtempSync(join(process.env.CATALOG_ORDERING_ROOT ?? tmpdir(), "catalog-async-")));
  roots.push(path); return path;
}
function entry(): catalog.HarnessCatalogEntry {
  return { ...catalog.findHarnessEntry("cursor")!, name: "fixture", install: { binary: "fixture", verify: "verify" }, readiness: { healthcheckCommand: "health" } };
}
function executable(path: string, code: string) {
  writeFileSync(path, `#!${process.execPath}\n${code}`); chmodSync(path, 0o755);
}
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
async function entered(path: string) { for (let i = 0; i < 500 && !existsSync(path); i++) await tick(); expect(existsSync(path)).toBe(true); }

// The same tests run against the base's synchronous evaluator in the paired
// control. The production snapshot is tested separately below.
for (const phase of ["lookup", "verify", "health", "codex"] as const) {
  test(`catalog parent progresses during ${phase} child`, async () => {
    const dir = root(), marker = join(dir, "entered"), release = join(dir, "release"), expired = join(dir, "expired");
    const stub = `import {existsSync,writeFileSync} from 'node:fs';
writeFileSync(${JSON.stringify(marker)}, 'entered');
const end = Date.now()+1500;
while (!existsSync(${JSON.stringify(release)}) && Date.now()<end) await Bun.sleep(5);
if (!existsSync(${JSON.stringify(release)})) writeFileSync(${JSON.stringify(expired)}, 'expired');
console.log(${JSON.stringify(phase === "codex" ? "codex-cli 999.0.0" : "/fake/fixture")});`;
    executable(join(dir, phase === "codex" ? "codex" : "sh"), stub);
    // A launch-time PATH root makes old Bun's sync resolver see the fake too.
    const pathRoot = process.env.CATALOG_ORDERING_ROOT ?? dir;
    if (pathRoot !== dir) { mkdirSync(pathRoot, { recursive: true }); executable(join(pathRoot, phase === "codex" ? "codex" : "sh"), stub); }
    process.env.PATH = pathRoot;
    const target = phase === "codex" ? catalog.findHarnessEntry("codex")! : entry();
    if (phase === "lookup") { target.install = { binary: "fixture" }; target.readiness = undefined; }
    if (phase === "verify") target.readiness = undefined;
    if (phase === "health") target.install = { binary: "fixture" };
    const options = {
      env: { HOME: dir, PATH: pathRoot },
      ...(phase !== "lookup" && phase !== "codex" ? { whichBinary: () => "/fake/fixture" } : {}),
      requirementExists: () => true,
    };
    const evaluator = catalog.evaluateHarnessReadinessAsync ?? ((e, o) => Promise.resolve(catalog.evaluateHarnessReadiness(e, o)));
    let done = false;
    const pending = evaluator(target, options).finally(() => { done = true; });
    try {
      await entered(marker);
      expect(existsSync(expired)).toBe(false);
      expect(done).toBe(false);
    } finally { writeFileSync(release, "release"); await pending; }
    expect((await pending).ready).toBe(true);
  });
}

test("sync/async parity and command ordering across readiness cases", async () => {
  for (const platform of ["darwin", "win32"] as const) for (const localOnly of [false, true]) {
    for (const binary of [null, "/fake/fixture"]) for (const verified of [false, true]) for (const health of [false, true]) for (const configured of [false, true]) {
      const target = entry(); target.install!.verifyWin = "verify-win";
      target.readiness = { allOf: [{ kind: "env", key: "KEY" }], anyOf: [{ kind: "file", path: "/credential" }], healthcheckCommand: "health", loginCommand: "login" };
      const syncCalls: string[] = [], asyncCalls: string[] = [];
      const make = (calls: string[]) => ({ platform, localOnly, env: configured ? { KEY: "set" } : {},
        whichBinary: (name: string) => { calls.push(name); return binary; },
        requirementExists: () => { calls.push("credential"); return configured; },
        runCommand: (command: string) => { calls.push(command); return command === "health" ? health : verified; },
      });
      const expected = catalog.evaluateHarnessReadiness(target, make(syncCalls));
      const options = make(asyncCalls);
      expect(await catalog.evaluateHarnessReadinessAsync(target, { ...options,
        whichBinary: async (name, context) => { expect(context).toHaveProperty("signal"); return options.whichBinary(name); },
        runCommand: async (command) => options.runCommand(command),
      })).toEqual(expected);
      expect(asyncCalls).toEqual(syncCalls);
    }
  }
});

test("callback errors reject, abort is not missing, inputs are frozen across await", async () => {
  await expect(catalog.evaluateHarnessReadinessAsync(entry(), { whichBinary: async () => { throw new Error("lookup failed"); } })).rejects.toThrow("lookup failed");
  await expect(catalog.evaluateHarnessReadinessAsync(entry(), { whichBinary: () => "/fake", runCommand: async () => { throw new Error("command failed"); } })).rejects.toThrow("command failed");
  await expect(catalog.evaluateHarnessReadinessAsync(entry(), { signal: AbortSignal.abort() })).rejects.toThrow();
  const controller = new AbortController();
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const target = entry(); const env = { KEY: "yes" };
  target.readiness = { allOf: [{ kind: "env", key: "KEY" }] };
  const pending = catalog.evaluateHarnessReadinessAsync(target, { env, signal: controller.signal, whichBinary: async () => { await waiting; return "/fake"; }, runCommand: () => true });
  controller.abort(); release();
  await expect(pending).rejects.toThrow();
  const next = catalog.evaluateHarnessReadinessAsync(target, { env, whichBinary: async () => { await waiting; return "/fake"; }, runCommand: () => true });
  env.KEY = ""; target.readiness.allOf = [{ kind: "env", key: "OTHER" }];
  expect((await next).ready).toBe(true);
});

test("local-only never runs lookup shells, versions, verify or health", async () => {
  let commands = 0;
  for (const target of catalog.createBuiltInHarnessCatalog()) {
    const options = { localOnly: true, env: { HOME: "/absent", PATH: "/absent" }, platform: "darwin" as const,
      executableExists: () => true, requirementExists: () => true, systemPathDirectories: () => [],
      runCommand: () => { commands++; throw new Error("active probe"); },
    };
    const result = await catalog.evaluateHarnessReadinessAsync(target, options);
    expect(result).toEqual(catalog.evaluateHarnessReadiness(target, options));
    if (target.name === "cursor") expect(result.ready).toBe(false);
  }
  expect(commands).toBe(0);
});

test("snapshot keeps synchronous options and accepts async callback overload", async () => {
  const dir = root();
  const options: catalog.HarnessCatalogLoadOptions = { overridePath: join(dir, "absent"), now: () => 123, whichBinary: () => null, runCommand: () => false };
  const sync = await catalog.loadHarnessCatalogSnapshot(options);
  const asyncOptions: catalog.HarnessCatalogAsyncLoadOptions = { ...options, whichBinary: async () => null, runCommand: async () => false };
  expect(await catalog.loadHarnessCatalogSnapshot(asyncOptions)).toEqual(sync);
  expect(sync.generatedAt).toBe(123);
});

test("default command failures and ignored output match sync semantics", async () => {
  const dir = root(); process.env.PATH = dir;
  const target = entry();
  // Fake shell has no dependency on installed harnesses, env credentials or sh.
  executable(join(dir, "sh"), 'process.exit(7)');
  expect(await catalog.evaluateHarnessReadinessAsync(target)).toEqual(catalog.evaluateHarnessReadiness(target));
  executable(join(dir, "sh"), 'console.log("/fake/fixture"); console.error("x".repeat(2*1024*1024));');
  expect((await catalog.evaluateHarnessReadinessAsync(target)).ready).toBe(true);
  rmSync(join(dir, "sh"));
  expect((await catalog.evaluateHarnessReadinessAsync(target)).ready).toBe(false);
});

test("snapshot really uses yielding default command helpers", async () => {
  const dir = root(); process.env.PATH = dir;
  executable(join(dir, "sh"), 'process.exit(1)');
  executable(join(dir, "codex"), 'console.log("codex-cli 999.0.0")');
  const snapshot = await catalog.loadHarnessCatalogSnapshot({ env: { HOME: dir, PATH: dir }, overridePath: join(dir, "none") });
  expect(snapshot.entries.find(x => x.name === "codex")!.readinessReport.binaryVersion).toBe("999.0.0");
  expect(snapshot.entries.find(x => x.name === "cursor")!.readinessReport.ready).toBe(false);
});

test("snapshot parent progresses while its first default lookup is gated", async () => {
  const dir = root(), marker = join(dir, "entered"), release = join(dir, "release"), expired = join(dir, "expired");
  const pathRoot = process.env.CATALOG_ORDERING_ROOT ?? dir;
  process.env.PATH = pathRoot;
  executable(join(pathRoot, "sh"), `import {existsSync,writeFileSync} from 'node:fs';
if (!existsSync(${JSON.stringify(marker)})) {
writeFileSync(${JSON.stringify(marker)}, '1');
const end=Date.now()+1500;
while(!existsSync(${JSON.stringify(release)})&&Date.now()<end)await Bun.sleep(5);
if(!existsSync(${JSON.stringify(release)}))writeFileSync(${JSON.stringify(expired)},'1');
}
process.exit(1);`);
  executable(join(pathRoot, "codex"), 'console.log("codex-cli 999.0.0")');
  const pending = catalog.loadHarnessCatalogSnapshot({ env: { HOME: dir, PATH: pathRoot }, overridePath: join(dir, "absent") });
  try { await entered(marker); expect(existsSync(expired)).toBe(false); }
  finally { writeFileSync(release, "1"); await pending; }
});

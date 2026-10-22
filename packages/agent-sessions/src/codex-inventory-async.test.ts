import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCodexExecutableInventory, resolveCodexExecutableInventoryAsync } from "./codex-executable.js";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function root() { const r = mkdtempSync(join(tmpdir(), "codex-async-")); roots.push(r); return r; }
function executable(dir: string, script: string) { mkdirSync(dir, { recursive: true }); const p = join(dir, "codex"); writeFileSync(p, `#!/bin/sh\n${script}\n`); chmodSync(p, 0o755); return p; }

test("full async inventory matches sync metadata, ranking and fallback", async () => {
  const r = root(); const path = join(r, "path"), explicit = join(r, "explicit");
  const binary = executable(path, "printf 'codex-cli 998.0.0\\n'");
  const pinned = executable(explicit, "printf 'codex-cli 1.0.0\\n'");
  executable(join(r, "Applications", "ChatGPT.app", "Contents", "Resources"), "printf 'codex-cli 999.0.0\\n'");
  for (const override of [undefined, pinned, join(r, "absent")]) {
    const env = { HOME: r, PATH: path, OPENSCOUT_CODEX_BIN: override };
    const expected = resolveCodexExecutableInventory(env);
    expect(await resolveCodexExecutableInventoryAsync(env)).toEqual(expected);
    expect(expected.candidates.find(x => x.path === "codex")!.version).toBe("998.0.0");
    expect(expected.candidates.find(x => x.path === binary)!.versionRaw).toBe("codex-cli 998.0.0");
    if (override === pinned) expect(expected.selectedPath).toBe(pinned);
  }
  for (const script of ["printf 'unknown-version\\n'", "exit 4"]) {
    executable(path, script);
    const env = { HOME: r, PATH: path, OPENSCOUT_CODEX_BIN: pinned };
    expect(await resolveCodexExecutableInventoryAsync(env)).toEqual(resolveCodexExecutableInventory(env));
  }
});

test("version stdout is not limited to the path-selector's 4096 bytes, stderr stays ignored", async () => {
  const r = root();
  const path = executable(r, `printf '${"x".repeat(6000)} codex-cli 999.0.0\\n'\nprintf '${"e".repeat(6000)}' >&2`);
  const env = { HOME: r, PATH: r, OPENSCOUT_CODEX_BIN: path };
  const result = await resolveCodexExecutableInventoryAsync(env);
  expect(result).toEqual(resolveCodexExecutableInventory(env));
  expect(result.selected!.versionRaw!.length).toBeGreaterThan(4096);
  // The full inventory retains the sync API's 1 MiB stdout budget.
  writeFileSync(path, `#!${process.execPath}\nprocess.stdout.write("codex-cli 999.0.0 " + "x".repeat(1100000));`);
  expect(await resolveCodexExecutableInventoryAsync(env)).toEqual(resolveCodexExecutableInventory(env));
  expect((await resolveCodexExecutableInventoryAsync(env)).selected!.versionRaw).toBeNull();
});

test("async inventory retains the existing three-second version deadline", async () => {
  const r = root(), fast = join(r, "fast"), slow = join(r, "slow");
  const pin = executable(slow, "exec /bin/sleep 30");
  executable(fast, "printf 'codex-cli 999.0.0\\n'");
  const env = { HOME: r, PATH: fast, OPENSCOUT_CODEX_BIN: pin };
  const result = await resolveCodexExecutableInventoryAsync(env);
  expect(result.selectedPath).toBe(pin); // explicit executable still wins
  expect(result.selected!.versionRaw).toBeNull();
  expect(result.candidates.find(x => x.path === "codex")!.version).toBe("999.0.0");
}, 10_000);

test("abort never becomes a missing-version or fallback success", async () => {
  await expect(resolveCodexExecutableInventoryAsync({}, { signal: AbortSignal.abort() })).rejects.toThrow();
  const r = root(), marker = join(r, "entered");
  const binary = executable(r, `printf entered > '${marker}'\nexec /bin/sleep 30`);
  const controller = new AbortController();
  const pending = resolveCodexExecutableInventoryAsync({ HOME: r, PATH: r, OPENSCOUT_CODEX_BIN: binary }, { signal: controller.signal });
  for (let i = 0; i < 500 && !existsSync(marker); i++) await new Promise(resolve => setTimeout(resolve, 5));
  expect(existsSync(marker)).toBe(true);
  controller.abort();
  await expect(pending).rejects.toThrow();
});

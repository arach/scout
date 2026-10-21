import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { inspectMeshBridgePreflight } from "./mesh-bridge-preflight.ts";
import { legacyMeshBridgeLaunchAgentPath, meshBridgeConfigPath } from "./mesh-bridge-supervisor.ts";

let root: string, supportDirectory: string, env: NodeJS.ProcessEnv;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mesh-preflight-"));
  supportDirectory = join(root, "support");
  mkdirSync(supportDirectory, { mode: 0o700 });
  env = { HOME: root, SCOUT_HOME: join(root, ".scout"), OPENSCOUT_EXTENSIONS_HOME: join(root, ".scout/extensions"),
    OPENSCOUT_SUPPORT_DIRECTORY: supportDirectory, OPENSCOUT_INSTANCE: "prod", PATH: process.env.PATH };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const inspect = () => inspectMeshBridgePreflight({ supportDirectory, env, home: root });
function config(enabled = true) {
  writeFileSync(meshBridgeConfigPath(supportDirectory), JSON.stringify({ enabled, relayUrl: "https://relay.example.invalid", token: "never-print-this-secret" }), { mode: 0o600 });
}
function install() {
  const dir = join(env.OPENSCOUT_EXTENSIONS_HOME!, "mesh");
  mkdirSync(join(dir, "bin"), { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "extension.json"), JSON.stringify({ api: 1, command: "bin/scout-mesh" }));
  writeFileSync(join(dir, "bin/scout-mesh"), "#!/bin/sh\necho MUST-NOT-EXECUTE\nexit 99\n", { mode: 0o700 });
  return dir;
}

test("preflight reports missing extension only for enabled bridges; reads never enable or install", () => {
  expect(inspect()).toMatchObject({ ok: true, enabled: false, reason: "no-config" });
  config(false);
  expect(inspect()).toMatchObject({ ok: true, enabled: false, extensionState: "absent" });
  config();
  const before = readFileSync(meshBridgeConfigPath(supportDirectory), "utf8");
  expect(inspect()).toMatchObject({ ok: false, enabled: true, enabledWithoutExtension: true, reason: "extension-absent" });
  expect(inspect().fix).toContain("scout extensions install mesh");
  expect(readFileSync(meshBridgeConfigPath(supportDirectory), "utf8")).toBe(before);
  expect(readdirSync(supportDirectory)).toEqual(["mcp-bridge.json"]);
  expect(JSON.stringify(inspect())).not.toContain("never-print-this-secret");
  install();
  expect(inspect()).toMatchObject({ ok: true, enabled: true, extensionState: "ready", enabledWithoutExtension: false });
  config(false);
  expect(inspect()).toMatchObject({ ok: true, enabled: false });
});

test("explicit override satisfies absence but never bypasses a removed or invalid install", () => {
  config(); env.OPENSCOUT_MESH_BRIDGE_BIN = join(root, "scout.ts");
  expect(inspect()).toMatchObject({ ok: false, reason: "override-unavailable" });
  writeFileSync(env.OPENSCOUT_MESH_BRIDGE_BIN, "// explicit CLI");
  expect(inspect()).toMatchObject({ ok: true, enabledWithoutExtension: true, overrideAvailable: true });
  const dir = install();
  chmodSync(join(dir, "bin/scout-mesh"), 0o600);
  expect(inspect()).toMatchObject({ ok: false, extensionState: "refused", reason: "untrusted-or-invalid" });
  writeFileSync(join(dir, "extension.json"), JSON.stringify({ disabled: true }));
  expect(inspect()).toMatchObject({ ok: false, reason: "removed" });
});

test("legacy owner still requires migration; invalid config fails closed; env disable stays idle", () => {
  config();
  const legacy = legacyMeshBridgeLaunchAgentPath(root);
  mkdirSync(dirname(legacy), { recursive: true }); writeFileSync(legacy, "<plist/>");
  expect(inspect()).toMatchObject({ ok: false, enabled: true, reason: "extension-absent" });
  install(); expect(inspect()).toMatchObject({ ok: true, enabled: true, reason: "legacy-launch-agent" });
  writeFileSync(meshBridgeConfigPath(supportDirectory), "not json");
  expect(inspect()).toMatchObject({ ok: false, enabled: null, reason: "invalid-config" });
  env.OPENSCOUT_BASE_MESH_BRIDGE_ENABLED = "0";
  expect(inspect()).toMatchObject({ ok: true, enabled: false, reason: "disabled-by-env" });
});

test("runtime command is read-only, reports JSON with exit 78/0, and validates help/flags before inspecting", async () => {
  const bin = new URL("../bin/openscout-runtime.mjs", import.meta.url).pathname;
  const run = async (...args: string[]) => {
    const child = Bun.spawn([process.execPath, bin, "mesh-bridge-preflight", ...args], { env, stdout: "pipe", stderr: "pipe" });
    return { code: await child.exited, out: await new Response(child.stdout).text(), err: await new Response(child.stderr).text() };
  };
  config();
  const missing = await run("--json");
  expect(missing.code).toBe(78); expect(JSON.parse(missing.out)).toMatchObject({ enabled: true, reason: "extension-absent" });
  expect(missing.out + missing.err).not.toContain("never-print-this-secret");
  expect(readdirSync(supportDirectory)).toEqual(["mcp-bridge.json"]);
  install();
  const ready = await run(); expect(ready.code).toBe(0); expect(JSON.parse(ready.out).ok).toBe(true);
  expect(ready.out).not.toContain("MUST-NOT-EXECUTE");
  expect((await run("--help")).code).toBe(0);
  expect((await run("--repair")).code).toBe(1);
});

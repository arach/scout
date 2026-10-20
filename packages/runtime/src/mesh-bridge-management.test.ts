import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MeshBridgeManagement, type MeshBridgeMutation } from "./mesh-bridge-management.js";
import { meshBridgeConfigPath, meshBridgeStatePath, resolveMeshBridgeDesiredState } from "./mesh-bridge-supervisor.js";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "bridge-api-")); dirs.push(dir);
  const events: MeshBridgeMutation[] = [];
  const manager = new MeshBridgeManagement({ supportDirectory: dir, lifecycle: async action => { events.push(action); }, now: () => 100_000 });
  return { dir, manager, events };
}
const config = { enabled: true, relayUrl: "https://relay.example", tokenKeychainService: "test.bridge", tools: "core" };
describe("runtime bridge management", () => {
  test("credentials are write-only and status never includes secret values or prefixes", async () => {
    const { dir, manager, events } = fixture();
    const token = "example-write-only-credential";
    const response = await manager.configure({ ...config, token });
    expect(JSON.stringify(response)).not.toContain(token);
    const status = manager.read();
    expect(status.credentials).toMatchObject({ keychainService: "test.bridge", storedTokenConfigured: true, tokenFileExists: false, validity: "configured" });
    expect(JSON.stringify(status)).not.toContain(token); expect(JSON.stringify(status)).not.toContain(token.slice(0, 8));
    expect(readFileSync(meshBridgeConfigPath(dir), "utf8")).toContain(token);
    expect(statSync(meshBridgeConfigPath(dir)).mode & 0o777).toBe(0o600);
    expect(events).toEqual(["configure"]);
    await manager.configure(config); expect(manager.read().credentials.storedTokenConfigured).toBe(true);
    await manager.configure({ ...config, token: null }); expect(manager.read().credentials.storedTokenConfigured).toBe(false);
  });
  test("paths, unknown fields, invalid URLs and invalid secrets are refused without mutation", () => {
    const { manager, events } = fixture();
    for (const addition of [{ tokenFile: "/tmp/credential" }, { configPath: "/tmp/config" }, { logPath: "/tmp/log" },
      { dir: "/tmp/project" }, { relayUrl: "https://user:pass@relay.example" }, { relayUrl: "http://relay.example" },
      { relayUrl: "https://relay.example?token=secret" }, { token: "line\nbreak" }, { token: "null\0byte" }]) {
      expect(() => manager.configure({ ...config, ...addition })).toThrow();
    }
    expect(manager.read().configValidity).toBe("missing"); expect(events).toEqual([]);
  });
  test("all control verbs change scout-base desired config, never start a second owner", async () => {
    const { dir, manager, events } = fixture();
    await manager.configure(config);
    expect(resolveMeshBridgeDesiredState({ supportDirectory: dir, env: {}, home: dir }).run).toBe(true);
    const before = statSync(meshBridgeConfigPath(dir)).mtimeMs;
    expect(await manager.control("request-restart")).toMatchObject({ reconciliation: "requested" });
    expect(statSync(meshBridgeConfigPath(dir)).mtimeMs).toBeGreaterThan(before);
    await manager.control("disable");
    expect(resolveMeshBridgeDesiredState({ supportDirectory: dir, env: {}, home: dir })).toMatchObject({ run: false, reason: "disabled-in-config" });
    await expect(manager.control("request-restart")).rejects.toMatchObject({ code: "bridge_disabled" });
    await manager.control("enable");
    expect(resolveMeshBridgeDesiredState({ supportDirectory: dir, env: {}, home: dir }).run).toBe(true);
    expect(events).toEqual(["configure", "request-restart", "disable", "request-restart", "enable"]);
    for (const action of ["spawn", "kill", "restart", "install", { action: "enable" }]) expect(() => manager.control(action)).toThrow();
  });
  test("observed state is a timestamped stale observation, not a liveness assertion", () => {
    const { dir, manager } = fixture();
    expect(manager.read().observed).toMatchObject({ state: "unavailable", stale: true, updatedAt: null });
    mkdirSync(join(dir, "runtime"));
    writeFileSync(meshBridgeStatePath(dir), JSON.stringify({ state: "running", pid: 123, updatedAt: 1000, token: "private-value", entrypoint: "/tmp/internal-path" }));
    const observed = manager.read().observed;
    expect(observed).toEqual({ state: "running", pid: 123, updatedAt: 1000, ageMs: 99_000, stale: true });
    expect(JSON.stringify(manager.read())).not.toMatch(/private-value|internal-path/);
  });
  test("failed lifecycle persistence refuses the mutation; queued changes do not lose state", async () => {
    const { dir } = fixture();
    const denied = new MeshBridgeManagement({ supportDirectory: dir, lifecycle: async () => { throw new Error("unavailable"); } });
    await expect(denied.configure(config)).rejects.toBeDefined();
    expect(denied.read().configValidity).toBe("missing");
    const manager = new MeshBridgeManagement({ supportDirectory: dir, lifecycle: async () => { await new Promise(done => setTimeout(done, 5)); } });
    await Promise.all([manager.configure(config), manager.control("disable")]);
    expect(manager.read().config?.enabled).toBe(false);
  });
  test("remote diagnostic consent is per explicit identity, never a blanket boolean", async () => {
    const { manager } = fixture();
    expect(() => manager.configure({ ...config, remoteDiagnostics: true })).toThrow();
    await manager.configure({ ...config, remoteDiagnostics: [{ kind: "oauth", id: "identity-1", ownerKey: "owner-1", node: "node", agentId: "agent" }] });
    expect(manager.read().config?.remoteDiagnostics).toEqual([{ kind: "oauth", id: "identity-1", ownerKey: "owner-1", node: "node", agentId: "agent" }]);
    await manager.configure(config); expect(manager.read().config?.remoteDiagnostics).toEqual([]);
  });
});


test("bridge management loads after the broker instance bootstrap", () => {
  const source = readFileSync(new URL("./broker-daemon.ts", import.meta.url), "utf8");
  expect(source.match(/^import .*$/m)?.[0]).toBe('import { openScoutCheckoutInstanceDefault, openScoutInstanceBootstrap } from "./instance-checkout-bootstrap.js";');
});

import { afterEach, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { BrokerWebControlService } from "./broker-web-control-service.js";
import { BrokerScoutbotService } from "./broker-scoutbot-service.js";
import { legacyAppServicesPath } from "./legacy-app-services.js";

const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
class FakeChild extends EventEmitter {
  pid = 9876;
  exitCode: number | null = null;
  kill(signal?: string) { this.exitCode = 0; this.emit("exit", 0, signal); return true; }
  unref() {}
}
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "scout-app-discovery-")); homes.push(home);
  function file(relative: string, contents = "export {};\n") {
    const path = join(home, relative); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, contents); return path;
  }
  // A discoverable checkout and all historical fallback entries are present.
  file("apps/desktop/bin/scout.ts"); file("packages/runtime/bin/openscout-runtime.mjs");
  file("packages/web/server/index.ts"); file("packages/web/server/scoutbot/process/main.ts");
  file("packages/runtime/scout-control-plane-web.mjs");
  const moduleDirectory = dirname(file("packages/runtime/src/fixture.ts"));
  const entry = file("installed/service.mjs");
  const env: Record<string, string> = {
    HOME: home, OPENSCOUT_INSTANCE: "prod", OPENSCOUT_SUPPORT_DIRECTORY: join(home, "support"),
    OPENSCOUT_SETUP_CWD: home, OPENSCOUT_WEB_AUTH_TOKEN: "fixture-only", OPENSCOUT_WEB_PORT: "4321",
  };
  function config(value: unknown) { const path = legacyAppServicesPath(env); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value)); }
  return { home, env, moduleDirectory, entry, config };
}

test.each(["absent", "present", "missing"])("web never chooses sibling packages/web: explicit entry %s", async mode => {
  const f = fixture();
  if (mode !== "absent") f.env.OPENSCOUT_WEB_SERVER_ENTRY = mode === "present" ? f.entry : join(f.home, "missing.mjs");
  const spawned: string[][] = [];
  const child = new FakeChild();
  const service = new BrokerWebControlService({
    brokerControlUrl: "http://127.0.0.1:4321", env: f.env, moduleDirectory: f.moduleDirectory, cwd: () => f.home,
    spawnProcess: (_command, args) => { spawned.push([...(args ?? [])]); return child; },
    healthCheck: async () => spawned.length > 0 && child.exitCode === null,
    resolveBun: () => ({ path: "/fixture/bun" }), resolveLogPath: () => "/dev/null", healthMonitorIntervalMs: 0,
  });
  const result = await service.startIfNeeded();
  if (mode === "present") {
    expect(spawned).toEqual([["run", f.entry]]); expect(result.ok).toBe(true);
  } else {
    expect(spawned).toEqual([]); expect(result.ok).toBe(false);
    expect(result.error).toContain(mode === "missing" ? "Configured web entry is unavailable" : "supplied by OpenScout apps");
  }
  await service.stop();
});

test.each(["absent", "present", "missing"])("enabled Scoutbot never chooses sibling packages/web: explicit entry %s", async mode => {
  const f = fixture(); f.env.OPENSCOUT_SCOUTBOT_PROCESS = "1";
  if (mode !== "absent") f.env.OPENSCOUT_SCOUTBOT_ENTRY = mode === "present" ? f.entry : join(f.home, "missing.mjs");
  const spawned: string[][] = []; const diagnostics: string[] = [];
  const service = new BrokerScoutbotService({
    brokerUrl: "http://127.0.0.1:4321", brokerSocketPath: join(f.home, "broker.sock"),
    env: f.env, moduleDirectory: f.moduleDirectory, cwd: () => f.home,
    spawnProcess: (_command, args) => { spawned.push([...(args ?? [])]); return new FakeChild(); },
    resolveBun: () => ({ path: "/fixture/bun" }), resolveLogPath: () => join(f.home, "bot.log"),
    error: (message, error) => diagnostics.push(`${message} ${String(error)}`),
  });
  service.start();
  expect(spawned).toEqual(mode === "present" ? [["run", f.entry]] : []);
  if (mode !== "present") expect(diagnostics.join(" ")).toContain(mode === "missing" ? "Configured Scoutbot entry is unavailable" : "no explicit entry");
  await service.stop();
});

test("an explicit Scoutbot entry without enablement makes no spawn attempt", () => {
  const f = fixture(); f.env.OPENSCOUT_SCOUTBOT_ENTRY = f.entry;
  let spawns = 0;
  const service = new BrokerScoutbotService({
    brokerUrl: "http://127.0.0.1:4321", brokerSocketPath: join(f.home, "broker.sock"), env: f.env,
    moduleDirectory: f.moduleDirectory, cwd: () => f.home,
    resolveBun: () => ({ path: "/fixture/bun" }), resolveLogPath: () => join(f.home, "bot.log"),
    spawnProcess: () => { spawns++; return new FakeChild(); },
  });
  expect(service.enabled()).toBe(false); service.start(); expect(spawns).toBe(0);
});

test("services reload durable config and the internal web marker cannot override disabling", async () => {
  const f = fixture(); f.config({ version: 1, web: { entry: f.entry }, scoutbot: { enabled: true, entry: f.entry } });
  const botEntries: string[] = []; const webEntries: string[] = [];
  const bot = new BrokerScoutbotService({
    brokerUrl: "http://127.0.0.1:4321", brokerSocketPath: join(f.home, "broker.sock"), env: f.env,
    spawnProcess: (_command, args) => { botEntries.push(args![1]!); return new FakeChild(); },
    resolveBun: () => ({ path: "/fixture/bun" }), resolveLogPath: () => join(f.home, "bot.log"),
  });
  const web = new BrokerWebControlService({
    brokerControlUrl: "http://127.0.0.1:4321", env: f.env, moduleDirectory: f.moduleDirectory,
    spawnProcess: (_command, args) => { webEntries.push(args![1]!); return new FakeChild(); },
    healthCheck: async () => false, resolveBun: () => ({ path: "/fixture/bun" }), resolveLogPath: () => "/dev/null",
  });
  expect(bot.enabled()).toBe(true);
  // Mirrors broker-daemon's legacy posting-only marker after service construction.
  f.env.OPENSCOUT_SCOUTBOT_PROCESS = "managed";
  f.config({ version: 1, web: { entry: join(f.home, "missing.mjs") }, scoutbot: { enabled: false, entry: f.entry } });
  expect(bot.enabled()).toBe(false); bot.start(); expect(botEntries).toEqual([]);
  expect((await web.startIfNeeded()).error).toContain("Configured web entry is unavailable");
  expect(webEntries).toEqual([]);
  await bot.stop(); await web.stop();
});


test("a fresh daemon reads durable entries without entry or enablement environment variables", async () => {
  const f = fixture(); f.config({ version: 1, web: { entry: f.entry }, scoutbot: { enabled: true, entry: f.entry } });
  const spawned: string[][] = [];
  const bot = new BrokerScoutbotService({
    brokerUrl: "http://127.0.0.1:4321", brokerSocketPath: join(f.home, "broker.sock"), env: f.env,
    spawnProcess: (_command, args) => { spawned.push([...(args ?? [])]); return new FakeChild(); },
    resolveBun: () => ({ path: "/fixture/bun" }), resolveLogPath: () => join(f.home, "bot.log"),
  });
  const child = new FakeChild(); let webSpawned = false;
  const web = new BrokerWebControlService({
    brokerControlUrl: "http://127.0.0.1:4321", env: f.env, moduleDirectory: f.moduleDirectory,
    spawnProcess: (_command, args) => { spawned.push([...(args ?? [])]); webSpawned = true; return child; },
    healthCheck: async () => webSpawned && child.exitCode === null,
    resolveBun: () => ({ path: "/fixture/bun" }), resolveLogPath: () => "/dev/null", healthMonitorIntervalMs: 0,
  });
  expect(bot.enabled()).toBe(true); bot.start();
  expect((await web.startIfNeeded()).ok).toBe(true);
  expect(spawned).toEqual([["run", f.entry], ["run", f.entry]]);
  await bot.stop(); await web.stop();
});

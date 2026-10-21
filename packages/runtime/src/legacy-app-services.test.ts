import * as fs from "node:fs";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { legacyAppServicesPath, resolveLegacyScoutbotEntry, resolveLegacyWebEntry } from "./legacy-app-services.js";

const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
function fixture(packaged = false) {
  const home = mkdtempSync(join(tmpdir(), "scout-app-entries-")); homes.push(home);
  const env = { HOME: home, OPENSCOUT_INSTANCE: "prod", OPENSCOUT_SUPPORT_DIRECTORY: join(home, "support") };
  const root = packaged ? join(home, "node_modules", "@openscout", "scout") : join(home, "checkout");
  const moduleDirectory = packaged ? join(root, "dist/runtime") : join(root, "packages/runtime/src");
  function file(relative: string, content = "export {};\n") {
    const path = join(root, relative); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); return path;
  }
  mkdirSync(moduleDirectory, { recursive: true });
  file("package.json", JSON.stringify({ name: packaged ? "@openscout/scout" : "unrelated-checkout" }));
  file("packages/web/server/index.ts"); file("packages/web/server/scoutbot/process/main.ts");
  // Both historical source and sibling-bundle guesses are available as traps.
  file("packages/runtime/scout-control-plane-web.mjs");
  file("packages/scout-web-server.mjs");
  const bundle = file("dist/scout-control-plane-web.mjs");
  const entry = file("installed/selected.mjs");
  function config(value: unknown) {
    const path = legacyAppServicesPath(env); mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(value));
  }
  return { home, env, root, moduleDirectory, file, bundle, entry, config };
}

describe("explicit app service entries", () => {
  test("never discovers the sibling web tree or arbitrary bundles", () => {
    const f = fixture();
    expect(resolveLegacyWebEntry(f.env, f.moduleDirectory)).toBeNull();
    expect(resolveLegacyScoutbotEntry(f.env)).toBeNull();
    expect(() => resolveLegacyScoutbotEntry({ ...f.env, OPENSCOUT_SCOUTBOT_PROCESS: "1" })).toThrow("no explicit entry");
  });
  test.each([false, true])("explicit web path wins or fails closed, packaged=%s", (packaged) => {
    const f = fixture(packaged);
    f.config({ version: 1, web: { entry: f.bundle } });
    expect(resolveLegacyWebEntry({ ...f.env, OPENSCOUT_WEB_SERVER_ENTRY: f.entry }, f.moduleDirectory)).toBe(f.entry);
    expect(() => resolveLegacyWebEntry({ ...f.env, OPENSCOUT_WEB_SERVER_ENTRY: join(f.root, "missing") }, f.moduleDirectory)).toThrow("Configured web entry is unavailable");
    expect(resolveLegacyWebEntry({ ...f.env, OPENSCOUT_WEB_SERVER_ENTRY: "" }, f.moduleDirectory)).toBeNull();
  });
  test("a built checkout CLI is not an installed npm package", () => {
    const f = fixture();
    f.file("packages/cli/package.json", JSON.stringify({ name: "@openscout/scout" }));
    f.file("packages/cli/dist/scout-control-plane-web.mjs");
    const moduleDirectory = dirname(f.file("packages/cli/dist/runtime/broker-daemon.mjs"));
    expect(resolveLegacyWebEntry(f.env, moduleDirectory)).toBeNull();
  });
  test("a real node_modules installation can select its own web bundle", () => {
    const f = fixture(true);
    expect(resolveLegacyWebEntry(f.env, f.moduleDirectory)).toBe(f.bundle);
  });
  test("a bun-linked package escaping node_modules requires explicit configuration", () => {
    const f = fixture(); f.file("package.json", JSON.stringify({ name: "@openscout/scout" }));
    const link = join(f.home, "node_modules", "@openscout", "scout");
    mkdirSync(dirname(link), { recursive: true }); symlinkSync(f.root, link, "dir");
    const moduleDirectory = join(link, "dist", "runtime");
    expect(resolveLegacyWebEntry(f.env, moduleDirectory)).toBeNull();
    expect(resolveLegacyWebEntry({ ...f.env, OPENSCOUT_WEB_SERVER_ENTRY: f.entry }, moduleDirectory)).toBe(f.entry);
  });
  test("keeps the installed npm bundle only when explicit configuration is absent", () => {
    const f = fixture(true);
    expect(resolveLegacyWebEntry(f.env, f.moduleDirectory)).toBe(f.bundle);
    f.config({ version: 1 });
    expect(resolveLegacyWebEntry(f.env, f.moduleDirectory)).toBeNull();
    f.config({ version: 1, web: { entry: null } });
    expect(resolveLegacyWebEntry(f.env, f.moduleDirectory)).toBeNull();
    f.config({ version: 1, web: { entry: join(f.root, "missing") } });
    expect(() => resolveLegacyWebEntry(f.env, f.moduleDirectory)).toThrow("unavailable");
  });
  test("the compatibility bundle is restricted to the installed CLI package", () => {
    const f = fixture(true);
    f.file("package.json", JSON.stringify({ name: "@openscout/runtime" }));
    expect(resolveLegacyWebEntry(f.env, f.moduleDirectory)).toBeNull();
    f.file("package.json", JSON.stringify({ name: "@openscout/scout" }));
    rmSync(f.bundle);
    const compatibility = f.file("dist/scout-web-server.mjs");
    expect(resolveLegacyWebEntry(f.env, f.moduleDirectory)).toBe(compatibility);
  });
  test("invalid enablement and enabled-without-entry have diagnostics", () => {
    const f = fixture();
    expect(() => resolveLegacyScoutbotEntry({ ...f.env, OPENSCOUT_SCOUTBOT_PROCESS: "maybe", OPENSCOUT_SCOUTBOT_ENTRY: f.entry })).toThrow("must explicitly enable or disable");
    f.config({ version: 1, scoutbot: { enabled: true } });
    expect(() => resolveLegacyScoutbotEntry(f.env)).toThrow("no explicit entry");
  });
  test("reloads durable entries and enablement, without process env edits", () => {
    const f = fixture();
    f.config({ version: 1, web: { entry: f.entry }, scoutbot: { enabled: true, entry: f.entry } });
    expect(resolveLegacyWebEntry(f.env, f.moduleDirectory)).toBe(f.entry);
    expect(resolveLegacyScoutbotEntry(f.env)).toBe(f.entry);
    f.config({ version: 1, web: { entry: f.bundle }, scoutbot: { enabled: false, entry: f.entry } });
    expect(resolveLegacyWebEntry(f.env, f.moduleDirectory)).toBe(f.bundle);
    expect(resolveLegacyScoutbotEntry(f.env)).toBeNull();
  });
  test.each([undefined, "0", "false", "off", ""])('an entry alone never enables Scoutbot (flag=%s)', (flag) => {
    const f = fixture();
    expect(resolveLegacyScoutbotEntry({ ...f.env, OPENSCOUT_SCOUTBOT_ENTRY: f.entry, OPENSCOUT_SCOUTBOT_PROCESS: flag })).toBeNull();
  });
  test.each(["1", "true", "on", "managed"])('explicit Scoutbot enablement requires its selected entry (flag=%s)', (flag) => {
    const f = fixture();
    f.config({ version: 1, scoutbot: { enabled: false, entry: f.bundle } });
    const env = { ...f.env, OPENSCOUT_SCOUTBOT_PROCESS: flag };
    expect(resolveLegacyScoutbotEntry({ ...env, OPENSCOUT_SCOUTBOT_ENTRY: f.entry })).toBe(f.entry);
    expect(() => resolveLegacyScoutbotEntry({ ...env, OPENSCOUT_SCOUTBOT_ENTRY: join(f.root, "missing") })).toThrow("Configured Scoutbot entry is unavailable");
    expect(() => resolveLegacyScoutbotEntry({ ...env, OPENSCOUT_SCOUTBOT_ENTRY: "" })).toThrow("no explicit entry");
  });
  test("durable Scoutbot enablement does not bypass a missing explicit env entry", () => {
    const f = fixture(); f.config({ version: 1, scoutbot: { enabled: true, entry: f.entry } });
    expect(() => resolveLegacyScoutbotEntry({ ...f.env, OPENSCOUT_SCOUTBOT_ENTRY: join(f.root, "missing") })).toThrow("unavailable");
  });
  test.each([{ version: 2 }, { version: 1, web: [] }, { version: 1, web: { entry: 5 } }, { version: 1, scoutbot: { enabled: "true" } }])("invalid configuration fails closed (%j)", (value) => {
    const f = fixture(true); f.config(value);
    expect(() => resolveLegacyWebEntry(f.env, f.moduleDirectory)).toThrow("Invalid app service configuration");
    expect(() => resolveLegacyScoutbotEntry(f.env)).toThrow("Invalid app service configuration");
  });
  test("invalid JSON and unreadable-as-file config do not trigger bundle fallback", () => {
    const f = fixture(true); f.config({ version: 1 });
    writeFileSync(legacyAppServicesPath(f.env), "{");
    expect(() => resolveLegacyWebEntry(f.env, f.moduleDirectory)).toThrow("Invalid app service configuration");
    rmSync(legacyAppServicesPath(f.env)); mkdirSync(legacyAppServicesPath(f.env));
    expect(() => resolveLegacyWebEntry(f.env, f.moduleDirectory)).toThrow("Cannot read app service configuration");
  });
  test("relative entries and directories are refused instead of searching", () => {
    const f = fixture();
    expect(() => resolveLegacyWebEntry({ ...f.env, OPENSCOUT_WEB_SERVER_ENTRY: "./server.mjs" }, f.moduleDirectory)).toThrow("absolute file path");
    expect(() => resolveLegacyWebEntry({ ...f.env, OPENSCOUT_WEB_SERVER_ENTRY: f.root }, f.moduleDirectory)).toThrow("not a regular file");
  });
  test("only ENOENT makes config absent; permission and path errors fail closed", () => {
    const f = fixture(true);
    expect(resolveLegacyWebEntry(f.env, f.moduleDirectory)).toBe(f.bundle);
    f.config({ version: 1, web: { entry: f.entry } });
    const path = legacyAppServicesPath(f.env), open = fs.openSync;
    const deny = spyOn(fs, "openSync").mockImplementation(((candidate: fs.PathLike, ...args: any[]) => {
      if (String(candidate) === path) throw Object.assign(new Error("permission denied (EACCES)"), { code: "EACCES" });
      return (open as any)(candidate, ...args);
    }) as typeof fs.openSync);
    try { expect(() => resolveLegacyWebEntry(f.env, f.moduleDirectory)).toThrow("permission denied (EACCES)"); }
    finally { deny.mockRestore(); }
    expect(() => resolveLegacyWebEntry({ ...f.env, OPENSCOUT_SUPPORT_DIRECTORY: f.entry }, f.moduleDirectory)).toThrow("Cannot read app service configuration");
  });
  test("world-writable config is refused instead of selecting the installed bundle", () => {
    const f = fixture(true); f.config({ version: 1, web: { entry: f.entry } });
    chmodSync(legacyAppServicesPath(f.env), 0o666);
    expect(() => resolveLegacyWebEntry(f.env, f.moduleDirectory)).toThrow("anyone on this machine can write");
    expect(() => resolveLegacyScoutbotEntry(f.env)).toThrow("anyone on this machine can write");
  });
  test("world-writable configured entries are refused for both services", () => {
    const f = fixture(true); chmodSync(f.entry, 0o666);
    f.config({ version: 1, web: { entry: f.entry }, scoutbot: { enabled: true, entry: f.entry } });
    expect(() => resolveLegacyWebEntry(f.env, f.moduleDirectory)).toThrow("anyone on this machine can write");
    expect(() => resolveLegacyScoutbotEntry(f.env)).toThrow("anyone on this machine can write");
    expect(() => resolveLegacyWebEntry({ ...f.env, OPENSCOUT_WEB_SERVER_ENTRY: f.entry }, f.moduleDirectory)).toThrow("anyone on this machine can write");
  });
  test("config owned by a different uid is refused", () => {
    const f = fixture(true); f.config({ version: 1, web: { entry: f.entry } });
    const fstat = fs.fstatSync;
    const mocked = spyOn(fs, "fstatSync").mockImplementation(((fd: number) => Object.assign(fstat(fd), { uid: (process.getuid?.() ?? 1000) + 1 })) as typeof fs.fstatSync);
    try { expect(() => resolveLegacyWebEntry(f.env, f.moduleDirectory)).toThrow("not owned by the current user or root"); }
    finally { mocked.mockRestore(); }
  });
  test("configured entries owned by a different uid are refused", () => {
    const f = fixture(); const stat = fs.statSync;
    const mocked = spyOn(fs, "statSync").mockImplementation(((path: fs.PathLike) => Object.assign(stat(path), { uid: (process.getuid?.() ?? 1000) + 1 })) as typeof fs.statSync);
    try {
      expect(() => resolveLegacyWebEntry({ ...f.env, OPENSCOUT_WEB_SERVER_ENTRY: f.entry }, f.moduleDirectory)).toThrow("not owned by the current user or root");
      expect(() => resolveLegacyScoutbotEntry({ ...f.env, OPENSCOUT_SCOUTBOT_PROCESS: "1", OPENSCOUT_SCOUTBOT_ENTRY: f.entry })).toThrow("not owned by the current user or root");
    } finally { mocked.mockRestore(); }
  });
  test("root-owned config and entries remain trusted", () => {
    const f = fixture(); f.config({ version: 1, web: { entry: f.entry }, scoutbot: { enabled: true, entry: f.entry } });
    const stat = fs.statSync, fstat = fs.fstatSync;
    const a = spyOn(fs, "statSync").mockImplementation(((path: fs.PathLike) => Object.assign(stat(path), { uid: 0 })) as typeof fs.statSync);
    const b = spyOn(fs, "fstatSync").mockImplementation(((fd: number) => Object.assign(fstat(fd), { uid: 0 })) as typeof fs.fstatSync);
    try { expect(resolveLegacyWebEntry(f.env, f.moduleDirectory)).toBe(f.entry); expect(resolveLegacyScoutbotEntry(f.env)).toBe(f.entry); }
    finally { a.mockRestore(); b.mockRestore(); }
  });
  test("strict ownership refuses paths without getuid", () => {
    const f = fixture(); const getuid = spyOn(process, "getuid").mockImplementation(() => undefined as any);
    try { expect(() => resolveLegacyWebEntry({ ...f.env, OPENSCOUT_WEB_SERVER_ENTRY: f.entry }, f.moduleDirectory)).toThrow("not owned by the current user or root"); }
    finally { getuid.mockRestore(); }
  });
  test("durable configuration is instance-scoped", () => {
    const f = fixture();
    const { OPENSCOUT_SUPPORT_DIRECTORY: _, ...env } = f.env;
    expect(legacyAppServicesPath({ ...env, OPENSCOUT_INSTANCE: "review" })).not.toBe(legacyAppServicesPath(env));
  });
});

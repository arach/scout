import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moveLegacyScoutHomeOffline, resolveScoutHome, scoutHomeReadPath, scoutHomeReadRoots, scoutHomeWritePath } from "./scout-home.ts";

const homes: string[] = [];
function sandbox() {
  const home = mkdtempSync(join(tmpdir(), "scout-home-migration-"));
  homes.push(home);
  return { home, env: {} };
}
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });

test("new default and env precedence; resolution has no side effects", () => {
  const options = sandbox();
  expect(resolveScoutHome(options)).toBe(join(options.home, ".scout"));
  expect(existsSync(join(options.home, ".scout"))).toBe(false);
  expect(resolveScoutHome({ ...options, env: { OPENSCOUT_HOME: "/old", SCOUT_HOME: " /new " } })).toBe("/new");
  expect(resolveScoutHome({ ...options, env: { OPENSCOUT_HOME: "/old", SCOUT_HOME: " " } })).toBe("/old");
});
test("read both, prefer new, write only new", () => {
  const options = sandbox();
  for (const root of [".openscout", ".scout"]) mkdirSync(join(options.home, root));
  writeFileSync(join(options.home, ".openscout/config.json"), "legacy");
  expect(scoutHomeReadPath("config.json", options)).toBe(join(options.home, ".openscout/config.json"));
  expect(scoutHomeWritePath("config.json", options)).toBe(join(options.home, ".scout/config.json"));
  writeFileSync(join(options.home, ".scout/config.json"), "new");
  expect(scoutHomeReadPath("config.json", options)).toBe(join(options.home, ".scout/config.json"));
});
test("explicit overrides do not fall back to ambient home", () => {
  const options = sandbox();
  expect(scoutHomeReadRoots({ ...options, env: { OPENSCOUT_HOME: join(options.home, "isolated") } })).toEqual([join(options.home, "isolated")]);
});
test("reject absolute paths and parent traversal", () => {
  const options = sandbox();
  for (const name of ["", "/tmp/outside", "../outside", "x/../../outside"]) {
    expect(() => scoutHomeWritePath(name, options)).toThrow();
    expect(() => scoutHomeReadPath(name, options)).toThrow();
  }
});
test("exclusive owner moves database and sidecars as one directory; repeat is no-op", () => {
  const options = sandbox();
  mkdirSync(join(options.home, ".openscout"));
  for (const name of ["broker.sqlite", "broker.sqlite-wal", "broker.sqlite-shm", "config.json"]) writeFileSync(join(options.home, ".openscout", name), name);
  let checks = 0;
  const migration = { ...options, assertExclusiveOwnership: () => { checks++; } };
  expect(moveLegacyScoutHomeOffline(migration)).toBe("moved");
  expect(checks).toBe(1);
  for (const name of ["broker.sqlite", "broker.sqlite-wal", "broker.sqlite-shm", "config.json"]) expect(readFileSync(join(options.home, ".scout", name), "utf8")).toBe(name);
  expect(moveLegacyScoutHomeOffline(migration)).toBe("absent");
});
test("live/unowned migration is refused without touching data", () => {
  const options = sandbox();
  mkdirSync(join(options.home, ".openscout"));
  expect(() => moveLegacyScoutHomeOffline({ ...options, assertExclusiveOwnership: () => { throw new Error("broker still running"); } })).toThrow("broker still running");
  expect(existsSync(join(options.home, ".openscout"))).toBe(true);
  expect(existsSync(join(options.home, ".scout"))).toBe(false);
});
test("existing destination is not merged, replaced, or deleted", () => {
  const options = sandbox();
  for (const root of [".openscout", ".scout"]) mkdirSync(join(options.home, root));
  expect(() => moveLegacyScoutHomeOffline({ ...options, assertExclusiveOwnership: () => {} })).toThrow("journal");
  expect(existsSync(join(options.home, ".openscout"))).toBe(true);
  expect(existsSync(join(options.home, ".scout"))).toBe(true);
});
test("overrides never migrate; symlink sources are refused", () => {
  const options = sandbox();
  expect(moveLegacyScoutHomeOffline({ ...options, env: { OPENSCOUT_HOME: "/unused" }, assertExclusiveOwnership: () => { throw new Error("not reached"); } })).toBe("overridden");
  mkdirSync(join(options.home, "source"));
  symlinkSync(join(options.home, "source"), join(options.home, ".openscout"));
  expect(() => moveLegacyScoutHomeOffline({ ...options, assertExclusiveOwnership: () => {} })).toThrow("symlink");
});

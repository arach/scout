import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mutateScoutExtension } from "./extension-install.ts";
import { findScoutExtension, scoutExtensionDigest } from "./extensions.ts";
import { findScoutCommandRegistration } from "./registry.ts";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "extension-install-")); dirs.push(root);
  const home = join(root, "extensions"), source = join(root, "artifact");
  mkdirSync(join(source, "bin"), { recursive: true });
  const manifest = (extra = {}) => writeFileSync(join(source, "extension.json"), JSON.stringify({ api: 1, version: "1.0.0", command: "bin/scout-mesh", summary: "Mesh", ...extra }));
  manifest(); writeFileSync(join(source, "bin/scout-mesh"), "#!/bin/sh\nexit 0\n");
  const env = { OPENSCOUT_EXTENSIONS_HOME: home };
  return { root, home, source, env, manifest, change: (action: "install" | "update" | "remove") => mutateScoutExtension(action, "mesh", action === "remove" ? undefined : source, env) };
}
test("installs a detached copy, sets executable mode, and does not flip built-in mesh", () => {
  const f = fixture(); const before = readFileSync(join(f.source, "bin/scout-mesh"));
  expect(f.change("install")).toMatchObject({ status: "installed", version: "1.0.0" });
  const extension = findScoutExtension("mesh", f.env)!;
  expect(extension.refused).toBeUndefined(); expect(lstatSync(join(f.home, "mesh")).isSymbolicLink()).toBe(true);
  rmSync(f.source, { recursive: true });
  expect(readFileSync(extension.command)).toEqual(before);
  expect(findScoutCommandRegistration("mesh")?.name).toBe("mesh");
});
test("atomic update preserves the prior artifact for explicit rollback", () => {
  const f = fixture();f.change("install");const first = scoutExtensionDigest(findScoutExtension("mesh", f.env)!);
  const old = realpathSync(join(f.home, "mesh")); f.manifest({ version: "2.0.0" });
  const result = f.change("update"); expect(result.previousArtifact).toBe(old); expect(result.digest).not.toBe(first);
  expect(existsSync(old)).toBe(true);
  const rollback = mutateScoutExtension("update", "mesh", old, f.env);
  expect(rollback.version).toBe("1.0.0");expect(rollback.digest).toBe(first);
});
test("a bad update leaves the current generation intact, not a legacy fallback", () => {
  const f = fixture();f.change("install");const old = realpathSync(join(f.home, "mesh"));f.manifest({ api: 99 });
  expect(() => f.change("update")).toThrow("extension API");
  expect(realpathSync(join(f.home, "mesh"))).toBe(old);
  expect(readdirSync(f.home).some(n => n.startsWith(".publish-") || n.startsWith(".stage-"))).toBe(false);
  expect(readdirSync(join(f.home, ".locks"))).toEqual([]);
});
test("remove blocks a legacy copy, frees old generations and allows reinstall", () => {
  const f = fixture(); const legacy = join(f.root, "legacy", "extensions", "mesh");mkdirSync(join(legacy, "bin"), { recursive: true });
  writeFileSync(join(legacy, "extension.json"), JSON.stringify({ api: 1, command: "bin/run" }));writeFileSync(join(legacy, "bin/run"), "#!/bin/sh\nexit 0");chmodSync(join(legacy, "bin/run"), 0o700);
  const env = { SCOUT_HOME: f.root, OPENSCOUT_HOME: join(f.root, "legacy") };
  mutateScoutExtension("install", "mesh", f.source, env);mutateScoutExtension("remove", "mesh", undefined, env);
  expect(findScoutExtension("mesh", env)).toMatchObject({ removed: true, refused: expect.stringContaining("was removed") });
  expect(readdirSync(join(f.home, ".installed", "mesh"))).toHaveLength(1);
  expect(mutateScoutExtension("install", "mesh", f.source, env).status).toBe("installed");
});
test("unmanaged or dangling installs are never overwritten or removed", () => {
  const f = fixture();mkdirSync(join(f.home, "mesh"), { recursive: true });
  for (const action of ["install", "update", "remove"] as const) expect(() => f.change(action)).toThrow("unmanaged");
  rmSync(join(f.home, "mesh"), { recursive: true });symlinkSync(join(f.root, "missing"), join(f.home, "mesh"));
  expect(() => f.change("update")).toThrow("unmanaged");
});
test("malformed, unversioned and escaping artifacts fail before activation", () => {
  const f = fixture();
  for (const extra of [{ version: null }, { version: "latest" }, { command: "../escape" }, { command: "/bin/sh" }, { command: "bin/../scout-mesh" }, { disabled: true }]) {
    f.manifest(extra);expect(() => f.change("install")).toThrow();expect(existsSync(join(f.home, "mesh"))).toBe(false);
  }
});
test("symlinks and unsafe installation directories are refused", () => {
  const f = fixture();symlinkSync("/etc/passwd", join(f.source, "extra"));
  expect(() => f.change("install")).toThrow("regular files");rmSync(join(f.source, "extra"));
  chmodSync(f.home, 0o777);expect(() => f.change("install")).toThrow("unsafe");
});
test("a busy install is refused without mutating the active generation", () => {
  const f = fixture();f.change("install");const old = realpathSync(join(f.home, "mesh"));mkdirSync(join(f.home, ".locks", "mesh"));
  expect(() => f.change("update")).toThrow("busy");expect(realpathSync(join(f.home, "mesh"))).toBe(old);
});
test("updates repair a refused managed install", () => {
  const f = fixture();f.change("install");writeFileSync(join(f.home, "mesh", "extension.json"), "not JSON");
  expect(findScoutExtension("mesh", f.env)?.refused).toBeDefined();expect(f.change("update").status).toBe("installed");
});
test("retained generation storage is bounded", () => {
  const f = fixture();f.change("install");for (let i = 0; i < 7; i++) f.change("update");
  expect(() => f.change("update")).toThrow("generation limit");f.change("remove");expect(readdirSync(join(f.home, ".installed", "mesh"))).toHaveLength(1);
});

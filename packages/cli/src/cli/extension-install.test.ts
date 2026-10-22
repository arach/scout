import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mutateScoutExtension, readScoutExtensionInstallReceipt, ScoutExtensionInstallError, type ScoutExtensionInstallOptions } from "./extension-install.ts";
import { findScoutExtension, scoutExtensionDigest } from "./extensions.ts";
import { findScoutCommandRegistration } from "./registry.ts";
import { scoutExtensionTreeDigest } from "./extension-tree-digest.ts";
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

function conditionFailure(run: () => unknown, code: ScoutExtensionInstallError["code"] = "EXTENSION_PRECONDITION_FAILED") {
  try { run(); throw new Error("expected refusal"); }
  catch (error) { expect(error).toBeInstanceOf(ScoutExtensionInstallError); expect((error as ScoutExtensionInstallError).code).toBe(code); }
}
test("conditional install refuses a tombstone created after inspection; explicit reinstall still works", () => {
  const f = fixture();
  const inspected = { expected: { absent: true }, operationId: "fresh-1" } as const;
  expect(existsSync(join(f.home, "mesh"))).toBe(false);
  f.change("install"); f.change("remove");
  const tombstone = realpathSync(join(f.home, "mesh"));
  const before = readdirSync(join(f.home, ".installed", "mesh"));
  conditionFailure(() => mutateScoutExtension("install", "mesh", f.source, f.env, inspected));
  expect(realpathSync(join(f.home, "mesh"))).toBe(tombstone);
  expect(readdirSync(join(f.home, ".installed", "mesh"))).toEqual(before);
  expect(findScoutExtension("mesh", f.env)?.removed).toBe(true);
  expect(f.change("install").status).toBe("installed");
});
test("conditional update refuses a changed generation even when its digest is identical", () => {
  const f = fixture(), inspected = f.change("install");
  const replacement = f.change("update");
  expect(replacement.digest).toBe(inspected.digest);
  expect(replacement.publishedGeneration).not.toBe(inspected.publishedGeneration);
  const before = readdirSync(join(f.home, ".installed", "mesh"));
  conditionFailure(() => mutateScoutExtension("update", "mesh", f.source, f.env, {
    expected: { generation: inspected.publishedGeneration, treeDigest: inspected.treeDigest! }, operationId: "update-race",
  }));
  expect(realpathSync(join(f.home, "mesh"))).toBe(replacement.publishedGeneration);
  expect(readdirSync(join(f.home, ".installed", "mesh"))).toEqual(before);
});
test("conditional update requires the digest too, and cannot repair unknown or removed state", () => {
  const f = fixture(), installed = f.change("install");
  const options = { expected: { generation: installed.publishedGeneration, treeDigest: installed.treeDigest! }, operationId: "checked-update" };
  writeFileSync(join(f.home, "mesh", "bin/scout-mesh"), "#!/bin/sh\nexit 2\n");
  conditionFailure(() => mutateScoutExtension("update", "mesh", f.source, f.env, options));
  writeFileSync(join(f.home, "mesh", "extension.json"), "not JSON");
  conditionFailure(() => mutateScoutExtension("update", "mesh", f.source, f.env, options));
  expect(f.change("update").status).toBe("installed"); // Explicit repair remains supported.
  f.change("remove");
  conditionFailure(() => mutateScoutExtension("update", "mesh", f.source, f.env, options));
  expect(findScoutExtension("mesh", f.env)?.removed).toBe(true);
});
test("conditional install never replaces unmanaged or dangling entries", () => {
  const f = fixture(), options = { expected: { absent: true }, operationId: "unknown" } as const;
  mkdirSync(join(f.home, "mesh"), { recursive: true });
  conditionFailure(() => mutateScoutExtension("install", "mesh", f.source, f.env, options));
  expect(lstatSync(join(f.home, "mesh")).isDirectory()).toBe(true);
  rmSync(join(f.home, "mesh"), { recursive: true }); symlinkSync(join(f.root, "missing"), join(f.home, "mesh"));
  conditionFailure(() => mutateScoutExtension("install", "mesh", f.source, f.env, options));
  expect(lstatSync(join(f.home, "mesh")).isSymbolicLink()).toBe(true);
});
test("conditional successes persist a receipt before stdout and support the next precondition", () => {
  const f = fixture();
  const first = mutateScoutExtension("install", "mesh", f.source, f.env, { expected: { absent: true }, operationId: "install:1" });
  expect(first).toMatchObject({ operationId: "install:1", publishedGeneration: realpathSync(join(f.home, "mesh")) });
  expect(readScoutExtensionInstallReceipt("mesh", f.env)).toEqual(first);
  f.manifest({ version: "2.0.0" });
  const next = mutateScoutExtension("update", "mesh", f.source, f.env, {
    expected: { generation: first.publishedGeneration, treeDigest: first.treeDigest! }, operationId: "update:2",
  });
  expect(next.previousArtifact).toBe(first.publishedGeneration);
  expect(readScoutExtensionInstallReceipt("mesh", f.env)).toEqual(next);
  const rollback = mutateScoutExtension("update", "mesh", first.publishedGeneration, f.env, {
    expected: { generation: next.publishedGeneration, treeDigest: next.treeDigest! }, operationId: "rollback:3",
  });
  expect(rollback.digest).toBe(first.digest);
  expect(rollback.publishedGeneration).not.toBe(first.publishedGeneration);
  expect(readScoutExtensionInstallReceipt("mesh", f.env)).toEqual(rollback);
});
test("a busy public lock wins over the caller's condition", () => {
  const f = fixture(); mkdirSync(join(f.home, ".locks", "mesh"), { recursive: true });
  expect(() => mutateScoutExtension("install", "mesh", f.source, f.env, { expected: { absent: true }, operationId: "busy" })).toThrow("busy");
  expect(existsSync(join(f.home, "mesh"))).toBe(false);
  expect(existsSync(join(f.home, ".receipts"))).toBe(false);
});
test("invalid conditions and correlation IDs fail before creating installation state", () => {
  const f = fixture();
  for (const options of [
    { expected: { absent: true } }, { expected: { absent: false }, operationId: "x" },
    { expected: { generation: "relative", treeDigest: "a".repeat(64) }, operationId: "x" },
    { expected: { generation: "/absolute", treeDigest: "bad" }, operationId: "x" },
    { operationId: "../../bad" }, { operationId: "a\nb" }, { operationId: "x\n" }, { operationId: "x".repeat(129) },
  ]) conditionFailure(() => mutateScoutExtension("install", "mesh", f.source, f.env, options as ScoutExtensionInstallOptions), "EXTENSION_CONDITION_INVALID");
  conditionFailure(() => mutateScoutExtension("remove", "mesh", undefined, f.env, { expected: { absent: true }, operationId: "x" }), "EXTENSION_CONDITION_INVALID");
  conditionFailure(() => mutateScoutExtension("update", "mesh", f.source, f.env, { expected: { generation: "/absolute", treeDigest: "sha256:scout-extension-tree-v1:" + "a".repeat(64) + "\n" }, operationId: "x" }), "EXTENSION_CONDITION_INVALID");
  expect(existsSync(f.home)).toBe(false);
});
test("receipt recovery refuses torn, symlinked, stale or missing records without mutating selection", () => {
  const f = fixture(), receipt = f.change("install"), selected = join(f.home, "mesh");
  const record = join(f.home, ".receipts", "mesh", `${receipt.publishedGeneration.split("/").pop()}.json`);
  const good = readFileSync(record);
  for (const content of ["{", JSON.stringify({ ...receipt, operationId: "../bad" }), JSON.stringify({ ...receipt, digest: "0".repeat(64) }), " ".repeat(32769)]) {
    writeFileSync(record, content);
    conditionFailure(() => readScoutExtensionInstallReceipt("mesh", f.env), "EXTENSION_RECEIPT_UNAVAILABLE");
    expect(realpathSync(selected)).toBe(receipt.publishedGeneration);
  }
  writeFileSync(record, good); chmodSync(record, 0o666);
  conditionFailure(() => readScoutExtensionInstallReceipt("mesh", f.env), "EXTENSION_RECEIPT_UNAVAILABLE");
  chmodSync(record, 0o600); rmSync(record); symlinkSync(join(f.source, "extension.json"), record);
  conditionFailure(() => readScoutExtensionInstallReceipt("mesh", f.env), "EXTENSION_RECEIPT_UNAVAILABLE");
  rmSync(record);
  conditionFailure(() => readScoutExtensionInstallReceipt("mesh", f.env), "EXTENSION_RECEIPT_UNAVAILABLE");
  expect(realpathSync(selected)).toBe(receipt.publishedGeneration);
});
test("receipt recovery refuses group-writable correlation metadata", () => {
  const f = fixture(), receipt = f.change("install");
  const record = join(f.home, ".receipts", "mesh", `${receipt.publishedGeneration.split("/").pop()}.json`);
  expect(readScoutExtensionInstallReceipt("mesh", f.env)).toEqual(receipt);
  chmodSync(record, 0o620); // Group-write without world-write must still refuse.
  conditionFailure(() => readScoutExtensionInstallReceipt("mesh", f.env), "EXTENSION_RECEIPT_UNAVAILABLE");
  expect(realpathSync(join(f.home, "mesh"))).toBe(receipt.publishedGeneration);
  chmodSync(record, 0o600);
  expect(readScoutExtensionInstallReceipt("mesh", f.env)).toEqual(receipt);
});
test("unconditional receipts use null operation ID; remove retains only its selected receipt", () => {
  const f = fixture(), first = f.change("install");
  expect(first.operationId).toBeNull(); expect(readScoutExtensionInstallReceipt("mesh", f.env)).toEqual(first);
  f.change("update"); const removed = f.change("remove");
  expect(readScoutExtensionInstallReceipt("mesh", f.env)).toEqual(removed);
  expect(readdirSync(join(f.home, ".receipts", "mesh"))).toHaveLength(1);
});
test("full-tree conditions and receipts detect auxiliary mode, bytes, additions and renames missed by the legacy digest", () => {
  for (const mutation of ["mode", "bytes", "add", "rename"] as const) {
    const f = fixture(); writeFileSync(join(f.source, "asset"), "asset", { mode: 0o600 });
    const receipt = f.change("install"), artifact = receipt.publishedGeneration;
    if (mutation === "mode") chmodSync(join(artifact, "asset"), 0o700);
    if (mutation === "bytes") writeFileSync(join(artifact, "asset"), "other");
    if (mutation === "add") writeFileSync(join(artifact, "extra"), "extra");
    if (mutation === "rename") renameSync(join(artifact, "asset"), join(artifact, "renamed"));
    expect(scoutExtensionDigest(findScoutExtension("mesh", f.env)!)).toBe(receipt.digest!);
    expect(scoutExtensionTreeDigest(artifact)).not.toBe(receipt.treeDigest!);
    conditionFailure(() => mutateScoutExtension("update", "mesh", f.source, f.env, {
      expected: { generation: artifact, treeDigest: receipt.treeDigest! }, operationId: `changed-${mutation}`,
    }));
    conditionFailure(() => readScoutExtensionInstallReceipt("mesh", f.env), "EXTENSION_RECEIPT_UNAVAILABLE");
    expect(realpathSync(join(f.home, "mesh"))).toBe(artifact);
  }
});
test("installed normalization and relocation reuse the same tree identity, not receipt or generation bytes", () => {
  const f = fixture(); chmodSync(join(f.source, "bin/scout-mesh"), 0o755);
  const source = scoutExtensionTreeDigest(f.source), installed = f.change("install");
  expect(installed.treeDigest).toBe(source);
  expect(scoutExtensionTreeDigest(installed.publishedGeneration)).toBe(installed.treeDigest!);
  const updated = mutateScoutExtension("update", "mesh", f.source, f.env, {
    expected: { generation: installed.publishedGeneration, treeDigest: installed.treeDigest! }, operationId: "new-correlation",
  });
  expect(updated.treeDigest).toBe(installed.treeDigest);
  expect(updated.publishedGeneration).not.toBe(installed.publishedGeneration);
});

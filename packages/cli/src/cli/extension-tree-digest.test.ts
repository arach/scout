import { afterEach, expect, test } from "bun:test";
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scoutExtensionTreeDigest, isScoutExtensionTreeDigest } from "./extension-tree-digest.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(reverse = false) {
  const root = mkdtempSync(join(tmpdir(), "extension-tree-")); roots.push(root);
  const entries: [string, string | null, number][] = [["a", null, 0o700], ["a/run", "#!/bin/sh\nexit 0\n", 0o700], ["empty", null, 0o700], ["z", "z\0\n", 0o600]];
  if (reverse) entries.reverse();
  for (const [name, bytes, mode] of entries) {
    const path = join(root, name);
    if (bytes === null) mkdirSync(path, { recursive: true, mode });
    else { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, bytes, { mode }); }
  }
  return root;
}
const golden = "sha256:scout-extension-tree-v1:52cfd0629061e78199a3b975766a928b4369ef2e3c31f82f9ad839a0885231a3";

test("canonical tree vector fixes domain, byte order, path/type/length frames and empty directories", () => {
  expect(scoutExtensionTreeDigest(fixture())).toBe(golden);
  expect(scoutExtensionTreeDigest(fixture(true))).toBe(golden);
  expect(isScoutExtensionTreeDigest(golden)).toBe(true);
  for (const value of [golden + "\n", golden.toUpperCase(), "0".repeat(64), null, "sha256:scout-extension-tree-v2:" + "0".repeat(64)]) {
    expect(isScoutExtensionTreeDigest(value)).toBe(false);
  }
});
test("a file executable mode flip changes identity", () => {
  const root = fixture(), before = scoutExtensionTreeDigest(root); chmodSync(join(root, "z"), 0o700);
  expect(scoutExtensionTreeDigest(root)).not.toBe(before);
});
test("an added auxiliary file changes identity", () => {
  const root = fixture(), before = scoutExtensionTreeDigest(root); writeFileSync(join(root, "asset"), "auxiliary");
  expect(scoutExtensionTreeDigest(root)).not.toBe(before);
});
test("renaming a file changes identity even when bytes and mode are identical", () => {
  const root = fixture(), before = scoutExtensionTreeDigest(root); renameSync(join(root, "z"), join(root, "renamed"));
  expect(scoutExtensionTreeDigest(root)).not.toBe(before);
});
test("auxiliary bytes, empty-directory presence and entry types change identity", () => {
  const root = fixture(); writeFileSync(join(root, "z"), "y\0\n");
  expect(scoutExtensionTreeDigest(root)).not.toBe(golden);
  writeFileSync(join(root, "z"), "z\0\n"); rmSync(join(root, "empty"), { recursive: true });
  expect(scoutExtensionTreeDigest(root)).not.toBe(golden);
  writeFileSync(join(root, "empty"), "");
  expect(scoutExtensionTreeDigest(root)).not.toBe(golden);
});
test("root location, inode, mtime and non-executable permission bits are not identity", () => {
  const root = fixture(true);
  chmodSync(root, 0o755); chmodSync(join(root, "a"), 0o755); chmodSync(join(root, "a/run"), 0o755); chmodSync(join(root, "z"), 0o644);
  utimesSync(join(root, "z"), new Date(0), new Date(0));
  expect(scoutExtensionTreeDigest(root)).toBe(golden);
});
test("symlink retargets never acquire an identity, inside, outside or dangling", () => {
  const root = fixture(), outside = fixture();
  for (const target of ["z", join(outside, "z"), "missing"]) {
    symlinkSync(target, join(root, "link"));
    expect(() => scoutExtensionTreeDigest(root)).toThrow("symlinks");
    rmSync(join(root, "link"));
  }
  const alias = join(outside, "root-alias"); symlinkSync(root, alias);
  expect(() => scoutExtensionTreeDigest(alias)).toThrow("root must be a directory");
});
test("hard links cannot alias bytes outside the tree", () => {
  const root = fixture(), outside = fixture(); linkSync(join(root, "z"), join(outside, "alias"));
  expect(() => scoutExtensionTreeDigest(root)).toThrow("hard-linked");
});
test("unsafe descendants are refused, not normalized into a trusted identity", () => {
  const root = fixture(); chmodSync(join(root, "z"), 0o666);
  expect(() => scoutExtensionTreeDigest(root)).toThrow("unsafe extension tree");
  chmodSync(join(root, "z"), 0o600);
});
test("entry, depth and byte bounds apply to the complete tree", () => {
  const count = fixture();
  for (let i = 0; i < 1024; i++) writeFileSync(join(count, `extra-${i}`), "");
  expect(() => scoutExtensionTreeDigest(count)).toThrow("1024 entries");
  const deep = fixture(); mkdirSync(join(deep, ...Array.from({ length: 17 }, () => "dir")), { recursive: true });
  expect(() => scoutExtensionTreeDigest(deep)).toThrow("depth 16");
  const large = fixture(); writeFileSync(join(large, "large"), new Uint8Array(32 * 1024 * 1024 + 1));
  expect(() => scoutExtensionTreeDigest(large)).toThrow("32 MiB");
});
test("read-only digest leaves bytes and modes untouched", () => {
  const root = fixture(), before = readFileSync(join(root, "a/run")), mode = statSync(join(root, "a/run")).mode;
  expect(scoutExtensionTreeDigest(root)).toBe(golden);
  expect(readFileSync(join(root, "a/run"))).toEqual(before);
  expect(statSync(join(root, "a/run")).mode).toBe(mode);
});

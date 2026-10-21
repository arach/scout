import { afterEach, expect, spyOn, test } from "bun:test";
import { chmodSync, constants, existsSync, linkSync, mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { checkpointIO, fileIdentity, HandoffStore } from "./store.js";
import { EFFECT_EXCLUSION_CAPABILITY, type EffectExclusionProfile } from "./exclusion-contracts.js";

const profile: EffectExclusionProfile = { kind: EFFECT_EXCLUSION_CAPABILITY, id: "checkpoint-fixture", coverageId: "audit",
  runtimeArtifacts: ["r0"], launcherArtifacts: ["p1"], resourceInventory: { id: "inventory", resources: [{ id: "port", kind: "listener" }] },
  legacyEvidenceId: "legacy", nonOwnerContracts: [] };
const cleanups: (() => void)[] = [];
afterEach(() => { for (const fn of cleanups.splice(0)) fn(); });
async function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "r0-checkpoint-")));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const instance = { uid: process.geteuid!(), id: "checkpoint", supportDirectory: root };
  const store = new HandoffStore(instance); mkdirSync(store.directory, { mode: 0o700 });
  await store.stage({ id: "fixture", minimumRuntimeVersion: "900.0.0", runtimeArtifacts: ["r0"], launcherArtifacts: ["p1"],
    rollbackArtifacts: [], rollbackOpen: true, effectProfiles: { web: profile } }, async () => true);
  await store.exclusive(async tx => {
    tx.state.policy.id = "before" + "x".repeat(700_000);
    tx.state.receipts["web:0:pending"] = { operation: "start", state: "pending", effects: [{ id: "uncertain", kind: "start", state: "intent", carrier: "role-lifetime/7" }] };
    tx.persist();
  });
  const inode = fileIdentity(store.path), anchor = readFileSync(join(store.directory, "identity.json"));
  const persist = () => store.exclusive(async tx => { tx.state.policy.id = "after" + "y".repeat(700_000); tx.persist(); });
  const inspect = () => new HandoffStore(instance).exclusive(async tx => {
    expect(tx.state.receipts["web:0:pending"]).toMatchObject({ state: "pending", effects: [{ state: "intent" }] });
    expect(fileIdentity(store.path)).toEqual(inode);
    expect(readFileSync(join(store.directory, "identity.json"))).toEqual(anchor);
    return tx.state.policy.id.startsWith("after") ? "after" : "before";
  });
  return { store, instance, inode, persist, inspect, pending: join(store.directory, "checkpoint.pending"), prepare: join(store.directory, "checkpoint.prepare") };
}
const phases = [
  ["prepare-write", "write", 1], ["prepare-sync", "sync", 1], ["publish", "rename", 1], ["publish-directory-sync", "sync", 2],
  ["inode-write", "write", 2], ["inode-sync", "sync", 3], ["inode-truncate", "truncate", 1], ["truncate-sync", "sync", 4],
  ["redo-unlink", "unlink", 1], ["unlink-directory-sync", "sync", 5],
] as const;
for (const [name, method, ordinal] of phases) for (const when of ["before", "after"] as const) {
  test(`checkpoint interruption ${when} ${name} recovers without replacing the lock inode`, async () => {
    const f = await fixture(); let count = 0;
    const original = checkpointIO[method] as (...args: any[]) => any;
    const mock = spyOn(checkpointIO, method).mockImplementation((...args: any[]) => {
      const hit = ++count === ordinal;
      if (hit && when === "before") throw new Error("power_cut");
      const result = original(...args);
      if (hit && when === "after") throw new Error("power_cut");
      return result;
    });
    try { await expect(f.persist()).rejects.toThrow("power_cut"); } finally { mock.mockRestore(); }
    const published = phases.findIndex(phase => phase[0] === name) >= 2 && !(name === "publish" && when === "before");
    expect(await f.inspect()).toBe(published ? "after" : "before");
    expect(existsSync(f.pending)).toBe(false);
    await f.persist(); expect(await f.inspect()).toBe("after"); // Also removes an orphan preparation safely.
    expect(existsSync(f.prepare)).toBe(false);
  });
}

test.each([1, 2])("partial checkpoint write %i never exposes a partial authority state", async ordinal => {
  const f = await fixture(); let count = 0;
  const original = checkpointIO.write;
  const mock = spyOn(checkpointIO, "write").mockImplementation((fd, data, offset, length, position) => {
    if (++count === ordinal) { original(fd, data, offset, Math.floor(length / 2), position); throw new Error("torn_write"); }
    return original(fd, data, offset, length, position);
  });
  try { await expect(f.persist()).rejects.toThrow("torn_write"); } finally { mock.mockRestore(); }
  expect(await f.inspect()).toBe(ordinal === 1 ? "before" : "after");
});

async function leavePublished(f: Awaited<ReturnType<typeof fixture>>) {
  const original = checkpointIO.write; let count = 0;
  const mock = spyOn(checkpointIO, "write").mockImplementation((...args) => {
    if (++count === 2) throw new Error("power_cut"); return original(...args);
  });
  try { await expect(f.persist()).rejects.toThrow("power_cut"); } finally { mock.mockRestore(); }
  expect(existsSync(f.pending)).toBe(true);
}

for (const [name, method, ordinal] of phases.filter(([, method, ordinal]) => !(method === "write" && ordinal === 1) && method !== "rename")) for (const when of ["before", "after"] as const) {
  test(`recovery itself can be interrupted ${when} ${name === "prepare-sync" ? "redo-image-sync" : name}`, async () => {
    const f = await fixture(); await leavePublished(f); let count = 0;
    // Recovery re-syncs the published image and directory before install.
    const recoveryOrdinal = method === "write" ? 1 : ordinal;
    const original = checkpointIO[method] as (...args: any[]) => any;
    const mock = spyOn(checkpointIO, method).mockImplementation((...args: any[]) => {
      const hit = ++count === recoveryOrdinal;
      if (hit && when === "before") throw new Error("second_cut");
      const result = original(...args);
      if (hit && when === "after") throw new Error("second_cut");
      return result;
    });
    try { await expect(f.inspect()).rejects.toThrow("second_cut"); } finally { mock.mockRestore(); }
    expect(await f.inspect()).toBe("after"); expect(existsSync(f.pending)).toBe(false);
  });
}

test.each(["hash", "foreign-inode", "bad-image", "mode", "symlink", "hardlink"])("unsafe redo refuses without overwriting authority: %s", async reason => {
  const f = await fixture(); await leavePublished(f);
  if (reason === "hash" || reason === "foreign-inode" || reason === "bad-image") {
    const image = JSON.parse(readFileSync(f.pending, "utf8"));
    if (reason === "hash") image.hash = "0".repeat(64);
    if (reason === "foreign-inode") image.identity.ino = "0";
    if (reason === "bad-image") image.after = "garbage";
    writeFileSync(f.pending, JSON.stringify(image));
  }
  if (reason === "mode") chmodSync(f.pending, 0o644);
  if (reason === "symlink") { rmSync(f.pending); symlinkSync(f.store.path, f.pending); }
  if (reason === "hardlink") linkSync(f.pending, f.pending + ".link");
  const before = readFileSync(f.store.path);
  await expect(f.inspect()).rejects.toThrow(reason === "mode" || reason === "symlink" || reason === "hardlink" ? "unsafe_ownership_path" : "ownership_checkpoint_corrupt");
  expect(readFileSync(f.store.path)).toEqual(before);
});

test("checkpoint keeps the live mutex on the anchored inode through destructive IO", async () => {
  const f = await fixture(), competitor = openSync(f.store.path, constants.O_RDWR);
  const { acquireOwnershipLock } = await import("./store.js");
  const original = checkpointIO.write;
  const mock = spyOn(checkpointIO, "write").mockImplementation((...args) => {
    expect(() => acquireOwnershipLock(competitor)).toThrow("ownership_busy");
    expect(fileIdentity(f.store.path)).toEqual(f.inode);
    return original(...args);
  });
  try { await f.persist(); } finally { mock.mockRestore(); closeSync(competitor); }
  expect(await f.inspect()).toBe("after"); expect(statSync(f.store.path).size).toBeLessThan(1024 * 1024);
});


test("published redo repairs non-prefix torn pages; it does not depend on atomic writes", async () => {
  const f = await fixture(); await leavePublished(f);
  const bytes = readFileSync(f.store.path);
  bytes.fill(0, 73, 193); bytes.fill(0xff, 4000, 5000); writeFileSync(f.store.path, bytes);
  expect(await f.inspect()).toBe("after");
});

test("a stale redo cannot replace a valid later chain", async () => {
  const f = await fixture(); await leavePublished(f); const stale = readFileSync(f.pending);
  expect(await f.inspect()).toBe("after");
  await f.store.exclusive(async tx => { tx.state.policy.rollbackOpen = false; tx.persist(); });
  writeFileSync(f.pending, stale, { mode: 0o600 }); const before = readFileSync(f.store.path);
  await expect(f.inspect()).rejects.toThrow("ownership_checkpoint_corrupt"); expect(readFileSync(f.store.path)).toEqual(before);
});

test("recovery never recreates a missing anchored journal even with valid redo", async () => {
  const f = await fixture(); await leavePublished(f); rmSync(f.store.path);
  await expect(f.inspect()).rejects.toThrow(); expect(existsSync(f.store.path)).toBe(false); expect(existsSync(f.pending)).toBe(true);
});

test("a dangling redo symlink is not mistaken for an absent sidecar", async () => {
  const f = await fixture(); symlinkSync(join(f.store.directory, "missing"), f.pending);
  const before = readFileSync(f.store.path);
  await expect(f.inspect()).rejects.toThrow("unsafe_ownership_path"); expect(readFileSync(f.store.path)).toEqual(before);
});

test("checkpoint root and subsequent suffix reject corruption without redo", async () => {
  const f = await fixture(); await f.persist(); const original = readFileSync(f.store.path, "utf8");
  const root = JSON.parse(original); root.checkpoint.hash = "0".repeat(64); writeFileSync(f.store.path, JSON.stringify(root) + "\n");
  await expect(f.inspect()).rejects.toThrow("ownership_store_corrupt");
  writeFileSync(f.store.path, original); await f.store.exclusive(async tx => { tx.state.policy.id = "small"; tx.persist(); });
  const lines = readFileSync(f.store.path, "utf8").trimEnd().split("\n"); expect(lines.length).toBe(2);
  const tail = JSON.parse(lines[1]!); tail.previous = "0".repeat(64); lines[1] = JSON.stringify(tail);
  writeFileSync(f.store.path, lines.join("\n") + "\n"); await expect(f.inspect()).rejects.toThrow("ownership_store_corrupt");
});


test("wrong instance cannot install valid redo through a read", async () => {
  const f = await fixture(); await leavePublished(f); const before = readFileSync(f.store.path);
  const wrong = new HandoffStore({ ...f.instance, id: "not-this-instance" });
  await expect(wrong.read("web")).rejects.toThrow("wrong_instance");
  expect(readFileSync(f.store.path)).toEqual(before); expect(existsSync(f.pending)).toBe(true);
});

test.each([2, 3])("a validly hashed version-%i chain cannot become a redo base", async version => {
  const f = await fixture(); await leavePublished(f);
  const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest("hex");
  const image = JSON.parse(readFileSync(f.pending, "utf8")); let previous = "";
  const before = Buffer.from(image.before, "base64").toString("utf8").trimEnd().split("\n").map(line => {
    const record = JSON.parse(line); record.state.version = version; record.previous = previous;
    record.hash = digest([record.sequence, previous, record.state]); previous = record.hash; return JSON.stringify(record);
  }).join("\n") + "\n";
  image.before = Buffer.from(before).toString("base64"); image.hash = digest([image.version, image.identity, image.before, image.after]);
  writeFileSync(f.pending, JSON.stringify(image)); const unchanged = readFileSync(f.store.path);
  await expect(f.inspect()).rejects.toThrow("ownership_checkpoint_corrupt"); expect(readFileSync(f.store.path)).toEqual(unchanged);
});

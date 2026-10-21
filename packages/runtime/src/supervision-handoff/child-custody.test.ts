import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DirectChildren, directChildCapability, type DirectChildRecord } from "./child-custody.js";
import * as sigchld from "./sigchld-disposition.js";
import { RetainedChild, type OwnedChildHandle } from "./retained-child.js";
import { nativeDarwinProcessSource } from "./darwin-process-source.js";
import { SupervisionHandoff, HANDOFF_ROLES, LEGACY_ROLE_SURFACES, productionHandoffReadiness,
  type Observation, type SelectedInstance, type ExactChild, type EffectPermit, type HandoffRole } from "./index.js";
import type { DirectChildCommand } from "./child-custody.js";

const roots: string[] = [];
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });
function instance(): SelectedInstance {
  const supportDirectory = realpathSync(mkdtempSync(join(tmpdir(), "r0-child-custody-"))); roots.push(supportDirectory);
  return { uid: process.geteuid!(), id: "child-custody-fixture", supportDirectory };
}
function fake() {
  let resolve!: (value: number) => void, reject!: (error: Error) => void;
  let signals = 0, waitError = false;
  const handle: OwnedChildHandle & { exitCode: number | null; signalCode: string | number | null } = {
    pid: 123, exitCode: null, signalCode: null,
    exited: new Promise((yes, no) => { resolve = yes; reject = no; }), kill: () => { signals++; },
  };
  return { handle, retained: new RetainedChild(handle, () => waitError), resolve, reject, signals: () => signals, setWaitError: () => { waitError = true; } };
}

test("custody: signal before reap uses the retained child handle", async () => {
  const f = fake(); expect(f.retained.signal("SIGTERM")).toBe("signal_requested"); expect(f.signals()).toBe(1);
  f.handle.signalCode = "SIGTERM"; f.resolve(143);
  expect(await f.retained.exit()).toEqual({ code: null, signal: "SIGTERM" });
  expect(f.retained.signal("SIGKILL")).toBe("already_exited"); expect(f.signals()).toBe(1);
});

test("custody: PID reuse after reap, before exited resolves, cannot signal the replacement", async () => {
  const old = fake(), replacement = fake(); // Deterministic same PID, distinct native handle epochs.
  expect(old.handle.pid).toBe(replacement.handle.pid);
  old.handle.exitCode = 0; // Internal reaper has published status; JS promise is still pending.
  let resolved = false; old.handle.exited.then(() => { resolved = true; });
  expect(resolved).toBe(false);
  expect(old.retained.signal("SIGKILL")).toBe("already_exited");
  expect(old.signals()).toBe(0); expect(replacement.signals()).toBe(0);
  expect(replacement.retained.signal("SIGTERM")).toBe("signal_requested"); expect(replacement.signals()).toBe(1);
  old.resolve(0); replacement.handle.signalCode = "SIGTERM"; replacement.resolve(143);
  expect(await old.retained.exit()).toEqual({ code: 0, signal: null }); await replacement.retained.exit();
});

test("wait-error status before exited rejects reports no signal request", async () => {
  const f = fake(); f.setWaitError();
  let settled = false; f.handle.exited.catch(() => { settled = true; });
  expect(settled).toBe(false);
  expect(f.retained.signal("SIGTERM")).toBe("wait_error"); expect(f.signals()).toBe(0);
  f.reject(new Error("native wait failed"));
  await expect(f.retained.exit()).rejects.toThrow("child_exit_unproven");
  expect(f.retained.signal("SIGKILL")).toBe("wait_error"); expect(f.signals()).toBe(0);
});

test.each(["reject", "no-status"])("a wait failure (%s) never becomes exit proof or a later signal", async kind => {
  const f = fake(); if (kind === "reject") f.reject(new Error("wait failed")); else f.resolve(-1);
  await expect(f.retained.exit()).rejects.toThrow("child_exit_unproven");
  expect(f.retained.signal("SIGTERM")).toBe("wait_error"); expect(f.signals()).toBe(0);
});

test("direct child custody is opt-in, does not adopt PIDs and leaves readiness closed", () => {
  const selected = instance(), registry = new DirectChildren(selected);
  expect(() => registry.spawn("web", 2, "effect", { argv: [process.execPath, "-e", ""], cwd: selected.supportDirectory, env: {} })).toThrow("child_custody_not_enabled");
  expect(() => registry.signal({ effectId: "unowned" } as ExactChild, "SIGTERM")).toThrow("child_custody_lost");
  expect(productionHandoffReadiness().ready).toBe(false);
});

test("unproven backend preserves opt-in, duplicate, shape, mapping, then capability refusal order", () => {
  const selected = instance(), registry = new DirectChildren(selected, true);
  const valid: DirectChildCommand = { argv: [process.execPath, "-e", ""], cwd: selected.supportDirectory, env: {} };
  const disposition = spyOn(sigchld, "probeSigchldDisposition").mockReturnValue({ safe: false, reason: "sigchld_probe_unavailable" });
  try {
    const capability = directChildCapability(); expect(capability.available).toBe(false);
    if (capability.available) throw new Error("fixture must remove direct-child capability");
    const malformed = { ...valid, stdio: ["pipe", "ignore", "ignore"] } as unknown as DirectChildCommand;
    expect(() => new DirectChildren(selected).spawn("web", 2, "started", malformed)).toThrow("child_custody_not_enabled");
    // Represent already-retained history without starting a process or granting capability.
    (Reflect.get(registry, "held") as Map<string, unknown>).set("started", { retained: fake().retained, role: "web", generation: 2 });
    expect(() => registry.spawn("web", 2, "started", malformed)).toThrow("child_effect_already_started");
    for (const bad of [
      { ...valid, argv: [undefined] }, { ...valid, argv: [process.execPath, , "argument"] },
      { ...valid, cwd: undefined }, { ...valid, cwd: "/bad\0cwd" },
      { ...valid, env: "not-an-environment" }, { ...valid, env: [] },
      { ...valid, env: { "bad=key": "value" } }, { ...valid, env: { KEY: "bad\0value" } },
      malformed, { ...valid, carrier: "role-lifetime/7", parentChannel: 3 },
    ]) expect(() => registry.spawn("web", 2, "new", bad as DirectChildCommand, 7)).toThrow("invalid_child_command");
    expect(() => registry.spawn("web", 2, "new", valid, 7)).toThrow("carrier_mapping_required");
    const carrier: DirectChildCommand = { ...valid, stdio: ["ignore", "ignore", "ignore"], carrier: "role-lifetime/7" };
    expect(() => registry.spawn("web", 2, "new", carrier)).toThrow("carrier_mapping_required");
    expect(() => registry.spawn("web", 2, "new", carrier, 2)).toThrow("carrier_mapping_required");
    expect(() => registry.spawn("web", 2, "new", valid)).toThrow(capability.reason);
    expect(() => registry.spawn("web", 2, "new", carrier, 7)).toThrow(capability.reason);
    expect(productionHandoffReadiness().ready).toBe(false);
  } finally { disposition.mockRestore(); }
});

const nativeTest = directChildCapability().available ? test : test.skip;
const command = (selected: SelectedInstance, code = "setTimeout(() => process.exit(0), 5000)") => ({
  argv: [process.execPath, "-e", code], cwd: selected.supportDirectory,
  env: { HOME: selected.supportDirectory, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
});

nativeTest("Darwin custody: unreaped zombie reserves the PID, signal before reap, then exact exit", async () => {
  const selected = instance(), registry = new DirectChildren(selected, true);
  const record = registry.spawn("web", 2, "native-effect", command(selected, "setTimeout(() => process.exit(0), 80)"));
  try {
    expect(record.child.pid).toBe(record.sample.pid); expect(record.child.uid).toBe(process.geteuid!());
    const source = nativeDarwinProcessSource(), deadline = performance.now() + 3000;
    let zombie = false;
    // Block only this test's event loop, so Bun has not reaped the child.
    // Darwin proc_bsdinfo.pbi_status is the second uint32; SZOMB is 5.
    while (performance.now() < deadline) {
      const info = source.bsdInfo(record.child.pid, true);
      if (info.count === 136 && info.bytes.readUInt32LE(4) === 5) { zombie = true; break; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
    }
    expect(zombie).toBe(true);
    expect(registry.signal(record.child, "SIGTERM")).toBe("signal_requested");
    expect(await registry.exit(record)).toEqual({ code: 0, signal: null });
    expect(registry.signal(record.child, "SIGKILL")).toBe("already_exited");
    expect(() => registry.signal({ ...record.child, birth: "replacement" }, "SIGKILL")).toThrow("child_custody_lost");
  } finally { registry.signal(record.child, "SIGKILL"); await registry.exit(record); }
});

async function fixture() {
  const selected = instance(); let observation: Observation = { state: "absent", processes: "absent", jobs: "disabled", relaunch: "fenced", inFlight: "quiescent" };
  const absent = structuredClone(observation), role = "web" as const;
  const inspector = { readiness: async () => ({ protocol: 1 as const, ready: true, runtimeVersion: "900.0.0", runtimeArtifact: "fixture-r0",
    launcherArtifact: "fixture-p1", assistantClaims: true, integratedRoles: [...HANDOFF_ROLES] }), observe: async () => structuredClone(observation) };
  const sources = { assertFenced: async () => "fenced" as const,
    capture: async (context: { generation: number; captureId: string }) => ({ format: "legacy-role-capture/1" as const, instance: selected, role,
      ...context, runtimeArtifact: "fixture-r0", surfaces: Object.fromEntries(LEGACY_ROLE_SURFACES.web.map(surface => [surface, []])) }) };
  const sdk = new SupervisionHandoff(selected, inspector, sources, { enableAuditedDirectChildren: true });
  mkdirSync(join(selected.supportDirectory, "supervision-handoff-v1"), { mode: 0o700 });
  await sdk.stage({ id: "fixture-policy", minimumRuntimeVersion: "900.0.0", runtimeArtifacts: ["fixture-r0"], launcherArtifacts: ["fixture-p1"],
    rollbackArtifacts: ["fixture-r0"], rollbackOpen: true }, async () => true);
  const enroll = await sdk.authorize({ role, generation: 0, source: null, target: "R0", action: "enroll", desired: "stopped" }, async () => true);
  await sdk.activate(role, enroll, "stopped");
  const handoff = await sdk.authorize({ role, generation: 1, source: "R0", target: "P1", action: "handoff" }, async () => true);
  await sdk.drain(role, handoff); await sdk.exclusive("R0", role, 1, lease => lease.captureLegacyInventory("capture"));
  await sdk.transfer(role, handoff);
  return { sdk, selected, absent, path: join(selected.supportDirectory, "supervision-handoff-v1/custody.log"),
    observe(value: Observation) { observation = value; }, reopen: () => new SupervisionHandoff(selected, inspector, sources) };
}

nativeTest("birth is durable before observation; exact exit survives reopen, descendants stay named unknown", async () => {
  const f = await fixture(); let child!: ExactChild, escaped!: EffectPermit;
  try {
    await f.sdk.exclusive("P1", "web", 2, async lease => {
      expect(lease.childCoverage()).toEqual({ state: "no_starts", starts: 0, exited: 0 });
      lease.begin("start", "start");
      await lease.perform("start", "start", async permit => {
        escaped = permit; child = permit.spawnChild(command(f.selected));
        expect(readFileSync(f.path, "utf8")).toContain('"format":"bun-darwin-direct-child/1"');
        expect(lease.receipt("start")!.effects[0]!.state).toBe("intent");
        f.observe({ state: "owned", child });
      }); lease.complete("start");
      expect(lease.childCoverage()).toEqual({ state: "unknown", reason: "current_owner_exit_unproven", starts: 1, exited: 0 });
      await expect(lease.recordChildExit("not-an-effect")).rejects.toThrow("child_birth_unproven");
      expect(() => escaped.spawnChild(command(f.selected))).toThrow("effect_scope_closed");
      lease.begin("stop", "stop");
      await lease.perform("stop", "stop", async permit => {
        expect(permit.signalChild("SIGTERM")).toBe("signal_requested");
        await lease.recordChildExit(child.effectId); f.observe(f.absent);
      }); lease.complete("stop");
      expect(lease.childCoverage()).toEqual({ state: "unknown", reason: "current_owner_descendants_unproven", starts: 1, exited: 1 });
      expect(await lease.inspectLegacyAbsence()).toEqual({ state: "unknown" });
    });
    await f.reopen().exclusive("P1", "web", 2, async lease => {
      const before = readFileSync(f.path); await lease.recordChildExit(child.effectId); expect(readFileSync(f.path)).toEqual(before);
      expect(lease.childCoverage().reason).toBe("current_owner_descendants_unproven");
    });
    expect(await f.reopen().inspectRoleAbsence("web", 2)).toEqual({ state: "unknown" });
    expect(productionHandoffReadiness().ready).toBe(false);
  } finally {
    // Owned fixture has a 5s self-exit even if an assertion fails before cleanup.
    if (child) await f.sdk.exclusive("P1", "web", 2, async lease => { await lease.recordChildExit(child.effectId); });
  }
}, 10_000);

nativeTest("custody: crash between effect and observation cannot recover a handle from persisted birth", async () => {
  const f = await fixture(); let child!: ExactChild;
  await expect(f.sdk.exclusive("P1", "web", 2, async lease => {
    lease.begin("crashed-start", "start");
    await lease.perform("crashed-start", "start", async permit => {
      child = permit.spawnChild(command(f.selected));
      f.observe({ state: "owned", child }); throw new Error("fixture crash before observation");
    });
  })).rejects.toThrow("fixture crash before observation");
  // Reconstructing the owner simulates lost process-local handles, not actual
  // parent death. No fixture is orphaned and no installed process is touched.
  const reopened = f.reopen();
  const auth = await reopened.authorize({ role: "web", generation: 2, source: "P1", target: "P1", action: "recover", requestId: "crashed-start" }, async () => true);
  await reopened.exclusive("P1", "web", 2, async lease => {
    expect(lease.childCoverage().reason).toBe("current_owner_exit_unproven");
    f.observe({ state: "owned", child: { ...child, birth: "replacement" } });
    await expect(lease.recover("crashed-start", auth)).rejects.toThrow("identity_unproven");
    f.observe({ state: "owned", child });
    await lease.recover("crashed-start", auth);
    await expect(lease.recordChildExit(child.effectId)).rejects.toThrow("child_custody_lost");
    lease.begin("lost-stop", "stop");
    await expect(lease.perform("lost-stop", "stop", async permit => { permit.signalChild("SIGKILL"); })).rejects.toThrow("child_custody_lost");
  });
  expect(await reopened.inspectRoleAbsence("web", 2)).toEqual({ state: "unknown" });
  // Cleanup/observation uses the original retained handle only. A refused stop
  // still has an intent; recovery never repeats it. Wait for the owned fixture's
  // bounded self-exit, rather than adopting its raw PID in the reopened owner.
  await f.sdk.exclusive("P1", "web", 2, async lease => { await lease.recordChildExit(child.effectId); });
  expect(productionHandoffReadiness().ready).toBe(false);
}, 10_000);


function registryFixture() {
  const selected = instance(), registry = new DirectChildren(selected);
  // Internal-only test seam: never an adoption option on the SDK.
  const held = (registry as unknown as { held: Map<string, { retained: RetainedChild; record?: DirectChildRecord;
    role: HandoffRole; generation: number; channel?: { closeWrite(): void } }> }).held;
  const pending: ReturnType<typeof fake>[] = [];
  const add = (role: HandoffRole, generation: number, effectId: string, recorded = true) => {
    const f = fake(); pending.push(f); let closed = false, closes = 0;
    const child: ExactChild = { uid: selected.uid, instance: selected.id, role, generation, effectId,
      pid: 123, birth: "fixture-birth", executable: "/fixture-child" };
    const record = { child } as DirectChildRecord; // Lookup identity only; no native sample or real process is adopted.
    held.set(effectId, { role, generation, retained: f.retained, record: recorded ? record : undefined,
      channel: { closeWrite() { if (!closed) { closed = true; closes++; } } } });
    return { ...f, record, child, closes: () => closes };
  };
  const settle = async () => { for (const f of pending) { f.handle.exitCode = 0; f.resolve(0); await f.retained.exit(); } };
  return { registry, held, add, settle };
}

test("forget committed generations drops birthless and settled custody, never future or other-role entries", async () => {
  const f = registryFixture();
  const old = f.add("web", 1, "old"), birthless = f.add("web", 2, "birthless", false), current = f.add("web", 3, "current");
  const future = f.add("web", 4, "future"), other = f.add("menu", 1, "other");
  const alreadyWaiting = f.registry.exit(old.record);
  try {
    f.registry.forgetThrough("web", 3);
    expect([...f.held.keys()]).toEqual(["future", "other"]);
    for (const entry of [old, birthless, current]) expect(entry.closes()).toBe(1);
    expect(future.closes()).toBe(0); expect(other.closes()).toBe(0);
    expect(f.registry.has(old.child)).toBe(false); expect(f.registry.pollExit(old.record)).toBeUndefined();
    expect(() => f.registry.signal(old.child, "SIGKILL")).toThrow("child_custody_lost");
    await expect(f.registry.exit(old.record)).rejects.toThrow("child_custody_lost");
    f.registry.forgetThrough("web", 3); f.registry.closeAllParentChannels(); f.registry.closeAllParentChannels();
    for (const entry of [old, birthless, current, future, other]) { expect(entry.closes()).toBe(1); expect(entry.signals()).toBe(0); }
  } finally { await f.settle(); }
  expect(await alreadyWaiting).toEqual({ code: 0, signal: null }); // Existing exact wait may finish; no new handle is adopted.
});

test("five-role held registry stays bounded across 1000 generations and 5000 synthetic starts", async () => {
  const f = registryFixture(); let peak = 0;
  try {
    for (let generation = 1; generation <= 1000; generation++) for (const role of HANDOFF_ROLES) {
      const entry = f.add(role, generation, `${role}-${generation}`); entry.handle.exitCode = 0; entry.resolve(0); await entry.retained.exit();
      peak = Math.max(peak, f.held.size); f.registry.forgetThrough(role, generation - 1);
      expect(f.held.size).toBeLessThanOrEqual(5);
    }
    expect(peak).toBe(6); expect(f.held.size).toBe(5);
    for (const role of HANDOFF_ROLES) f.registry.forgetThrough(role, 1000);
    expect(f.held.size).toBe(0);
  } finally { await f.settle(); }
});

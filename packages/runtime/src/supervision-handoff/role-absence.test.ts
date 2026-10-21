import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SupervisionHandoff, HANDOFF_ROLES, LEGACY_ROLE_SURFACES, productionHandoffReadiness,
  type HandoffRole, type LegacyRoleCapture, type LegacyRoleSources, type ProcessSample, type ProcessSampleResult,
  type RoleCustody } from "./index.js";
import { HandoffStore } from "./store.js";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const absent = { state: "absent", processes: "absent", jobs: "disabled", relaunch: "fenced", inFlight: "quiescent" } as const;
async function fixture(role: HandoffRole = "app-edge", sourcesEnabled = true) {
  const supportDirectory = realpathSync(mkdtempSync(join(tmpdir(), "r0-role-absence-"))); roots.push(supportDirectory);
  const instance = { uid: process.geteuid!(), id: "role-absence-fixture", supportDirectory };
  const sample: ProcessSample = { format: "darwin-bsd-process/1", instance, uid: instance.uid, pid: 123,
    bootSession: "12345678-1234-1234-1234-123456789abc", startSeconds: "123456789", startMicroseconds: "123", executable: "/fixture/worker" };
  let observation: ProcessSampleResult = { state: "pid_absent", pid: 123 };
  let fenced: "fenced" | "unknown" = "fenced", resource: "gone" | "occupied" | "unknown" = "gone", live: string[] = [];
  let captures = 0;
  let manifest: LegacyRoleCapture;
  const sources: LegacyRoleSources = {
    assertFenced: async () => fenced, liveOccupants: async () => [...live], resourceState: async () => resource,
    sampleProcess: () => structuredClone(observation),
    capture: async context => { captures++; return structuredClone(manifest ?? { format: "legacy-role-capture/1", ...context,
      runtimeArtifact: "fixture-r0", surfaces: Object.fromEntries(LEGACY_ROLE_SURFACES[role].map(name => [name, []])) }); },
  };
  const inspector = { readiness: async () => ({ protocol: 1 as const, ready: true, runtimeVersion: "900.0.0", runtimeArtifact: "fixture-r0",
    launcherArtifact: "fixture-p1", assistantClaims: true, integratedRoles: [...HANDOFF_ROLES] }), observe: async () => absent };
  const sdk = new SupervisionHandoff(instance, inspector, sourcesEnabled ? sources : {});
  mkdirSync(join(supportDirectory, "supervision-handoff-v1"), { mode: 0o700 });
  await sdk.stage({ id: "fixture-policy", minimumRuntimeVersion: "900.0.0", runtimeArtifacts: ["fixture-r0"], launcherArtifacts: ["fixture-p1"],
    rollbackArtifacts: ["fixture-r0"], rollbackOpen: true }, async () => true);
  const token = await sdk.authorize({ role, generation: 0, source: null, target: "R0", action: "enroll", desired: "stopped" }, async () => true);
  await sdk.activate(role, token, "stopped");
  const handoff = await sdk.authorize({ role, generation: 1, source: "R0", target: "P1", action: "handoff" }, async () => true);
  const drain = () => sdk.drain(role, handoff);
  const capture = (id = "capture-1") => sdk.exclusive("R0", role, 1, lease => lease.captureLegacyInventory(id));
  const blank = (): LegacyRoleCapture => ({ format: "legacy-role-capture/1", instance, role, generation: 1, captureId: "capture-1",
    runtimeArtifact: "fixture-r0", surfaces: Object.fromEntries(LEGACY_ROLE_SURFACES[role].map(name => [name, []])) });
  return { sdk, role, instance, sources, inspector, sample, blank, drain, capture, handoff, path: join(supportDirectory, "supervision-handoff-v1/custody.log"),
    setManifest(value: LegacyRoleCapture) { manifest = value; }, setObservation(value: ProcessSampleResult) { observation = value; },
    setFence(value: typeof fenced) { fenced = value; }, setResource(value: typeof resource) { resource = value; }, setLive(value: string[]) { live = value; },
    captures: () => captures, reopen: () => new SupervisionHandoff(instance, inspector, sourcesEnabled ? sources : {}) };
}

test.each([...HANDOFF_ROLES])("%s cannot infer absence from missing legacy records or default adapters", async role => {
  const f = await fixture(role, false);
  expect(await f.sdk.inspectRoleAbsence(role, 1)).toEqual({ state: "unknown" });
  await f.drain(); const before = readFileSync(f.path);
  await expect(f.capture()).rejects.toThrow("legacy_capture_unavailable");
  expect(readFileSync(f.path)).toEqual(before);
  expect(await f.sdk.inspectRoleAbsence(role, 1)).toEqual({ state: "unknown" });
  expect(productionHandoffReadiness().ready).toBe(false);
});

test.each([...HANDOFF_ROLES])("%s captures all fixed surfaces and reads them after the exact handoff", async role => {
  const f = await fixture(role); await f.drain(); await f.capture();
  const before = readFileSync(f.path);
  await f.capture(); expect(readFileSync(f.path)).toEqual(before); expect(f.captures()).toBe(1);
  await expect(f.capture("new-capture")).rejects.toThrow("legacy_capture_conflict");
  expect(await f.reopen().inspectRoleAbsence(role, 1)).toEqual(absent);
  await f.sdk.transfer(role, f.handoff);
  await f.reopen().exclusive("P1", role, 2, async lease => {
    // No nested flock: T's absence callback can read within its role scope.
    lease.begin("new-start", "start");
    expect(await lease.inspectLegacyAbsence()).toEqual(absent);
    lease.complete("new-start", "fixture_rejected");
  });
  expect(await f.sdk.inspectRoleAbsence(role, 2)).toEqual(absent);
  expect(await f.sdk.inspectRoleAbsence(role, 1)).toEqual({ state: "unknown" });
});

test("capture requires the authorized R0 drain and refuses revoked consent", async () => {
  const f = await fixture(); await expect(f.capture()).rejects.toThrow("legacy_capture_not_draining");
  await f.drain(); await f.sdk.revoke(f.handoff);
  await expect(f.capture()).rejects.toThrow("invalid_authorization");
  expect(f.captures()).toBe(0);
});

test.each(["coverage", "extra-surface", "wrong-instance", "generation", "artifact", "duplicate", "bad-sample", "capacity", "unknown-field"])("bad capture %s never persists completeness", async reason => {
  const f = await fixture(); await f.drain(); const manifest = f.blank();
  if (reason === "unknown-field") Object.assign(manifest, { complete: true });
  if (reason === "coverage") delete manifest.surfaces.mdns;
  if (reason === "extra-surface") manifest.surfaces.extra = [];
  if (reason === "wrong-instance") manifest.instance = { ...f.instance, id: "another" };
  if (reason === "generation") manifest.generation++;
  if (reason === "artifact") manifest.runtimeArtifact = "unlisted";
  if (reason === "duplicate") manifest.surfaces.mdns = [{ id: "same", kind: "resource", incarnation: "first" }, { id: "same", kind: "resource", incarnation: "second" }];
  if (reason === "bad-sample") manifest.surfaces.caddy = [{ id: "caddy", kind: "process", sample: { ...f.sample, uid: f.instance.uid + 1 } }];
  if (reason === "capacity") manifest.surfaces.mdns = Array.from({ length: 65 }, (_, i) => ({ id: `ad-${i}`, kind: "resource", incarnation: `inc-${i}` }));
  f.setManifest(manifest); const before = readFileSync(f.path);
  await expect(f.capture()).rejects.toThrow(); expect(readFileSync(f.path)).toEqual(before);
  expect(await f.sdk.inspectRoleAbsence(f.role, 1)).toEqual({ state: "unknown" });
});

test.each(["caddy", "mdns"])("positive legacy %s is occupied even without a complete capture", async surface => {
  const f = await fixture(); f.setLive([surface]);
  expect(await f.sdk.inspectRoleAbsence(f.role, 1)).toEqual({ state: "occupied" });
});

test.each(["pid-absent", "boot", "seconds", "microseconds", "exec", "same", "unknown", "foreign-uid", "wrong-pid"])("recorded process disposition %s is conservative", async kind => {
  const f = await fixture(); await f.drain(); const manifest = f.blank();
  manifest.surfaces.caddy = [{ id: "caddy", kind: "process", sample: f.sample }]; f.setManifest(manifest); await f.capture();
  let result: ProcessSampleResult = { state: "sampled", sample: structuredClone(f.sample) };
  if (kind === "pid-absent") result = { state: "pid_absent", pid: f.sample.pid };
  else if (kind === "unknown") result = { state: "unavailable", reason: "permission_denied" };
  else if (kind === "boot") result.sample.bootSession = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  else if (kind === "seconds") result.sample.startSeconds = "123456790";
  else if (kind === "microseconds") result.sample.startMicroseconds = "124";
  else if (kind === "exec") result.sample.executable = "/fixture/exec-replacement";
  else if (kind === "foreign-uid") result.sample.uid++;
  else if (kind === "wrong-pid") result.sample.pid++;
  f.setObservation(result);
  expect(await f.sdk.inspectRoleAbsence(f.role, 1)).toEqual(["pid-absent", "boot", "seconds", "microseconds"].includes(kind)
    ? absent : { state: ["exec", "same"].includes(kind) ? "occupied" : "unknown" });
});

test.each(["occupied", "unknown", "gone"] as const)("publication/listener incarnation must be proven gone (%s)", async state => {
  const f = await fixture(); await f.drain(); const manifest = f.blank();
  manifest.surfaces.mdns = [{ id: "advertisement", kind: "resource", incarnation: "registration-1" }]; f.setManifest(manifest); await f.capture();
  f.setResource(state); expect(await f.sdk.inspectRoleAbsence(f.role, 1)).toEqual(state === "gone" ? absent : { state });
});

test("a lost source fence, failed source read and unrecorded occupant cannot become absence", async () => {
  const f = await fixture(); await f.drain(); await f.capture();
  f.setFence("unknown"); expect(await f.sdk.inspectRoleAbsence(f.role, 1)).toEqual({ state: "unknown" });
  f.setLive(["mdns"]); expect(await f.sdk.inspectRoleAbsence(f.role, 1)).toEqual({ state: "occupied" });
  f.setLive([]); f.setFence("fenced");
  const reopened = new SupervisionHandoff(f.instance, f.inspector, { ...f.sources, liveOccupants: async () => { throw new Error("unreadable"); } });
  expect(await reopened.inspectRoleAbsence(f.role, 1)).toEqual({ state: "unknown" });
});

test("post-read fence failure keeps even an empty complete capture unknown", async () => {
  const f = await fixture(); await f.drain(); await f.capture(); let calls = 0;
  const sdk = new SupervisionHandoff(f.instance, f.inspector, { ...f.sources, assertFenced: async () => ++calls === 1 ? "fenced" : "unknown" });
  expect(await sdk.inspectRoleAbsence(f.role, 1)).toEqual({ state: "unknown" });
});

test("a crash before capture persistence and an uncertain SDK effect remain unknown", async () => {
  const f = await fixture(); await f.drain();
  const failed = new SupervisionHandoff(f.instance, f.inspector, { ...f.sources, capture: async () => { throw new Error("capture-crash"); } });
  await expect(failed.exclusive("R0", f.role, 1, lease => lease.captureLegacyInventory("capture-1"))).rejects.toThrow("capture-crash");
  expect(await f.reopen().inspectRoleAbsence(f.role, 1)).toEqual({ state: "unknown" });
  await f.capture(); await f.sdk.transfer(f.role, f.handoff);
  await expect(f.sdk.exclusive("P1", f.role, 2, async lease => {
    lease.begin("uncertain", "start");
    await lease.perform("uncertain", "start", async () => { throw new Error("lost-effect"); });
  })).rejects.toThrow("lost-effect");
  expect(await f.sdk.inspectRoleAbsence(f.role, 2)).toEqual({ state: "unknown" });
});

test("reads retain the role lock across awaits, and escaped scope readers expire", async () => {
  const f = await fixture(); await f.drain(); await f.capture();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); const ready = new Promise<void>(resolve => { entered = resolve; });
  const sdk = new SupervisionHandoff(f.instance, f.inspector, { ...f.sources, liveOccupants: async () => { entered(); await gate; return []; } });
  const pending = sdk.inspectRoleAbsence(f.role, 1); await ready;
  expect(await f.sdk.inspectRoleAbsence(f.role, 1)).toEqual({ state: "unknown" }); // busy, not absent
  release(); expect(await pending).toEqual(absent);
  let escaped!: RoleCustody;
  await f.sdk.exclusive("R0", f.role, 1, async lease => { escaped = lease; });
  await expect(escaped.inspectLegacyAbsence()).rejects.toThrow("ownership_scope_closed");
});

test("unsafe/corrupt inventory storage is unknown, never absent", async () => {
  const f = await fixture(); await f.drain(); await f.capture(); chmodSync(f.path, 0o666);
  expect(await f.sdk.inspectRoleAbsence(f.role, 1)).toEqual({ state: "unknown" });
  chmodSync(f.path, 0o600);
  const store = new HandoffStore(f.instance);
  await store.exclusive(async tx => { tx.state.legacyCaptures![`${f.role}:1`]!.manifest.surfaces = {}; tx.persist(); });
  expect(await f.sdk.inspectRoleAbsence(f.role, 1)).toEqual({ state: "unknown" });
});

test("reverse/resume generations do not silently reuse old R0 capture certificates", async () => {
  const f = await fixture(); await f.drain(); await f.capture(); await f.sdk.transfer(f.role, f.handoff);
  const reverse = await f.sdk.authorize({ role: f.role, generation: 2, source: "P1", target: "R0", action: "handoff" }, async () => true);
  await f.sdk.drain(f.role, reverse); await f.sdk.transfer(f.role, reverse);
  expect(await f.sdk.inspectRoleAbsence(f.role, 3)).toEqual({ state: "unknown" });
});

test("capture rechecks its fence after collection and pending receipts before persistence", async () => {
  const f = await fixture(); await f.drain(); const before = readFileSync(f.path);
  let calls = 0;
  const changed = new SupervisionHandoff(f.instance, f.inspector, { ...f.sources, assertFenced: async () => ++calls === 1 ? "fenced" : "unknown" });
  await expect(changed.exclusive("R0", f.role, 1, lease => lease.captureLegacyInventory("capture-1"))).rejects.toThrow("legacy_sources_unfenced");
  expect(readFileSync(f.path)).toEqual(before);
  let current!: RoleCustody;
  const concurrent = new SupervisionHandoff(f.instance, f.inspector, { ...f.sources, capture: async () => {
    current.begin("concurrent-stop", "stop"); return f.blank();
  } });
  await expect(concurrent.exclusive("R0", f.role, 1, async lease => {
    current = lease; await lease.captureLegacyInventory("capture-1");
  })).rejects.toThrow("outcome_uncertain");
  expect(await f.sdk.inspectRoleAbsence(f.role, 1)).toEqual({ state: "unknown" });
});

test("capture snapshots cannot be mutated later and native failure never discharges a process", async () => {
  const f = await fixture(); await f.drain(); const manifest = f.blank();
  manifest.surfaces.caddy = [{ id: "caddy", kind: "process", sample: f.sample }]; f.setManifest(manifest); await f.capture();
  manifest.surfaces.caddy = [];
  const unknown = new SupervisionHandoff(f.instance, f.inspector, { ...f.sources, sampleProcess: () => { throw new Error("unreadable kernel record"); } });
  expect(await unknown.inspectRoleAbsence(f.role, 1)).toEqual({ state: "unknown" });
  f.setObservation({ state: "sampled", sample: f.sample });
  expect(await f.sdk.inspectRoleAbsence(f.role, 1)).toEqual({ state: "occupied" });
});

test("a missing resource reader cannot turn an advertisement into absence", async () => {
  const f = await fixture(); await f.drain(); const manifest = f.blank();
  manifest.surfaces.mdns = [{ id: "mdns", kind: "resource", incarnation: "advertisement-1" }]; f.setManifest(manifest); await f.capture();
  const sdk = new SupervisionHandoff(f.instance, f.inspector, { ...f.sources, resourceState: undefined });
  expect(await sdk.inspectRoleAbsence(f.role, 1)).toEqual({ state: "unknown" });
});

test("the finite capture ledger refuses a new record rather than evicting old coverage", async () => {
  const f = await fixture(); await f.drain();
  const store = new HandoffStore(f.instance);
  await store.exclusive(async tx => {
    tx.state.legacyCaptures = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`web:${i + 100}`, { manifest: f.blank(), authorization: "fixture" }]));
    tx.persist();
  });
  const before = readFileSync(f.path);
  await expect(f.capture()).rejects.toThrow("legacy_capture_capacity");
  expect(readFileSync(f.path)).toEqual(before);
});

test("resume invalidates a capture, and a subsequent drain appends without deleting it", async () => {
  const f = await fixture(); await f.drain(); await f.capture();
  const resume = await f.sdk.authorize({ role: f.role, generation: 1, source: "R0", target: "R0", action: "resume" }, async () => true);
  await f.sdk.resume(f.role, resume);
  expect(await f.sdk.inspectRoleAbsence(f.role, 2)).toEqual({ state: "unknown" });
  const next = await f.sdk.authorize({ role: f.role, generation: 2, source: "R0", target: "P1", action: "handoff" }, async () => true);
  await f.sdk.drain(f.role, next);
  await f.sdk.exclusive("R0", f.role, 2, lease => lease.captureLegacyInventory("capture-2"));
  const store = new HandoffStore(f.instance);
  await store.exclusive(async tx => expect(Object.keys(tx.state.legacyCaptures!)).toEqual([`${f.role}:1`, `${f.role}:2`]));
  expect(await f.sdk.inspectRoleAbsence(f.role, 2)).toEqual(absent);
});

test("an inherited legacy inventory cannot hide a subsequently born P1 worker", async () => {
  const f = await fixture(); await f.drain(); await f.capture(); await f.sdk.transfer(f.role, f.handoff);
  let observation: import("./contracts.js").Observation = absent;
  const sdk = new SupervisionHandoff(f.instance, { ...f.inspector, observe: async () => observation }, f.sources);
  await sdk.exclusive("P1", f.role, 2, async lease => {
    lease.begin("born-after-transfer", "start");
    await lease.perform("born-after-transfer", "start", async permit => { permit.atEffect(() => {
      observation = { state: "owned", child: { uid: f.instance.uid, instance: f.instance.id, role: f.role,
        generation: 2, pid: 456, birth: "opaque-native-birth", executable: "fixture-worker", effectId: permit.effectId } };
    }); });
    lease.complete("born-after-transfer");
    expect(await lease.inspectLegacyAbsence()).toEqual({ state: "unknown" });
  });
  await sdk.exclusive("P1", f.role, 2, async lease => {
    lease.begin("later-stop", "stop");
    await lease.perform("later-stop", "stop", async permit => { permit.atEffect(() => { observation = absent; }); });
    lease.complete("later-stop");
  });
  // Current-owner descendant/native coverage is still a separate gate.
  expect(await sdk.inspectRoleAbsence(f.role, 2)).toEqual({ state: "unknown" });
});

test("changing the authorized floor policy invalidates its capture certificate", async () => {
  const f = await fixture(); await f.drain(); await f.capture();
  await f.sdk.closeRollback(async () => true);
  expect(await f.sdk.inspectRoleAbsence(f.role, 1)).toEqual({ state: "unknown" });
  await expect(f.capture()).rejects.toThrow("invalid_authorization");
});

test("a recovered P1 start without a recorded child still counts as a birth attempt", async () => {
  const f = await fixture(); await f.drain(); await f.capture(); await f.sdk.transfer(f.role, f.handoff);
  let admitted = 0;
  await expect(f.sdk.exclusive("P1", f.role, 2, async lease => {
    lease.begin("recovered-birth-attempt", "start");
    await lease.perform("recovered-birth-attempt", "start", async permit => {
      permit.atEffect(() => { admitted++; });
      // A child may exist, but the adapter never records its after-observation.
      throw new Error("crashed-after-admission");
    });
  })).rejects.toThrow("crashed-after-admission");
  expect(admitted).toBe(1);
  expect(await f.reopen().inspectRoleAbsence(f.role, 2)).toEqual({ state: "unknown" });
  const authorization = await f.sdk.authorize({ role: f.role, generation: 2, source: "P1", target: "P1",
    action: "recover", requestId: "recovered-birth-attempt" }, async () => true);
  await f.reopen().exclusive("P1", f.role, 2, async lease => {
    await lease.recover("recovered-birth-attempt", authorization);
    const receipt = lease.receipt("recovered-birth-attempt")!;
    expect(receipt.state).toBe("done");
    expect(receipt.error).toBe("recovered_absent");
    expect(receipt.effects).toHaveLength(1);
    expect(receipt.effects[0]!.state).toBe("confirmed");
    expect(receipt.effects[0]!.child).toBeUndefined();
    // Settling the receipt cannot certify descendants or erase the birth attempt.
    expect(await lease.inspectLegacyAbsence()).toEqual({ state: "unknown" });
  });
  expect(await f.reopen().inspectRoleAbsence(f.role, 2)).toEqual({ state: "unknown" });
  expect(admitted).toBe(1); // Recovery observed; it did not repeat the effect.
});

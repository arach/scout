import { afterEach, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { SupervisionHandoff, EFFECT_EXCLUSION_CAPABILITY, ChildRoleCustody, profileHash, createProcessEvidenceReader, productionHandoffReadiness, carrierChildCapability, CARRIER_LAYOUT,
  type Absence, type DirectChildCommand, type EffectExclusionProfile, type ExactChild, type ExclusionContext, type ExclusionEvidence, type FloorPolicy, type HandoffInspector,
  type Observation, type Readiness } from "./index.js";
import { nativeDarwinProcessSource } from "./darwin-process-source.js";
import { CustodyTransaction, HandoffStore } from "./store.js";
import { DirectChildren } from "./child-custody.js";
import * as layout from "./carrier-layout.js";

const caps = [EFFECT_EXCLUSION_CAPABILITY];
const carrierTest = carrierChildCapability().available ? test : test.skip;
const absence: Absence = { state: "absent", processes: "absent", jobs: "disabled", relaunch: "fenced", inFlight: "quiescent" };
const profile: EffectExclusionProfile = { kind: EFFECT_EXCLUSION_CAPABILITY, id: "cohort-fixture", coverageId: "cohort-audit", runtimeArtifacts: ["r0"], launcherArtifacts: ["p1"],
  resourceInventory: { id: "resources", resources: [{ id: "endpoint", kind: "listener" as const }] }, legacyEvidenceId: "legacy", nonOwnerContracts: ["independent-work"] };
const floor: FloorPolicy = { id: "cohort-policy", minimumRuntimeVersion: "900.0.0", runtimeArtifacts: ["r0"], launcherArtifacts: ["p1"],
  rollbackArtifacts: ["r0"], rollbackOpen: true, effectProfiles: { web: profile } };
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function waitUntil(predicate: () => boolean | Promise<boolean>, ms = 2500) {
  const deadline = performance.now() + ms;
  while (!await predicate()) {
    if (performance.now() > deadline) throw new Error("cohort fixture deadline");
    await Bun.sleep(10);
  }
}
async function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "r0-cohort-effects-"))), runs: string[] = [];
  const instance = { uid: process.geteuid!(), id: "cohort-effects", supportDirectory: root };
  const store = new HandoffStore(instance), controllers: SupervisionHandoff[] = [];
  let observation: Observation = structuredClone(absence), observes = 0, approvals = 0;
  const ready: Readiness = { protocol: 1, ready: true, runtimeVersion: "900.0.0", runtimeArtifact: "r0", launcherArtifact: "p1", assistantClaims: true,
    integratedRoles: ["web"], capabilities: caps, roleEffectCoverage: { web: { profileId: profile.id, profileHash: profileHash(profile), coverageId: profile.coverageId } } };
  const evidence = (context: ExclusionContext): ExclusionEvidence => ({ ...context, state: "observed", coverageId: profile.coverageId,
    resources: { inventoryId: "resources", entries: [{ id: "endpoint", kind: "listener", state: "released" }], unexplained: [] },
    legacy: { evidenceId: "legacy", state: "settled" }, delegated: "settled", relaunch: "fenced", inFlight: "quiescent", descendants: "unproven", nonOwners: [] });
  let inspect: (context: ExclusionContext) => Promise<ExclusionEvidence | { state: "unknown" }> = async context => evidence(context);
  const inspector: HandoffInspector = { readiness: async () => structuredClone(ready), observe: async () => { observes++; return structuredClone(observation); }, exclusion: context => inspect(context) };
  const make = (capabilities = caps) => {
    const sdk = new SupervisionHandoff(instance, inspector, {}, { capabilities, enableAuditedDirectChildren: true }); controllers.push(sdk); return sdk;
  };
  const sdk = make(); mkdirSync(join(root, "supervision-handoff-v1"), { mode: 0o700 });
  await sdk.stage(floor, async () => { approvals++; return true; });
  const token = await sdk.authorize({ role: "web", source: null, target: "R0", generation: 0, action: "enroll", desired: "running" }, async () => { approvals++; return true; });
  await sdk.activate("web", token, "running"); observation = { state: "unknown" }; observes = 0;
  cleanups.push(async () => {
    for (const run of runs) { writeFileSync(join(run, "exit"), ""); writeFileSync(join(run, "desc-exit"), ""); }
    const pids = () => runs.flatMap(run => ["spawn-pid", "desc-pid", "owner-pid"].filter(file => existsSync(join(run, file))).map(file => Number(readFileSync(join(run, file), "utf8"))));
    await waitUntil(() => pids().every(pid => nativeDarwinProcessSource().bsdInfo(pid, true).count === 0), 6500);
    expect(pids().map(pid => nativeDarwinProcessSource().bsdInfo(pid, true).count)).toEqual(pids().map(() => 0));
    for (const controller of controllers) await controller.releaseControllerFences();
    rmSync(root, { recursive: true, force: true });
  });
  const command = (generation = 1, mode = "bounded"): DirectChildCommand => {
    const run = join(root, `run-${generation}`); mkdirSync(run); runs.push(run);
    const config = join(run, "config.json"); writeFileSync(config, JSON.stringify({ instance, generation, mode, root: run }));
    return { argv: [process.execPath, join(import.meta.dir, "cohort-carrier.fixture.ts"), config], cwd: run,
      env: { HOME: run, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" }, stdio: ["ignore", "ignore", "ignore"], carrier: "role-lifetime/7" };
  };
  const start = async (generation = 1, mode = "bounded", crash = false, owner = sdk) => {
    const cmd = command(generation, mode); let child!: ExactChild;
    await owner.exclusive("R0", "web", generation, async lease => {
      lease.begin("start", "start");
      await lease.perform("start", "start", async permit => {
        child = permit.spawnChild(cmd); observation = { state: "owned", child };
        if (crash) throw new Error("fixture_after_spawn");
      });
      lease.complete("start");
    });
    return child;
  };
  const readyRun = async (generation = 1) => { const run = join(root, `run-${generation}`); await waitUntil(() => existsSync(join(run, "ready"))); return run; };
  const retire = async (owner = sdk, id = "stop", generation = 1) => {
    let result: Awaited<ReturnType<typeof sdk.retireCohort>> | undefined;
    await waitUntil(async () => {
      try { result = await owner.retireCohort("R0", "web", generation, id); return true; }
      catch (error) { if ((error as { code?: string }).code !== "ownership_busy") throw error; return false; }
    });
    return result!;
  };
  return { sdk, make, root, instance, store, ready, inspector, command, start, readyRun, retire, evidence,
    setObservation(value: Observation) { observation = value; }, setInspect(fn: typeof inspect) { inspect = fn; },
    observes: () => observes, approvals: () => approvals };
}

carrierTest("profile start uses committed exclusion, retained mapping and one intent per generation, not Absence", async () => {
  const f = await fixture(), child = await f.start(); await f.readyRun();
  expect(f.observes()).toBe(1); // Exact birth confirmation only; no pre-start absence.
  await f.sdk.exclusive("R0", "web", 1, async lease => {
    lease.assertCurrent(); // Parent re-confirms its retained fence after child reports.
    expect(lease.childCoverage()).toMatchObject({ state: "unknown", starts: 1 });
    lease.begin("second", "start");
    await expect(lease.perform("second", "start", async () => {})).rejects.toThrow("cohort_already_started");
  });
  const receipt = await f.store.exclusive(async tx => tx.state.receipts["web:1:start"]);
  expect(receipt!.effects[0]).toMatchObject({ state: "confirmed", carrier: "role-lifetime/7", child });
  expect(productionHandoffReadiness().ready).toBe(false);
});

test.each(["raw", "missing-mapping", "missing-stdio", "numeric-fd", "pipes", "sparse-stdio", "raw-parent", "raw-context", "old-layout"])("profile start refuses unreviewed spawn boundary: %s", async reason => {
  const f = await fixture();
  await f.sdk.exclusive("R0", "web", 1, async lease => {
    lease.begin("start", "start");
    await expect(lease.perform("start", "start", async permit => {
      if (reason === "raw") { permit.atEffect(() => {}); return; }
      const cmd = f.command();
      if (reason === "missing-mapping") delete cmd.carrier;
      if (reason === "missing-stdio") delete cmd.stdio;
      if (reason === "numeric-fd") (cmd as any).carrier = 3;
      if (reason === "pipes") (cmd as any).stdio = ["pipe", "ignore", "ignore"];
      if (reason === "sparse-stdio") (cmd as any).stdio = new Array(3);
      if (reason === "raw-parent") (cmd as any).parentChannel = 3;
      if (reason === "raw-context") (cmd as any).inheritedContext = 4;
      if (reason === "old-layout") (cmd as any).carrier = "role-lifetime/3";
      permit.spawnChild(cmd);
    })).rejects.toThrow(reason === "raw" ? "carrier_spawn_required" : ["pipes", "sparse-stdio", "raw-parent", "raw-context"].includes(reason) ? "invalid_child_command" : "carrier_mapping_required");
  });
  const result = await f.retire(); expect(result.exclusion).toMatchObject({ carriers: "excluded", descendants: "unproven" });
  expect(await f.store.exclusive(async tx => tx.state.receipts["web:1:start"])).toMatchObject({ state: "done", error: "cohort_retired", effects: [{ state: "retired" }] });
});

test.each(["stop", "restart"] as const)("ordinary profile %s receipts refuse before changing intent", async operation => {
  const f = await fixture();
  await expect(f.sdk.exclusive("R0", "web", 1, async lease => lease.begin("unsafe", operation))).rejects.toThrow("cohort_retirement_required");
  expect((await f.sdk.read("web")).desired).toBe("running");
});

carrierTest("exact child crash retires and automatically advances without an operator or false absence", async () => {
  const f = await fixture(); await f.start(); const run = await f.readyRun(), approvals = f.approvals();
  writeFileSync(join(run, "exit"), "");
  await waitUntil(() => nativeDarwinProcessSource().bsdInfo(Number(readFileSync(join(run, "spawn-pid"), "utf8")), true).count === 0);
  f.setObservation({ state: "unknown" });
  const stopped = await f.retire(); expect(stopped.exclusion).not.toHaveProperty("processes");
  await expect(f.sdk.exclusive("R0", "web", 1, async () => {})).rejects.toThrow("cohort_retiring");
  expect(await f.sdk.advanceCohort("R0", "web", 1, "stop")).toMatchObject({ owner: "R0", generation: 2, desired: "running" });
  expect(f.approvals()).toBe(approvals);
  await f.start(2); await f.readyRun(2); expect(f.observes()).toBe(2);
  await expect(f.sdk.exclusive("R0", "web", 1, async () => {})).rejects.toThrow("ownership_changed");
});

carrierTest("a session-independent surviving descendant keeps stop pending and forbids restart", async () => {
  const f = await fixture(); await f.start(1, "descendant"); const run = await f.readyRun();
  const descendant = Number(readFileSync(join(run, "desc-pid"), "utf8"));
  const nextHop = JSON.parse(readFileSync(join(run, "desc-ready"), "utf8"));
  expect(nextHop.flagsBefore & 1).toBe(0); expect(nextHop.flagsAfter & 1).toBe(1); // Explicit remap, then child CLOEXEC.
  await expect(f.sdk.retireCohort("R0", "web", 1, "stop")).rejects.toThrow("ownership_busy");
  await waitUntil(() => nativeDarwinProcessSource().bsdInfo(Number(readFileSync(join(run, "spawn-pid"), "utf8")), true).count === 0);
  const surviving = nativeDarwinProcessSource().bsdInfo(descendant, true);
  expect(surviving.count).toBe(136); expect(surviving.bytes.readUInt32LE(16)).toBe(1); // Reparented after direct-child exit.
  await expect(f.sdk.retireCohort("R0", "web", 1, "stop")).rejects.toThrow("ownership_busy");
  const waiting = readFileSync(join(f.root, "supervision-handoff-v1/custody.log"));
  await expect(f.sdk.retireCohort("R0", "web", 1, "stop")).rejects.toThrow("ownership_busy");
  expect(readFileSync(join(f.root, "supervision-handoff-v1/custody.log"))).toEqual(waiting);
  await expect(f.sdk.advanceCohort("R0", "web", 1, "stop")).rejects.toThrow("cohort_retirement_required");
  expect(await f.sdk.pendingReceipts("web", 1)).toMatchObject([{ operation: "stop", state: "pending", effects: [{ state: "intent" }] }]);
  await expect(f.sdk.acquireLifetimeFence("R0", "web", 1)).rejects.toThrow("cohort_retiring");
  await expect(new ChildRoleCustody(f.instance, caps).check("web", "R0", 1, 3)).rejects.toThrow("ownership_changed");
  writeFileSync(join(run, "desc-exit"), ""); await waitUntil(() => nativeDarwinProcessSource().bsdInfo(descendant, true).count === 0);
  expect(await f.retire()).toMatchObject({ state: "retired", replayed: false });
  await f.sdk.advanceCohort("R0", "web", 1, "stop");
});

carrierTest("a reported non-owner can survive a completed stop without being declared absent", async () => {
  const f = await fixture(); await f.start(1, "non-owner"); const run = await f.readyRun();
  const pid = Number(readFileSync(join(run, "desc-pid"), "utf8")), reader = createProcessEvidenceReader(f.instance);
  f.setInspect(async context => {
    const sample = reader.sample(pid); if (sample.state !== "sampled") throw new Error("missing non-owner");
    return { ...f.evidence(context), nonOwners: [{ id: "independent", contractId: "independent-work", sample: sample.sample }] };
  });
  const result = await f.retire();
  expect(result.exclusion).toMatchObject({ descendants: "unproven", nonOwners: [{ sample: { pid } }] });
  expect(nativeDarwinProcessSource().bsdInfo(pid, true).count).toBe(136);
  expect(await f.sdk.inspectRoleAbsence("web", 1)).toEqual({ state: "unknown" });
  expect(await f.sdk.advanceCohort("R0", "web", 1, "stop")).toMatchObject({ generation: 2 });
});

carrierTest("controller reconstruction can retire an uncertain carrier start without adopting a PID or replaying spawn", async () => {
  const f = await fixture(); await expect(f.start(1, "ignore-parent", true)).rejects.toThrow("fixture_after_spawn");
  const run = await f.readyRun(); await f.sdk.releaseControllerFences();
  const recovery = f.make();
  await expect(recovery.retireCohort("R0", "web", 1, "stop")).rejects.toThrow("ownership_busy");
  const receipt = await f.store.exclusive(async tx => tx.state.receipts["web:1:stop"]);
  expect(receipt!.retirement!.signalAttempted).toBeUndefined(); // No handle in this controller.
  writeFileSync(join(run, "exit"), "");
  await f.retire(recovery);
  expect(await f.store.exclusive(async tx => tx.state.receipts["web:1:start"])).toMatchObject({ state: "done", error: "cohort_retired", effects: [{ state: "retired" }] });
  await recovery.advanceCohort("R0", "web", 1, "stop");
});

test.each(["unknown", "unexplained", "legacy", "delegated"])("a free retirement fence does not replace complete evidence: %s", async reason => {
  const f = await fixture();
  f.setInspect(async context => {
    const e = f.evidence(context);
    if (reason === "unknown") return { state: "unknown" };
    if (reason === "unexplained") e.resources.unexplained = ["listener"];
    if (reason === "legacy") (e.legacy as any).state = "unknown";
    if (reason === "delegated") e.delegated = "covered";
    return e;
  });
  await expect(f.sdk.retireCohort("R0", "web", 1, "stop")).rejects.toThrow("effect_exclusion_unproven");
  expect((await f.sdk.pendingReceipts("web", 1))[0]!.state).toBe("pending");
  await expect(f.sdk.advanceCohort("R0", "web", 1, "stop")).rejects.toThrow("cohort_retirement_required");
  f.setInspect(async context => f.evidence(context)); await f.retire();
});

test("stop and advance replays are inert and do not recreate lost effect rights", async () => {
  const f = await fixture(); const first = await f.retire();
  const before = readFileSync(join(f.root, "supervision-handoff-v1/custody.log"));
  expect(await f.retire()).toEqual({ ...first, replayed: true });
  expect(readFileSync(join(f.root, "supervision-handoff-v1/custody.log"))).toEqual(before);
  await f.sdk.advanceCohort("R0", "web", 1, "stop"); await f.sdk.releaseControllerFences();
  const recovery = f.make(); expect(await recovery.advanceCohort("R0", "web", 1, "stop")).toMatchObject({ generation: 2 });
  await expect(recovery.exclusive("R0", "web", 2, async () => {})).rejects.toThrow("lifetime_fence_required");
  await recovery.acquireLifetimeFence("R0", "web", 2);
});

test("advance re-certifies instead of reusing the stop certificate", async () => {
  const f = await fixture(); await f.retire();
  f.setInspect(async context => ({ ...f.evidence(context), resources: { ...f.evidence(context).resources, unexplained: ["new-listener"] } }));
  await expect(f.sdk.advanceCohort("R0", "web", 1, "stop")).rejects.toThrow("effect_exclusion_unproven");
  expect((await f.sdk.read("web")).generation).toBe(1);
  f.setInspect(async context => f.evidence(context)); await f.sdk.advanceCohort("R0", "web", 1, "stop");
});

test("retirement and same-owner advance enforce capability, generation, IDs and handoff phase", async () => {
  const f = await fixture();
  await expect(f.make([]).retireCohort("R0", "web", 1, "stop")).rejects.toThrow("proof_capability_required");
  await expect(f.sdk.retireCohort("P1", "web", 1, "stop")).rejects.toThrow("ownership_changed");
  await expect(f.sdk.retireCohort("R0", "web", 0, "stop")).rejects.toThrow("ownership_changed");
  await expect(f.sdk.retireCohort("R0", "web", 1, "../bad")).rejects.toThrow("invalid_request_id");
  await f.retire();
  await expect(f.sdk.retireCohort("R0", "web", 1, "other")).rejects.toThrow("cohort_retirement_conflict");
  await expect(f.sdk.retireCohort("R0", "web", 1, "stop", "SIGKILL")).rejects.toThrow("request_id_conflict");
  const token = await f.sdk.authorize({ role: "web", source: "R0", target: "P1", generation: 1, action: "handoff" }, async () => true);
  await f.sdk.drain("web", token);
  await expect(f.sdk.advanceCohort("R0", "web", 1, "stop")).rejects.toThrow("ownership_changed");
  expect(await f.make().transfer("web", token)).toMatchObject({ carriers: "excluded" });
});

test("retirement inside a draining handoff preserves running intent for the incoming owner", async () => {
  const f = await fixture();
  const token = await f.sdk.authorize({ role: "web", source: "R0", target: "P1", generation: 1, action: "handoff" }, async () => true);
  await f.sdk.drain("web", token); await f.retire();
  expect(await f.sdk.read("web")).toMatchObject({ phase: "draining", desired: "running", retirement: { state: "retired" } });
  const incoming = f.make(); await incoming.transfer("web", token);
  expect(await incoming.read("web")).toMatchObject({ owner: "P1", generation: 2, desired: "running" });
});

test("a pre-write advance failure never activates a new generation or keeps its candidate fence", async () => {
  const f = await fixture(); await f.retire();
  const persist = spyOn(CustodyTransaction.prototype, "persist").mockImplementationOnce(() => { throw new Error("fixture_advance_prewrite"); });
  try { await expect(f.sdk.advanceCohort("R0", "web", 1, "stop")).rejects.toThrow("fixture_advance_prewrite"); }
  finally { persist.mockRestore(); }
  expect((await f.sdk.read("web")).generation).toBe(1);
  expect(await f.sdk.advanceCohort("R0", "web", 1, "stop")).toMatchObject({ generation: 2 });
});

test("automatic retirement cannot settle an unmarked pending effect by claiming covered work", async () => {
  const f = await fixture();
  await f.store.exclusive(async tx => { tx.state.receipts["web:1:external"] = { operation: "start", state: "pending", effects: [{ id: "external", kind: "start", state: "intent" }] }; tx.persist(); });
  await expect(f.sdk.retireCohort("R0", "web", 1, "stop")).rejects.toThrow("outcome_uncertain");
});

carrierTest("a descriptor-dropping direct child is not stopped by a free fence; approved non-owner evidence is distinct from exit", async () => {
  const f = await fixture(), child = await f.start(1, "drop"); await f.readyRun(); await f.sdk.releaseControllerFences();
  const recovery = f.make(), reader = createProcessEvidenceReader(f.instance);
  f.setInspect(async context => ({ ...f.evidence(context), resources: { ...f.evidence(context).resources, unexplained: ["live-unclassified-child"] } }));
  await expect(recovery.retireCohort("R0", "web", 1, "stop")).rejects.toThrow("effect_exclusion_unproven");
  f.setInspect(async context => {
    const observed = reader.sample(child.pid); if (observed.state !== "sampled") throw new Error("missing dropped-FD fixture");
    return { ...f.evidence(context), nonOwners: [{ id: "former-child", contractId: "independent-work", sample: observed.sample }] };
  });
  const result = await f.retire(recovery);
  expect(result.exclusion.nonOwners[0]!.sample.pid).toBe(child.pid);
  expect(nativeDarwinProcessSource().bsdInfo(child.pid, true).count).toBe(136);
  expect(await f.store.exclusive(async tx => tx.state.receipts["web:1:start"]!.effects[0]!.directChild!.exit)).toBeUndefined();
});

carrierTest("lost signal acknowledgment leaves a pending stop and never replays the retained-handle signal", async () => {
  const f = await fixture(); await f.start(); await f.readyRun();
  const original = DirectChildren.prototype.signal;
  const signal = spyOn(DirectChildren.prototype, "signal").mockImplementationOnce(function (this: DirectChildren, child, value) {
    original.call(this, child, value); throw new Error("fixture_after_signal");
  });
  try {
    await expect(f.sdk.retireCohort("R0", "web", 1, "stop")).rejects.toThrow("fixture_after_signal");
    await f.retire(); expect(signal).toHaveBeenCalledTimes(1);
  } finally { signal.mockRestore(); }
});

test("retirement commit failure leaves a retryable stop, never a false stopped receipt", async () => {
  const f = await fixture(); let injected = false, restore = () => {};
  f.setInspect(async context => {
    if (!injected) {
      injected = true;
      const persist = spyOn(CustodyTransaction.prototype, "persist").mockImplementationOnce(() => { throw new Error("fixture_retire_prewrite"); });
      restore = () => { persist.mockRestore(); };
    }
    return f.evidence(context);
  });
  try { await expect(f.sdk.retireCohort("R0", "web", 1, "stop")).rejects.toThrow("fixture_retire_prewrite"); }
  finally { restore(); }
  expect(await f.sdk.pendingReceipts("web", 1)).toMatchObject([{ state: "pending" }]);
  expect(await f.retire()).toMatchObject({ state: "retired" });
});

test("generation advance stays serialized across trusted observation awaits", async () => {
  const f = await fixture(); await f.retire();
  let entered!: () => void, release!: () => void;
  const gate = new Promise<void>(resolve => { entered = resolve; }), wait = new Promise<void>(resolve => { release = resolve; });
  f.setInspect(async context => { entered(); await wait; return f.evidence(context); });
  const advance = f.sdk.advanceCohort("R0", "web", 1, "stop"); await gate;
  try { await expect(f.make().advanceCohort("R0", "web", 1, "stop")).rejects.toThrow("ownership_busy"); }
  finally { release(); await advance; }
  expect((await f.sdk.read("web")).generation).toBe(2);
});

test("generic receipt recovery cannot substitute Absence for a pending retirement certificate", async () => {
  const f = await fixture(); f.setInspect(async () => ({ state: "unknown" }));
  await expect(f.sdk.retireCohort("R0", "web", 1, "stop")).rejects.toThrow("effect_exclusion_unproven");
  const token = await f.sdk.authorize({ role: "web", source: "R0", target: "R0", generation: 1, action: "recover", requestId: "stop" }, async () => true);
  f.setObservation(structuredClone(absence));
  await expect(f.sdk.recoverReceipt("R0", "web", 1, "stop", token)).rejects.toThrow("cohort_retirement_required");
  expect((await f.sdk.pendingReceipts("web", 1))[0]!.state).toBe("pending");
});

test("version-2 profile stores remain inspectable but cannot acquire new lifecycle authority", async () => {
  const f = await fixture(), path = join(f.root, "supervision-handoff-v1/custody.log"), original = readFileSync(path);
  // Test-only old-format snapshot. Production never rewrites a journal.
  let previous = "";
  const image = original.toString().trimEnd().split("\n").map(line => {
    const record = JSON.parse(line); record.state.version = 2; record.previous = previous;
    record.hash = createHash("sha256").update(JSON.stringify([record.sequence, previous, record.state], (_key, item) => item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest("hex");
    previous = record.hash; return JSON.stringify(record);
  }).join("\n") + "\n";
  try {
    writeFileSync(path, image);
    expect(await f.sdk.read("web")).toMatchObject({ owner: "R0", generation: 1 });
    await expect(f.sdk.exclusive("R0", "web", 1, async () => {})).rejects.toThrow("cohort_store_version_required");
    await expect(f.sdk.retireCohort("R0", "web", 1, "stop")).rejects.toThrow("cohort_store_version_required");
    await expect(f.sdk.authorize({ role: "web", source: "R0", target: "P1", generation: 1, action: "handoff" }, async () => true)).rejects.toThrow("cohort_store_version_required");
  } finally { writeFileSync(path, original); }
});

carrierTest("a failed wait cannot invent an exit; independent retirement proof still applies", async () => {
  const f = await fixture(); await f.start(); const run = await f.readyRun(); writeFileSync(join(run, "exit"), "");
  await waitUntil(() => nativeDarwinProcessSource().bsdInfo(Number(readFileSync(join(run, "spawn-pid"), "utf8")), true).count === 0);
  const poll = spyOn(DirectChildren.prototype, "pollExit").mockImplementation(() => { throw Object.assign(new Error("child_exit_unproven"), { code: "child_exit_unproven" }); });
  try {
    expect(await f.retire()).toMatchObject({ state: "retired" });
    expect(await f.store.exclusive(async tx => tx.state.receipts["web:1:start"]!.effects[0]!.directChild!.exit)).toBeUndefined();
  } finally { poll.mockRestore(); }
});

test("mapped spawn explicitly refuses the unsafe Bun 1.3.13 extra-FD finalizer backend", async () => {
  const capability = carrierChildCapability();
  if (process.platform !== "darwin" || !["arm64", "x64"].includes(process.arch)) {
    expect(capability).toEqual({ available: false, reason: "child_custody_backend_unproven" }); return;
  }
  if (Bun.revision === "0d9b296af33f2b851fcbf4df3e9ec89751734ba4") {
    expect(capability).toEqual({ available: true, backend: "darwin-borrowed-extra-fd/1" }); return;
  }
  expect(capability).toEqual({ available: false, reason: "carrier_mapping_backend_unproven" });
  const f = await fixture();
  await expect(f.start()).rejects.toThrow("carrier_mapping_backend_unproven");
  expect(await f.retire()).toMatchObject({ state: "retired" }); // No child was spawned.
});

test("layout reserves separate parent, future context and fence slots; native pipe endpoints are CLOEXEC", () => {
  expect(CARRIER_LAYOUT).toEqual({ id: "role-custody/1", parentChannel: 3, reservedContext: 4, fence: 7 });
  if (process.platform !== "darwin") { expect(() => layout.createParentChannel()).toThrow("carrier_layout_unsupported"); return; }
  const channel = layout.createParentChannel();
  try {
    expect(layout.descriptorFlags(channel.reader) & 1).toBe(1);
    expect(layout.descriptorFlags(channel.writer) & 1).toBe(1);
    const mapping = layout.mappingCopy(channel.reader);
    try { expect(mapping.descriptor).toBeGreaterThan(7); expect(layout.descriptorFlags(mapping.descriptor) & 1).toBe(1); }
    finally { mapping.close(); }
    expect(layout.descriptorFlags(channel.reader) & 1).toBe(1); // Closing the mapping copy leaves its source valid.
  } finally { channel.closeRead(); channel.closeWrite(); }
  channel.closeRead(); channel.closeWrite(); // One owner, idempotent cleanup, never a delayed GC close.
  expect(() => layout.markCloseOnExec(-1)).toThrow("carrier_descriptor_flags_failed");
  expect(() => layout.mappingCopy(-1)).toThrow("carrier_mapping_copy_failed");
});

carrierTest("FD 3 stays a live parent pipe across ledger scopes while verified fence FD 7 becomes CLOEXEC", async () => {
  const f = await fixture(), child = await f.start(), run = await f.readyRun();
  const ready = JSON.parse(readFileSync(join(run, "ready"), "utf8"));
  expect(ready.parentIsPipe).toBe(true); expect(ready.flagsBefore & 1).toBe(0); expect(ready.flagsAfter & 1).toBe(1);
  await f.sdk.exclusive("R0", "web", 1, async lease => lease.assertCurrent()); await Bun.sleep(30);
  expect(nativeDarwinProcessSource().bsdInfo(child.pid, true).count).toBe(136);
  expect(existsSync(join(run, "parent-eof"))).toBe(false);
  await f.sdk.releaseControllerFences();
  await waitUntil(() => existsSync(join(run, "parent-eof")) && nativeDarwinProcessSource().bsdInfo(child.pid, true).count === 0);
  expect(await f.retire(f.make())).toMatchObject({ state: "retired" });
});

carrierTest("draining owner release closes its parent channel and preserves the handoff's running intent", async () => {
  const f = await fixture(), child = await f.start(), run = await f.readyRun();
  const token = await f.sdk.authorize({ role: "web", source: "R0", target: "P1", generation: 1, action: "handoff" }, async () => true);
  await f.sdk.drain("web", token); await f.sdk.releaseLifetimeFence("R0", "web", 1);
  await waitUntil(() => existsSync(join(run, "parent-eof")) && nativeDarwinProcessSource().bsdInfo(child.pid, true).count === 0);
  f.setObservation({ state: "unknown" });
  const incoming = f.make(); await incoming.transfer("web", token);
  expect(await incoming.read("web")).toMatchObject({ owner: "P1", generation: 2, desired: "running" });
});

carrierTest("spawn failure closes both SDK-owned pipe endpoints without exposing or leaking them", async () => {
  const f = await fixture(), original = layout.createParentChannel; let reads = 0, writes = 0;
  const create = spyOn(layout, "createParentChannel").mockImplementationOnce(() => {
    const channel = original();
    return { reader: channel.reader, writer: channel.writer,
      closeRead: () => { reads++; channel.closeRead(); }, closeWrite: () => { writes++; channel.closeWrite(); } };
  });
  try {
    await expect(f.sdk.exclusive("R0", "web", 1, async lease => {
      lease.begin("failed-spawn", "start");
      await lease.perform("failed-spawn", "start", async permit => {
        const command = f.command(); command.argv[0] = join(f.root, "nonexistent-executable"); permit.spawnChild(command);
      });
    })).rejects.toThrow();
    expect(create).toHaveBeenCalledTimes(1); expect(reads).toBe(1); expect(writes).toBe(1);
  } finally { create.mockRestore(); }
  expect(await f.retire()).toMatchObject({ state: "retired" });
});

carrierTest("SIGKILL of the actual custodian closes the SDK writer; child parent-loss guard releases the fence", async () => {
  const f = await fixture(), command = f.command(), configFile = command.argv[2]!;
  const config = JSON.parse(readFileSync(configFile, "utf8")); config.readiness = f.ready; writeFileSync(configFile, JSON.stringify(config));
  await f.sdk.releaseControllerFences();
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("OPENSCOUT_") && !key.startsWith("SCOUT_")));
  env.HOME = config.root; env.BUN_RUNTIME_TRANSPILER_CACHE_PATH = "0";
  const owner = Bun.spawn([process.execPath, join(import.meta.dir, "layout-owner.fixture.ts"), configFile], { cwd: config.root, env, stdio: ["pipe", "pipe", "pipe"] });
  const reader = owner.stdout.getReader(), stderr = new Response(owner.stderr).text(); let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const first = await Promise.race([reader.read(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`layout owner readiness deadline: ${existsSync(join(config.root, "owner-stage")) ? readFileSync(join(config.root, "owner-stage"), "utf8") : "not-started"}`)), 3000); })]);
    expect(new TextDecoder().decode(first.value)).toContain("owner-ready"); clearTimeout(timer);
    const run = await f.readyRun(), worker = Number(readFileSync(join(run, "spawn-pid"), "utf8"));
    expect(nativeDarwinProcessSource().bsdInfo(worker, true).count).toBe(136);
    owner.kill("SIGKILL"); await owner.exited; expect(owner.signalCode).toBe("SIGKILL");
    await waitUntil(() => existsSync(join(run, "parent-eof")) && nativeDarwinProcessSource().bsdInfo(worker, true).count === 0);
    expect(await f.retire(f.make())).toMatchObject({ state: "retired" });
    expect(await f.store.exclusive(async tx => tx.state.receipts["web:1:stop"]!.retirement!.signalAttempted)).toBeUndefined();
    expect(await stderr).toBe("");
  } finally { clearTimeout(timer); owner.stdin.end(); owner.kill("SIGKILL"); await owner.exited; reader.releaseLock();
    const errors = await stderr; if (errors) console.error(errors);
  }
}, 10_000);

carrierTest("GC of a retired controller cannot close reused parent/fence source descriptors in the next generation", async () => {
  const f = await fixture(); await f.sdk.releaseControllerFences();
  let outgoing: SupervisionHandoff | undefined = new SupervisionHandoff(f.instance, f.inspector, {}, { capabilities: caps, enableAuditedDirectChildren: true });
  try {
    await outgoing.acquireLifetimeFence("R0", "web", 1); await f.start(1, "bounded", false, outgoing); await f.readyRun();
    await f.retire(outgoing); outgoing = undefined;
    await f.sdk.advanceCohort("R0", "web", 1, "stop");
    for (let index = 0; index < 5; index++) { Bun.gc(true); await Bun.sleep(10); }
    await f.sdk.exclusive("R0", "web", 2, async lease => lease.assertCurrent());
    await f.start(2); const run = await f.readyRun(2);
    expect(existsSync(join(run, "parent-eof"))).toBe(false);
  } finally { await outgoing?.releaseControllerFences(); }
});

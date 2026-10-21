import { afterEach, expect, spyOn, test } from "bun:test";
import { closeSync, constants, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, renameSync, statSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SupervisionHandoff, ChildRoleCustody, EFFECT_EXCLUSION_CAPABILITY, profileHash, productionHandoffReadiness, carrierChildCapability,
  type Absence, type EffectExclusionProfile, type ExclusionContext, type ExclusionEvidence, type FloorPolicy,
  type HandoffInspector, type Observation, type Readiness } from "./index.js";
import { CustodyTransaction, HandoffStore, policyHash } from "./store.js";
import { nativeDarwinProcessSource } from "./darwin-process-source.js";
import type { LifetimeFences } from "./lifetime-fence.js";

// Proof-boundary tests only. The supported SDK no longer exposes its FD;
// production mapping must use the retained permit.spawnChild path.
function testFence(sdk: SupervisionHandoff, store: HandoffStore) {
  return store.exclusive(async tx => (sdk as unknown as { fences: LifetimeFences }).fences.assertCurrent(tx, "web"));
}

const caps = [EFFECT_EXCLUSION_CAPABILITY];
const absent: Absence = { state: "absent", processes: "absent", jobs: "disabled", relaunch: "fenced", inFlight: "quiescent" };
const profile: EffectExclusionProfile = { kind: EFFECT_EXCLUSION_CAPABILITY, id: "fixture-exclusion", coverageId: "fixture-complete-audit",
  runtimeArtifacts: ["fixture-r0"], launcherArtifacts: ["fixture-p1"],
  resourceInventory: { id: "fixture-inventory", resources: [{ id: "listener", kind: "listener" }, { id: "advertisement", kind: "advertisement" }] },
  legacyEvidenceId: "fixture-legacy-audit", nonOwnerContracts: ["fixture-agent-work"], durableWorkContract: "fixture-receipt-contract" };
const floor: FloorPolicy = { id: "fixture-policy", minimumRuntimeVersion: "900.0.0", runtimeArtifacts: ["fixture-r0"],
  launcherArtifacts: ["fixture-p1"], rollbackArtifacts: ["fixture-r0"], rollbackOpen: true, effectProfiles: { web: profile } };
const roots: string[] = [], controllers: SupervisionHandoff[] = [];
afterEach(async () => {
  for (const sdk of controllers.splice(0)) await sdk.releaseControllerFences();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function evidence(context: ExclusionContext): ExclusionEvidence {
  return { ...structuredClone(context), state: "observed", coverageId: profile.coverageId,
    resources: { inventoryId: profile.resourceInventory.id, entries: profile.resourceInventory.resources.map(r => ({ ...r, state: "released" })), unexplained: [] },
    legacy: { evidenceId: profile.legacyEvidenceId, state: "settled" }, delegated: "settled",
    relaunch: "fenced", inFlight: "quiescent", descendants: "unproven", nonOwners: [] };
}
async function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "r0-exclusion-"))); roots.push(root);
  const instance = { uid: process.geteuid!(), id: "fixture-exclusion", supportDirectory: root };
  const ready: Readiness = { protocol: 1, ready: true, runtimeVersion: "900.0.0", runtimeArtifact: "fixture-r0", launcherArtifact: "fixture-p1",
    assistantClaims: true, integratedRoles: ["web"], capabilities: caps,
    roleEffectCoverage: { web: { profileId: profile.id, profileHash: profileHash(profile), coverageId: profile.coverageId } } };
  let observation: Observation = structuredClone(absent), inspect = async (context: ExclusionContext) => evidence(context);
  const inspector: HandoffInspector = { readiness: async () => structuredClone(ready), observe: async () => structuredClone(observation), exclusion: c => inspect(c) };
  const make = (capabilities = caps) => { const sdk = new SupervisionHandoff(instance, inspector, {}, { capabilities }); controllers.push(sdk); return sdk; };
  const sdk = make(); mkdirSync(join(root, "supervision-handoff-v1"), { mode: 0o700 }); await sdk.stage(floor, async () => true);
  const store = new HandoffStore(instance);
  const enroll = async (owner = sdk) => {
    const token = await owner.authorize({ role: "web", generation: 0, source: null, target: "R0", action: "enroll", desired: "running" }, async () => true);
    return owner.activate("web", token, "running");
  };
  const drain = async (owner = sdk) => {
    const state = await owner.read("web");
    const token = await owner.authorize({ role: "web", generation: state.generation, source: state.owner,
      target: state.owner === "R0" ? "P1" : "R0", action: "handoff" }, async () => true);
    await owner.drain("web", token); return token;
  };
  return { root, instance, sdk, make, ready, inspector, enroll, drain, store,
    setObserve(v: Observation) { observation = v; },
    setInspect(fn: typeof inspect) { inspect = fn; } };
}

test("staging prepares separate anchored inodes but enrolls nothing; production stays closed", async () => {
  const f = await fixture();
  const entries = await f.store.exclusive(async tx => ({ identity: tx.state.lifetimeFences?.web, owner: tx.state.roles.web }));
  expect(entries.owner).toEqual({ owner: null, generation: 0, phase: "staged", desired: "stopped" });
  expect(entries.identity?.ino).not.toBe(String(statSync(join(f.root, 'supervision-handoff-v1/custody.log')).ino)); // distinct from transaction lock
  expect(productionHandoffReadiness()).toMatchObject({ ready: false, integratedRoles: [] });
  await expect(f.sdk.exclusive("R0", "web", 0, async lease => lease.assertCurrent())).rejects.toThrow("ownership_changed");
});
test("enrollment persists a hash-bound selection and holds the lifetime fence after the ledger scope", async () => {
  const f = await fixture(); const result = await f.enroll();
  expect(result).toMatchObject({ state: "role_effect_excluded", carriers: "excluded", descendants: "unproven", nonOwners: [] });
  expect(await f.sdk.read("web")).toMatchObject({ owner: "R0", generation: 1, proofProfile: { id: profile.id, hash: profileHash(profile), capability: EFFECT_EXCLUSION_CAPABILITY } });
  await expect(f.make().acquireLifetimeFence("R0", "web", 1)).rejects.toThrow("ownership_busy");
  expect(await f.sdk.read("web")).toMatchObject({ owner: "R0" }); // transaction lock was released
});

test("first enrollment still requires legacy process absence even with an exclusion profile", async () => {
  const f = await fixture(); f.setObserve({ state: "unknown" }); await expect(f.enroll()).rejects.toThrow("absence_unproven");
  expect((await f.sdk.read("web")).owner).toBeNull();
});

test.each(["caller", "runtime", "audit", "artifact"])("the pinned complete coverage and capability must agree: %s", async reason => {
  const f = await fixture();
  if (reason === "runtime") f.ready.capabilities = [];
  if (reason === "audit") f.ready.roleEffectCoverage!.web!.coverageId = "unapproved";
  if (reason === "artifact") f.ready.launcherArtifact = "not-pinned";
  await expect(f.enroll(reason === "caller" ? f.make([]) : f.sdk)).rejects.toThrow(reason === "caller" ? "proof_capability_required"
    : reason === "artifact" ? "r0_contract_unavailable" : "role_effect_coverage_unavailable");
});

test.each(["inventory", "missing-resource", "duplicate-resource", "unreported-nonowner", "unexplained-listener", "unexplained-registration", "unexplained-advertisement", "occupied", "legacy", "delegated", "relaunch", "in-flight", "descendants", "missing-nonowners", "stale-generation", "stale-policy", "wrong-fence"])("a free fence never replaces the other evidence: %s", async reason => {
  const f = await fixture();
  f.setInspect(async context => {
    const e = evidence(context) as { -readonly [K in keyof ExclusionEvidence]: ExclusionEvidence[K] }; // deliberately malformed observations
    if (reason === "inventory") e.resources.inventoryId = "unapproved";
    if (reason === "missing-resource") e.resources.entries.pop();
    if (reason === "duplicate-resource") e.resources.entries[1] = { ...e.resources.entries[0]! };
    if (reason === "unreported-nonowner") e.resources.entries[0] = { ...e.resources.entries[0]!, state: "non_owner", nonOwnerId: "unreported" };
    if (reason.startsWith("unexplained")) e.resources.unexplained = [reason];
    if (reason === "occupied") (e.resources.entries[0] as any).state = "occupied";
    if (reason === "legacy") e.legacy.evidenceId = "unapproved";
    if (reason === "delegated") e.delegated = "unknown" as any;
    if (reason === "relaunch") e.relaunch = "unknown" as any;
    if (reason === "in-flight") e.inFlight = "unknown" as any;
    if (reason === "descendants") e.descendants = "absent" as any;
    if (reason === "missing-nonowners") delete (e as any).nonOwners;
    if (reason === "stale-generation") e.generation++;
    if (reason === "stale-policy") e.policyHash = "old-policy";
    if (reason === "wrong-fence") e.fence = { ...e.fence, ino: "wrong" };
    return e;
  });
  await expect(f.enroll()).rejects.toThrow("effect_exclusion_unproven");
  expect((await f.sdk.read("web")).owner).toBeNull();
  f.setInspect(async c => evidence(c)); await f.enroll(); // failed certification closed its candidate FD
});

test("missing adapter refuses; covered delegated work requires the approved durable contract", async () => {
  const f = await fixture(); const saved = f.inspector.exclusion; delete f.inspector.exclusion;
  await expect(f.enroll()).rejects.toThrow("effect_exclusion_unavailable"); f.inspector.exclusion = saved;
  f.setInspect(async c => ({ ...evidence(c), delegated: "covered", durableWorkContract: "wrong-contract" }));
  await expect(f.enroll()).rejects.toThrow("effect_exclusion_unproven");
  f.setInspect(async c => ({ ...evidence(c), delegated: "covered", durableWorkContract: profile.durableWorkContract }));
  expect(await f.enroll()).toMatchObject({ delegated: "covered", durableWorkContract: profile.durableWorkContract });
});

test("transfer reports living non-owners without turning worker absence into absent", async () => {
  const f = await fixture(); await f.enroll();
  const token = await f.drain(); await f.sdk.releaseLifetimeFence("R0", "web", 1);
  f.setObserve({ state: "unknown" });
  f.setInspect(async c => ({ ...evidence(c), nonOwners: [{ id: "agent", contractId: "fixture-agent-work", sample: {
    format: "darwin-bsd-process/1", instance: f.instance, pid: 12345, uid: f.instance.uid,
    bootSession: "11111111-1111-1111-1111-111111111111", startSeconds: "12345", startMicroseconds: "0", executable: "/fixture/agent" } }] }));
  const incoming = f.make(); const result = await incoming.transfer("web", token);
  expect(result).toMatchObject({ state: "role_effect_excluded", descendants: "unproven", nonOwners: [{ id: "agent" }] });
  expect(result).not.toHaveProperty("processes");
  expect(await incoming.inspectRoleAbsence("web", 2)).toEqual({ state: "unknown" });
  expect(await incoming.read("web")).toMatchObject({ owner: "P1", generation: 2 });
  await incoming.transfer("web", token); // lost reply replay does not reacquire the held fence
  await expect(f.sdk.exclusive("R0", "web", 1, async () => {})).rejects.toThrow("ownership_changed");
});

test("a held controller blocks transfer until it closes its lifetime reference", async () => {
  const f = await fixture(); await f.enroll();
  const fd = await testFence(f.sdk, f.store);
  // The child-side check validates the exact live description, not a PID file.
  const checked = new ChildRoleCustody(f.instance, caps).check("web", "R0", 1, fd);
  if (process.platform === "darwin") expect(await checked).toMatchObject({ state: "verified", closeOnExec: true });
  else await expect(checked).rejects.toThrow("carrier_layout_unsupported");
  const token = await f.drain();
  await expect(f.make().transfer("web", token)).rejects.toThrow("ownership_busy");
  await f.sdk.releaseLifetimeFence("R0", "web", 1);
  expect(await f.make().transfer("web", token)).toMatchObject({ carriers: "excluded" });
});

(carrierChildCapability().available ? test : test.skip).each(["mapped", "wrong-inode"])("bounded child-side custody check and carrier retention: %s", async mode => {
  const f = await fixture(); await f.enroll();
  const descriptor = await testFence(f.sdk, f.store);
  const config = join(f.root, "child-instance.json"); writeFileSync(config, JSON.stringify(f.instance));
  const wrong = mode === "wrong-inode" ? openSync(join(f.root, "other-inode"), constants.O_CREAT | constants.O_RDWR, 0o600) : undefined;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("OPENSCOUT_") && !key.startsWith("SCOUT_")));
  env.HOME = f.root; env.BUN_RUNTIME_TRANSPILER_CACHE_PATH = "0";
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "exclusion-carrier.fixture.ts"), config], {
    cwd: f.root, env, stdio: ["pipe", "pipe", "pipe", "ignore", "ignore", "ignore", "ignore", wrong ?? descriptor],
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stderr = new Response(child.stderr).text();
  const reader = child.stdout.getReader();
  try {
    const first = await Promise.race([reader.read(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("carrier readiness timed out")), 3_000);
    })]);
    const proof = JSON.parse(new TextDecoder().decode(first.value).trim());
    if (mode === "wrong-inode") expect(proof).toEqual({ state: "refused", code: "lifetime_fence_changed" });
    else {
      expect(proof).toMatchObject({ state: "verified", generation: 1, profileId: profile.id });
      expect(proof.fence).toEqual(await f.store.exclusive(async tx => tx.state.lifetimeFences!.web));
      const token = await f.drain(); await f.sdk.releaseLifetimeFence("R0", "web", 1);
      const incoming = f.make();
      await expect(incoming.transfer("web", token)).rejects.toThrow("ownership_busy");
      child.stdin.end(); expect(await child.exited).toBe(0);
      expect(await incoming.transfer("web", token)).toMatchObject({ state: "role_effect_excluded", carriers: "excluded" });
    }
    child.stdin.end(); expect(await child.exited).toBe(0); expect(await stderr).toBe("");
  } finally {
    clearTimeout(timer); child.stdin.end(); child.kill("SIGKILL"); await child.exited;
    reader.releaseLock(); if (wrong !== undefined) closeSync(wrong);
    if (process.platform === "darwin") expect(nativeDarwinProcessSource().bsdInfo(child.pid, true).count).toBe(0); // Include zombies.
  }
}, 10_000);

test("lost controller custody requires the full proof before re-acquiring effect rights", async () => {
  const f = await fixture(); await f.enroll(); await f.sdk.releaseControllerFences();
  const reopened = f.make();
  await expect(reopened.exclusive("R0", "web", 1, async () => {})).rejects.toThrow("lifetime_fence_required");
  f.setInspect(async c => { const e = evidence(c); e.resources.unexplained = ["stray-listener"]; return e; });
  await expect(reopened.acquireLifetimeFence("R0", "web", 1)).rejects.toThrow("effect_exclusion_unproven");
  f.setInspect(async c => evidence(c)); await reopened.acquireLifetimeFence("R0", "web", 1);
  await reopened.exclusive("R0", "web", 1, async lease => lease.assertCurrent());
  expect(await testFence(reopened, f.store)).toBeGreaterThanOrEqual(3);
});

test("a pending receipt cannot be bypassed by closing all controller references", async () => {
  const f = await fixture(); await f.enroll();
  await f.sdk.exclusive("R0", "web", 1, async lease => lease.begin("uncertain", "start"));
  await f.sdk.releaseControllerFences();
  await expect(f.make().acquireLifetimeFence("R0", "web", 1)).rejects.toThrow("outcome_uncertain");
});

test("new profile invalidates authorization, selection and older certificates", async () => {
  const f = await fixture(); await f.enroll(); const token = await f.drain(); await f.sdk.releaseLifetimeFence("R0", "web", 1);
  const oldHash = policyHash(floor);
  await f.store.exclusive(async tx => { tx.state.policy.effectProfiles!.web!.coverageId = "new-audit"; tx.persist(); });
  await expect(f.make().transfer("web", token)).rejects.toThrow("proof_profile_changed");
  await expect(f.make().acquireLifetimeFence("R0", "web", 1)).rejects.toThrow("proof_profile_changed");
  expect(await f.store.exclusive(async tx => policyHash(tx.state.policy))).not.toBe(oldHash);
});

test("candidate fence is retained across proof awaits and only the committed owner gets effect rights", async () => {
  const f = await fixture();
  let entered!: () => void, release!: () => void;
  const enteredGate = new Promise<void>(r => { entered = r; }), wait = new Promise<void>(r => { release = r; });
  f.setInspect(async c => { entered(); await wait; return evidence(c); });
  const activated = f.enroll(); await enteredGate;
  try { await expect(f.make().read("web")).rejects.toThrow("ownership_busy"); }
  finally { release(); await activated; }
  await f.sdk.exclusive("R0", "web", 1, async lease => lease.assertCurrent());
  expect(await testFence(f.sdk, f.store)).toBeGreaterThanOrEqual(3);
});

test("child refuses wrong inode, right inode with a different description, stale generation and missing capability", async () => {
  const f = await fixture(); await f.enroll(); const child = new ChildRoleCustody(f.instance, caps);
  const wrong = openSync(join(f.root, "wrong"), constants.O_CREAT | constants.O_RDWR, 0o600);
  const reopened = openSync(join(f.root, "supervision-handoff-v1/lifetime-web.lock"), constants.O_RDWR);
  try {
    await expect(child.check("web", "R0", 1, wrong)).rejects.toThrow("lifetime_fence_changed");
    await expect(child.check("web", "R0", 1, reopened)).rejects.toThrow("ownership_busy");
    await expect(child.check("web", "R0", 2, wrong)).rejects.toThrow("ownership_changed");
    await expect(new ChildRoleCustody(f.instance, []).check("web", "R0", 1, wrong)).rejects.toThrow("proof_capability_required");
  } finally { closeSync(wrong); closeSync(reopened); }
});

test("missing/replaced lifetime inode refuses, never creates or adopts a replacement", async () => {
  const f = await fixture(); const path = join(f.root, "supervision-handoff-v1/lifetime-web.lock"), original = path + ".original";
  renameSync(path, original);
  try {
    await expect(f.enroll()).rejects.toThrow();
    writeFileSync(path, "", { mode: 0o600 }); await expect(f.enroll()).rejects.toThrow("lifetime_fence_changed");
  } finally { rmSync(path, { force: true }); renameSync(original, path); }
  await f.enroll();
});

test("selection cannot name the custody host as a role or omit the inventory", async () => {
  for (const effectProfiles of [{ runtime: profile }, { web: { ...profile, resourceInventory: { id: "empty", resources: [] } } }]) {
    const f = await fixture();
    const fresh = realpathSync(mkdtempSync(join(tmpdir(), "r0-profile-policy-"))); roots.push(fresh);mkdirSync(join(fresh, "supervision-handoff-v1"), { mode: 0o700 });
    const store = new HandoffStore({ ...f.instance, supportDirectory: fresh });
    await expect(store.stage({ ...floor, effectProfiles } as FloorPolicy, async () => true)).rejects.toThrow("invalid_exclusion_profile");
  }
});

test("profile stores use a one-way schema gate; older absence-only readers must refuse", async () => {
  const f = await fixture();
  const text = readFileSync(join(f.root, "supervision-handoff-v1/custody.log"), "utf8");
  expect(JSON.parse(text.trim()).state.version).toBe(3);
  expect(await f.store.exclusive(async tx => tx.state.version)).toBe(3);
});

test("replaying a completed enrollment still requires the declared profile capability", async () => {
  const f = await fixture();
  const token = await f.sdk.authorize({ role: "web", generation: 0, source: null, target: "R0", action: "enroll", desired: "running" }, async () => true);
  await f.sdk.activate("web", token, "running");
  await expect(f.make([]).activate("web", token, "running")).rejects.toThrow("proof_capability_required");
});

test.each(["cached", "absence-fields"])("stale or ambiguous observation data cannot become a certificate: %s", async reason => {
  const f = await fixture(); let cache: ExclusionEvidence | undefined;
  f.setInspect(async context => { const e = evidence(context); cache = structuredClone(e); e.resources.unexplained = ["fixture-block"]; return e; });
  await expect(f.enroll()).rejects.toThrow("effect_exclusion_unproven");
  f.setInspect(async context => reason === "cached" ? cache! : ({ ...evidence(context), processes: "absent" }));
  await expect(f.enroll()).rejects.toThrow("effect_exclusion_unproven");
});

test("pending delegated input cannot be hidden by reporting covered external work", async () => {
  const f = await fixture(); await f.enroll();
  await f.sdk.exclusive("R0", "web", 1, async lease => lease.begin("accepted-input", "start"));
  f.setInspect(async context => ({ ...evidence(context), delegated: "covered", durableWorkContract: profile.durableWorkContract }));
  await expect(f.drain()).rejects.toThrow("outcome_uncertain");
});

test("reverse and resume keep the durable profile and never require killing reported non-owners", async () => {
  const f = await fixture(); await f.enroll(); f.setObserve({ state: "unknown" });
  const first = await f.drain(); await f.sdk.releaseLifetimeFence("R0", "web", 1);
  const p1 = f.make(); await p1.transfer("web", first);
  const reverse = await f.drain(p1); await p1.releaseLifetimeFence("P1", "web", 2);
  const r0 = f.make(); await r0.transfer("web", reverse);
  expect(await r0.read("web")).toMatchObject({ owner: "R0", generation: 3, proofProfile: { hash: profileHash(profile) } });
  await f.drain(r0); await r0.releaseLifetimeFence("R0", "web", 3);
  const resume = await r0.authorize({ role: "web", source: "R0", generation: 3, target: "R0", action: "resume" }, async () => true);
  const result = await r0.resume("web", resume);
  expect(result).toMatchObject({ state: "role_effect_excluded", descendants: "unproven" });
  expect(await r0.read("web")).toMatchObject({ owner: "R0", generation: 4, proofProfile: { hash: profileHash(profile) } });
});

test("observation-only recovery settles a receipt after custody loss without effect rights", async () => {
  const f = await fixture(); await f.enroll();
  await f.sdk.exclusive("R0", "web", 1, async lease => lease.begin("pending", "start"));
  await f.sdk.releaseControllerFences(); const recovery = f.make();
  const token = await recovery.authorize({ role: "web", source: "R0", generation: 1, target: "R0", action: "recover", requestId: "pending" }, async () => true);
  f.setObserve({ state: "unknown" });
  await expect(recovery.recoverReceipt("R0", "web", 1, "pending", token)).rejects.toThrow("outcome_uncertain");
  f.setObserve(structuredClone(absent)); await recovery.recoverReceipt("R0", "web", 1, "pending", token);
  expect(await recovery.pendingReceipts("web", 1)).toEqual([]);
  await expect(recovery.exclusive("R0", "web", 1, async () => {})).rejects.toThrow("lifetime_fence_required");
  await recovery.acquireLifetimeFence("R0", "web", 1);
});

test("inode substitution during the trusted observation refuses before owner commit", async () => {
  const f = await fixture(), path = join(f.root, "supervision-handoff-v1/lifetime-web.lock"), saved = path + ".saved";
  f.setInspect(async context => {
    renameSync(path, saved); writeFileSync(path, "", { mode: 0o600 });
    return evidence(context);
  });
  try {
    await expect(f.enroll()).rejects.toThrow("lifetime_fence_changed");
    expect((await f.sdk.read("web")).owner).toBeNull();
  } finally { rmSync(path, { force: true }); renameSync(saved, path); }
  f.setInspect(async context => evidence(context)); await f.enroll();
});

test("a pre-write commit failure closes the candidate fence without enabling effects", async () => {
  const f = await fixture();
  const token = await f.sdk.authorize({ role: "web", generation: 0, source: null, target: "R0", action: "enroll", desired: "running" }, async () => true);
  // Inject before any bytes: this does not simulate or authorize repair of a
  // torn write or an uncertain fsync, which remain the store's refusal cases.
  const persist = spyOn(CustodyTransaction.prototype, "persist").mockImplementationOnce(() => { throw new Error("fixture_prewrite_failure"); });
  try { await expect(f.sdk.activate("web", token, "running")).rejects.toThrow("fixture_prewrite_failure"); }
  finally { persist.mockRestore(); }
  expect((await f.sdk.read("web")).owner).toBeNull();
  await expect(f.sdk.exclusive("R0", "web", 1, async () => {})).rejects.toThrow("ownership_changed");
  expect(await f.sdk.activate("web", token, "running")).toMatchObject({ carriers: "excluded" });
});

test("the correct inode without any held lifetime lock is not child custody", async () => {
  const f = await fixture(); await f.enroll(); await f.sdk.releaseControllerFences();
  const fd = openSync(join(f.root, "supervision-handoff-v1/lifetime-web.lock"), constants.O_RDWR);
  try { await expect(new ChildRoleCustody(f.instance, caps).check("web", "R0", 1, fd)).rejects.toThrow("carrier_lock_unheld"); }
  finally { closeSync(fd); }
  await f.make().acquireLifetimeFence("R0", "web", 1); // The check did not leave a lock behind.
});

test("a journal cannot downgrade its format after profile staging", async () => {
  const f = await fixture(), path = join(f.root, "supervision-handoff-v1/custody.log"), original = readFileSync(path);
  try {
    // Test-only malformed history, not a supported migration/repair path.
    await f.store.exclusive(async tx => {
      tx.state.version = 1; delete tx.state.policy.effectProfiles; delete tx.state.lifetimeFences; tx.persist();
    });
    await expect(f.sdk.read("web")).rejects.toThrow("ownership_store_corrupt");
  } finally { writeFileSync(path, original); }
});

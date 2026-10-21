import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SupervisionHandoff, HANDOFF_ROLES, productionHandoffReadiness,
  type Absence, type ExactChild, type FloorPolicy, type HandoffInspector, type Observation, type Readiness, type RoleCustody } from "./index.js";

const roots: string[] = [];
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });
const absent: Absence = { state: "absent", processes: "absent", jobs: "disabled", relaunch: "fenced", inFlight: "quiescent" };
const policy: FloorPolicy = { id: "fixture-floor", minimumRuntimeVersion: "900.0.0", runtimeArtifacts: ["fixture-r0"],
  launcherArtifacts: ["fixture-p1"], rollbackArtifacts: ["fixture-r0"], rollbackOpen: true };
async function fixture(enroll = true) {
  const path = realpathSync(mkdtempSync(join(tmpdir(), "r0-custody-"))); roots.push(path);
  const instance = { uid: process.getuid!(), id: "fixture", supportDirectory: path };
  const ready: Readiness = { protocol: 1, ready: true, runtimeVersion: "900.0.0", runtimeArtifact: "fixture-r0",
    launcherArtifact: "fixture-p1", assistantClaims: true, integratedRoles: [...HANDOFF_ROLES] };
  let observation: Observation = structuredClone(absent); let effects = 0;
  const inspector: HandoffInspector = { readiness: async () => structuredClone(ready), observe: async () => structuredClone(observation) };
  const sdk = new SupervisionHandoff(instance, inspector);
  mkdirSync(join(path, "supervision-handoff-v1"), { mode: 0o700 });
  if (enroll) await sdk.stage(policy, async () => true);
  const reopen = () => new SupervisionHandoff(instance, inspector);
  const activate = async (desired: "running" | "stopped" = "running") => {
    const token = await sdk.authorize({ role: "web", generation: 0, source: null, target: "R0", action: "enroll", desired }, async () => true);
    await sdk.activate("web", token, desired); return token;
  };
  const authorize = async (action: "handoff" | "resume" | "recover", target: "R0" | "P1", requestId?: string) => {
    const current = await sdk.read("web");
    return sdk.authorize({ role: "web", generation: current.generation, source: current.owner, target, action, ...(requestId ? { requestId } : {}) }, async () => true);
  };
  const start = async (lease: RoleCustody, id = "start") => {
    lease.begin(id, "start");
    await lease.perform(id, "start", async permit => { permit.atEffect(() => {
      effects++;
      observation = { state: "owned", child: { uid: instance.uid, instance: instance.id, role: "web", generation: lease.ownership().generation,
        pid: 123, birth: "fixture-birth", executable: "fixture-worker", effectId: permit.effectId } };
    }); });
    lease.complete(id);
  };
  const stop = async (lease: RoleCustody, id = "stop") => {
    lease.begin(id, "stop");
    await lease.perform(id, "stop", async permit => { permit.atEffect(() => { effects++; observation = structuredClone(absent); }); });
    lease.complete(id);
  };
  return { path, instance, sdk, inspector, ready, reopen, activate, authorize, start, stop,
    setObservation(value: Observation) { observation = value; }, observe: () => observation, effects: () => effects };
}

test("staging, import and handshake never activate a role; production gate stays closed", async () => {
  const f = await fixture(false);
  expect(productionHandoffReadiness()).toMatchObject({ ready: false, integratedRoles: [] });
  await expect(f.sdk.read("web")).rejects.toThrow();
  await expect(f.sdk.stage(policy, async () => false)).rejects.toThrow("operator_authorization_required");
  await f.sdk.stage(policy, async () => true);
  const hello = await f.sdk.handshake({ protocol: 1, instance: f.instance });
  for (const role of Object.values(hello.roles)) expect(role).toEqual({ owner: null, phase: "staged", generation: 0, desired: "stopped" });
  expect(f.effects()).toBe(0);
  await expect(f.sdk.handshake({ protocol: 2, instance: f.instance })).rejects.toThrow("protocol_incompatible");
  await expect(f.sdk.handshake({ protocol: 1, instance: { ...f.instance, id: "other" } })).rejects.toThrow("wrong_instance");
});

test("authorization binds desired intent, role, generation and instance, and is replayable once", async () => {
  const f = await fixture();
  const token = await f.sdk.authorize({ role: "web", generation: 0, source: null, target: "R0", action: "enroll", desired: "stopped" }, async () => true);
  await expect(f.sdk.activate("web", token, "running")).rejects.toThrow("invalid_authorization");
  await f.sdk.activate("web", token, "stopped"); await f.reopen().activate("web", token, "stopped");
  expect(await f.sdk.read("web")).toMatchObject({ owner: "R0", generation: 1, desired: "stopped" });
  await expect(f.sdk.activate("scoutbot", token, "stopped")).rejects.toThrow();
  expect(readFileSync(join(f.path, "supervision-handoff-v1/custody.log"), "utf8")).not.toContain(token);
});

test.each(["ready", "version", "artifact", "coverage"])("version agreement is not ownership (%s)", async reason => {
  const f = await fixture();
  if (reason === "ready") f.ready.ready = false;
  if (reason === "version") f.ready.runtimeVersion = "899.0.0";
  if (reason === "artifact") f.ready.runtimeArtifact = "unapproved";
  if (reason === "coverage") f.ready.integratedRoles = [];
  await expect(f.activate()).rejects.toThrow("r0_contract_unavailable");
  expect((await f.sdk.read("web")).owner).toBeNull();
});

test.each(["processes", "jobs", "relaunch", "inFlight"])("unknown absence component %s blocks enrollment and transfer", async field => {
  const f = await fixture(); f.setObservation({ ...absent, [field]: "unknown" } as unknown as Observation);
  await expect(f.activate()).rejects.toThrow("absence_unproven"); expect(f.effects()).toBe(0);
  f.setObservation(structuredClone(absent)); await f.activate();
  const transfer = await f.authorize("handoff", "P1"); await f.sdk.drain("web", transfer);
  f.setObservation({ ...absent, [field]: "unknown" } as unknown as Observation);
  await expect(f.sdk.transfer("web", transfer)).rejects.toThrow("absence_unproven");
  expect(await f.sdk.read("web")).toMatchObject({ owner: "R0", generation: 1, phase: "draining" });
});

test("forward handoff keeps running intent, fences R0 restarts and replays a lost transfer reply", async () => {
  const f = await fixture(); await f.activate();
  await f.sdk.exclusive("R0", "web", 1, lease => f.start(lease));
  const token = await f.authorize("handoff", "P1"); await f.sdk.drain("web", token);
  await expect(f.reopen().exclusive("R0", "web", 1, async lease => lease.begin("gui-reopen", "start"))).rejects.toThrow("role_draining_or_stopped");
  await expect(f.sdk.transfer("web", token)).rejects.toThrow("absence_unproven");
  await f.sdk.exclusive("R0", "web", 1, lease => f.stop(lease, "drain-stop"));
  expect((await f.sdk.read("web")).desired).toBe("running");
  await f.sdk.transfer("web", token); await f.reopen().transfer("web", token);
  expect(await f.sdk.read("web")).toEqual({ owner: "P1", generation: 2, phase: "active", desired: "running" });
  await expect(f.reopen().exclusive("R0", "web", 1, async () => {})).rejects.toThrow("ownership_changed");
  await f.sdk.exclusive("P1", "web", 2, lease => f.start(lease, "p1-start")); expect(f.effects()).toBe(3);
});

test("stopped intent remains stopped through forward, reverse and resume transitions", async () => {
  const f = await fixture(); await f.activate("stopped");
  const forward = await f.authorize("handoff", "P1"); await f.sdk.drain("web", forward); await f.sdk.transfer("web", forward);
  const reverse = await f.authorize("handoff", "R0"); await f.sdk.drain("web", reverse); await f.sdk.transfer("web", reverse);
  expect(await f.sdk.read("web")).toMatchObject({ owner: "R0", generation: 3, desired: "stopped" });
  const abandoned = await f.authorize("handoff", "P1"); await f.sdk.drain("web", abandoned); await f.sdk.revoke(abandoned);
  await expect(f.sdk.transfer("web", abandoned)).rejects.toThrow("invalid_authorization");
  const resume = await f.authorize("resume", "R0"); await f.sdk.resume("web", resume);
  expect(await f.sdk.read("web")).toMatchObject({ owner: "R0", generation: 4, desired: "stopped" }); expect(f.effects()).toBe(0);
});

test("two controllers cannot overlap a role effect across awaited observations", async () => {
  const f = await fixture(); await f.activate();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const first = f.sdk.exclusive("R0", "web", 1, async lease => { entered(); await gate; await f.start(lease); });
  await ready;
  try { await expect(f.reopen().exclusive("R0", "web", 1, async lease => f.start(lease, "second"))).rejects.toThrow("ownership_busy"); }
  finally { release(); await first; }
  expect(f.effects()).toBe(1);
});

test.each(["before-effect", "after-effect", "after-confirmation"])("crash at %s leaves receipts fenced and recoverable without repeating an effect", async point => {
  const f = await fixture(); await f.activate();
  let attempts = 0;
  await expect(f.sdk.exclusive("R0", "web", 1, async lease => {
    lease.begin("crashed", "start");
    await lease.perform("crashed", "start", async permit => {
      if (point === "before-effect") throw new Error("fixture-crash");
      permit.atEffect(() => { attempts++; f.setObservation({ state: "owned", child: { uid: f.instance.uid, instance: f.instance.id, role: "web", generation: 1,
        pid: 456, birth: "birth", executable: "fixture-worker", effectId: permit.effectId } }); });
      if (point === "after-effect") throw new Error("fixture-crash");
    });
    throw new Error("fixture-crash");
  })).rejects.toThrow("fixture-crash");
  const reopened = f.reopen();
  await expect(reopened.exclusive("R0", "web", 1, async lease => lease.begin("fresh-key", "start"))).rejects.toThrow("outcome_uncertain");
  const token = await f.authorize("recover", "R0", "crashed");
  await reopened.exclusive("R0", "web", 1, lease => lease.recover("crashed", token));
  await reopened.exclusive("R0", "web", 1, async lease => { expect(lease.receipt("crashed")?.state).toBe("done"); lease.begin("crashed", "start"); });
  expect(attempts).toBe(point === "before-effect" ? 0 : 1);
});

test("an uncertain effect blocks transfer and restart, and unknown observations do not repair it", async () => {
  const f = await fixture(); await f.activate();
  await expect(f.sdk.exclusive("R0", "web", 1, async lease => {
    lease.begin("unknown", "start"); await lease.perform("unknown", "start", async () => { throw new Error("lost-ack"); });
  })).rejects.toThrow("lost-ack");
  const token = await f.authorize("recover", "R0", "unknown"); f.setObservation({ state: "unknown" });
  await expect(f.sdk.exclusive("R0", "web", 1, lease => lease.recover("unknown", token))).rejects.toThrow("outcome_uncertain");
  const handoff = await f.authorize("handoff", "P1");
  await expect(f.sdk.drain("web", handoff)).rejects.toThrow("outcome_uncertain");
  expect(f.effects()).toBe(0);
});

test("a reused PID or unrecorded identity is never signaled, and escaped permits expire", async () => {
  const f = await fixture(); await f.activate(); let late!: () => void;
  await f.sdk.exclusive("R0", "web", 1, async lease => { await f.start(lease); late = () => lease.assertCurrent("start"); });
  expect(() => late()).toThrow("ownership_scope_closed");
  const old = f.observe() as { state: "owned"; child: ExactChild }; f.setObservation({ state: "owned", child: { ...old.child, birth: "reused-pid" } });
  await expect(f.sdk.exclusive("R0", "web", 1, lease => f.stop(lease))).rejects.toThrow("identity_unproven"); expect(f.effects()).toBe(1);
});

test("journal corruption, unsafe permissions and inode replacement fail closed", async () => {
  const f = await fixture(); const path = join(f.path, "supervision-handoff-v1/custody.log");
  chmodSync(path, 0o666); await expect(f.sdk.read("web")).rejects.toThrow("unsafe_ownership_path"); chmodSync(path, 0o600);
  const bytes = readFileSync(path); renameSync(path, path + ".old"); writeFileSync(path, bytes, { mode: 0o600 });
  await expect(f.reopen().read("web")).rejects.toThrow("ownership_path_changed");
  renameSync(path + ".old", path); writeFileSync(path, Buffer.concat([bytes, Buffer.from('{"partial":')]));
  await expect(f.reopen().read("web")).rejects.toThrow("ownership_store_corrupt"); expect(f.effects()).toBe(0);
});

test.each(["closed-window", "pre-floor", "unlisted-rollback"])("reverse handoff refuses %s without changing the owner", async reason => {
  const f = await fixture(); await f.activate("stopped");
  const forward = await f.authorize("handoff", "P1"); await f.sdk.drain("web", forward); await f.sdk.transfer("web", forward);
  if (reason === "closed-window") await f.sdk.closeRollback(async () => true);
  if (reason === "pre-floor") f.ready.runtimeVersion = "899.0.0";
  if (reason === "unlisted-rollback") { f.ready.runtimeArtifact = "unlisted"; }
  const reverse = await f.authorize("handoff", "R0");
  await expect(f.sdk.drain("web", reverse)).rejects.toThrow();
  expect(await f.sdk.read("web")).toMatchObject({ owner: "P1", generation: 2, phase: "active" }); expect(f.effects()).toBe(0);
});

test("approval binds immutable intent, not a caller object mutated during consent", async () => {
  const f = await fixture(); const intent = { role: "web" as const, source: null, target: "R0" as const, generation: 0, action: "enroll" as const, desired: "stopped" as "running" | "stopped" };
  const token = await f.sdk.authorize(intent, async () => { intent.desired = "running"; return true; });
  await expect(f.sdk.activate("web", token, "running")).rejects.toThrow("invalid_authorization");
  await f.sdk.activate("web", token, "stopped"); expect((await f.sdk.read("web")).desired).toBe("stopped");
});

test("a same-version runtime without integrated effect gates cannot act after reopening the store", async () => {
  const f = await fixture(); await f.activate(); f.ready.ready = false;
  await expect(f.reopen().exclusive("R0", "web", 1, async lease => f.start(lease))).rejects.toThrow("r0_contract_unavailable"); expect(f.effects()).toBe(0);
});

test("Scoutbot needs the separate answer claim capability; claim loss is not role transfer", async () => {
  const f = await fixture();
  const token = await f.sdk.authorize({ role: "scoutbot", source: null, target: "R0", generation: 0, action: "enroll", desired: "stopped" }, async () => true);
  f.ready.assistantClaims = false;
  await expect(f.sdk.activate("scoutbot", token, "stopped")).rejects.toThrow("r0_contract_unavailable");
  f.ready.assistantClaims = true; await f.sdk.activate("scoutbot", token, "stopped");
  const before = await f.sdk.read("scoutbot");
  // Losing an answerer's lease/capability does not mutate durable custody.
  f.ready.assistantClaims = false;
  expect(await f.reopen().read("scoutbot")).toEqual(before);
  await expect(f.sdk.exclusive("R0", "scoutbot", 1, async () => {})).rejects.toThrow("r0_contract_unavailable");
});

test.each(["R0", "P1"] as const)("OS lock survives a %s controller's pending effect, then SIGKILL releases only the lock", async owner => {
  const f = await fixture(); await f.activate();
  if (owner === "P1") { const token = await f.authorize("handoff", "P1"); await f.sdk.drain("web", token); await f.sdk.transfer("web", token); }
  const generation = owner === "R0" ? 1 : 2;
  const code = `
    const { SupervisionHandoff } = await import(process.env.HANDOFF_FIXTURE_MODULE);
    const instance = JSON.parse(process.env.HANDOFF_FIXTURE_SELECTION);
    const sdk = new SupervisionHandoff(instance, {
      readiness: async () => ({ protocol: 1, ready: true, runtimeVersion: "900.0.0", runtimeArtifact: "fixture-r0", launcherArtifact: "fixture-p1", assistantClaims: true, integratedRoles: ["web"] }),
      observe: async () => ({ state: "absent", processes: "absent", jobs: "disabled", relaunch: "fenced", inFlight: "quiescent" }),
    });
    await sdk.exclusive(process.env.HANDOFF_FIXTURE_OWNER, "web", Number(process.env.HANDOFF_FIXTURE_GENERATION), async lease => {
      lease.begin("killed-controller", "start");
      await lease.perform("killed-controller", "start", async permit => {
        permit.atEffect(() => {});
        console.log("effect-held");
        await new Promise(() => {});
      });
    });
  `;
  const child = Bun.spawn([process.execPath, "-e", code], { stdout: "pipe", stderr: "pipe", env: { ...process.env,
    HOME: f.path, HANDOFF_FIXTURE_MODULE: new URL("./index.ts", import.meta.url).href,
    HANDOFF_FIXTURE_SELECTION: JSON.stringify(f.instance), HANDOFF_FIXTURE_OWNER: owner,
    HANDOFF_FIXTURE_GENERATION: String(generation) } });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const reader = child.stdout.getReader();
    const first = await Promise.race([reader.read(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("fixture child startup timed out")), 10_000); })]);
    clearTimeout(timer);
    expect(new TextDecoder().decode(first.value)).toContain("effect-held");
    await expect(f.sdk.read("web")).rejects.toThrow("ownership_busy");
    child.kill("SIGKILL"); await child.exited;
    expect(await f.reopen().read("web")).toMatchObject({ owner, generation, desired: "running" });
    await expect(f.reopen().exclusive(owner, "web", generation, async lease => lease.begin("manual-restart", "start"))).rejects.toThrow("outcome_uncertain");
    const recovery = await f.authorize("recover", owner, "killed-controller");
    await f.reopen().exclusive(owner, "web", generation, lease => lease.recover("killed-controller", recovery));
    expect(f.effects()).toBe(0);
  } finally { clearTimeout(timer); child.kill("SIGKILL"); await child.exited; }
}, 20_000);

test("lost stop acknowledgment pins transfer until exact absence recovery; running intent survives", async () => {
  const f = await fixture(); await f.activate(); await f.sdk.exclusive("R0", "web", 1, lease => f.start(lease));
  const transfer = await f.authorize("handoff", "P1"); await f.sdk.drain("web", transfer);
  await expect(f.sdk.exclusive("R0", "web", 1, async lease => {
    lease.begin("lost-stop", "stop"); await lease.perform("lost-stop", "stop", async permit => {
      permit.atEffect(() => f.setObservation(structuredClone(absent))); throw new Error("stop-ack-lost");
    });
  })).rejects.toThrow("stop-ack-lost");
  await expect(f.reopen().transfer("web", transfer)).rejects.toThrow("outcome_uncertain");
  const token = await f.authorize("recover", "R0", "lost-stop");
  await f.reopen().exclusive("R0", "web", 1, async lease => { await lease.recover("lost-stop", token); expect(lease.receipt("lost-stop")?.error).toBeUndefined(); });
  await f.reopen().transfer("web", transfer); expect(await f.sdk.read("web")).toMatchObject({ owner: "P1", generation: 2, desired: "running" });
});

test("all persisted phase images recover one authority; no timeout, PID file or broker DB is consulted", async () => {
  const f = await fixture(); await f.activate("stopped");
  const forward = await f.authorize("handoff", "P1"); await f.sdk.drain("web", forward); await f.sdk.transfer("web", forward);
  const reverse = await f.authorize("handoff", "R0"); await f.sdk.drain("web", reverse); await f.sdk.transfer("web", reverse);
  const journal = join(f.path, "supervision-handoff-v1/custody.log"); const records = readFileSync(journal, "utf8").trimEnd().split("\n");
  for (let length = 1; length <= records.length; length++) {
    // Test-only crash image: preserve the original stable inode, cut after each
    // completed persistence boundary. Production never restores this journal.
    writeFileSync(journal, records.slice(0, length).join("\n") + "\n");
    const current = await f.reopen().read("web");
    for (const owner of ["R0", "P1"] as const) {
      const probe = f.reopen().exclusive(owner, "web", current.generation, async lease => lease.assertCurrent());
      if (current.owner === owner && current.phase !== "staged") await probe;
      else await expect(probe).rejects.toThrow("ownership_changed");
    }
  }
  expect(f.effects()).toBe(0);
});

test("path replacement during an awaited observation forbids the actual effect", async () => {
  const f = await fixture(); await f.activate(); let performed = false;
  const original = f.inspector.observe;
  f.inspector.observe = async role => {
    const path = join(f.path, "supervision-handoff-v1/custody.log"), bytes = readFileSync(path);
    renameSync(path, path + ".previous"); writeFileSync(path, bytes, { mode: 0o600 });
    return original(role);
  };
  await expect(f.sdk.exclusive("R0", "web", 1, async lease => {
    lease.begin("path-race", "start"); await lease.perform("path-race", "start", async permit => { permit.atEffect(() => { performed = true; }); });
  })).rejects.toThrow("ownership_path_changed");
  expect(performed).toBe(false);
});

test("the instance binding compares values, not JSON property order", async () => {
  const f = await fixture();
  const instance = { supportDirectory: f.instance.supportDirectory, id: f.instance.id, uid: f.instance.uid };
  const other = new SupervisionHandoff(instance, f.inspector);
  const hello = await other.handshake({ protocol: 1, instance }); expect(hello.ready).toBe(false);
  expect(hello.instance).toEqual(f.instance);
});

test("failed store revalidation poisons the scope rather than letting restored permissions revive it", async () => {
  const f = await fixture(); await f.activate(); const path = join(f.path, "supervision-handoff-v1/custody.log");
  await f.sdk.exclusive("R0", "web", 1, async lease => {
    chmodSync(path, 0o666);
    expect(() => lease.begin("unsafe", "start")).toThrow("unsafe_ownership_path");
    chmodSync(path, 0o600);
    expect(() => lease.assertCurrent()).toThrow("ownership_scope_closed");
  });
  expect(await f.reopen().read("web")).toMatchObject({ owner: "R0", generation: 1 }); expect(f.effects()).toBe(0);
});

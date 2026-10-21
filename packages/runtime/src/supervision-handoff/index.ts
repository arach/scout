import { DirectChildren, currentChildCoverage, type DirectChildCommand, type CurrentChildCoverage } from "./child-custody.js";
import { captureLegacyRole, inspectLegacyRole, type LegacyRoleSources, type RoleAbsence } from "./role-absence.js";
import { randomBytes } from "node:crypto";
import { HandoffStore, authorizationHash, policyHash, receiptKey, type CustodyTransaction } from "./store.js";
import { HANDOFF_PROTOCOL, refuse, requireRole, type Absence, type AuthorizationIntent, type ExactChild,
  type Effect, type FloorPolicy, type HandoffInspector, type HandoffOwner, type HandoffRole, type MutationReceipt,
  type Observation, type OperatorApproval, type Ownership, type StageApproval, type SelectedInstance } from "./contracts.js";
export * from "./contracts.js";

function absent(value: Observation): value is Absence {
  return value.state === "absent" && value.processes === "absent" && value.jobs === "disabled"
    && value.relaunch === "fenced" && value.inFlight === "quiescent";
}
function sameChild(a: ExactChild, b: ExactChild) {
  return (["uid", "instance", "role", "generation", "pid", "birth", "executable", "effectId"] as const).every(key => a[key] === b[key]);
}
function exact(child: ExactChild, tx: CustodyTransaction, role: HandoffRole, generation: number, effectId?: string) {
  if (child.uid !== tx.state.instance.uid || child.instance !== tx.state.instance.id || child.role !== role
    || child.generation !== generation || !Number.isSafeInteger(child.pid) || child.pid < 1
    || typeof child.birth !== "string" || !child.birth || typeof child.executable !== "string" || !child.executable || typeof child.effectId !== "string" || !child.effectId || (effectId && child.effectId !== effectId)) refuse("identity_unproven");
}
async function readiness(tx: CustodyTransaction, role: HandoffRole, target: HandoffOwner, inspector: HandoffInspector) {
  const proof = await inspector.readiness(role); tx.assertCurrent();
  const policy = tx.state.policy;
  if (proof.protocol !== HANDOFF_PROTOCOL || proof.ready !== true || !proof.integratedRoles.includes(role)
    || !Bun.semver.satisfies(proof.runtimeVersion, `>=${policy.minimumRuntimeVersion}`)
    || (role === "scoutbot" && proof.assistantClaims !== true)
    || !policy.runtimeArtifacts.includes(proof.runtimeArtifact) || !policy.launcherArtifacts.includes(proof.launcherArtifact)) refuse("r0_contract_unavailable");
  if (target === "R0" && tx.state.roles[role].owner === "P1"
    && (!policy.rollbackOpen || !policy.rollbackArtifacts.includes(proof.runtimeArtifact))) refuse("rollback_unavailable");
}
function grant(tx: CustodyTransaction, token: string, role: HandoffRole, action: AuthorizationIntent["action"], reserved = false) {
  const found = tx.state.authorizations[authorizationHash(token)];
  const state = tx.state.roles[role];
  if (!found || found.policy !== policyHash(tx.state.policy) || found.intent.role !== role || found.intent.action !== action
    || found.intent.source !== state.owner || found.intent.generation !== state.generation
    || (found.state !== "issued" && !(reserved && found.state === "reserved"))) refuse("invalid_authorization");
  return found;
}
function completedTransition(tx: CustodyTransaction, token: string, role: HandoffRole, action: AuthorizationIntent["action"]) {
  const found = tx.state.authorizations[authorizationHash(token)];
  if (found?.state !== "used") return false;
  const current = tx.state.roles[role];
  if (found.intent.role !== role || found.intent.action !== action || found.intent.target !== current.owner
    || found.intent.generation + 1 !== current.generation) refuse("ownership_changed");
  return true;
}
function noPending(tx: CustodyTransaction, role: HandoffRole, generation: number) {
  const prefix = `${role}:${generation}:`;
  if (Object.entries(tx.state.receipts).some(([key, value]) => key.startsWith(prefix) && value.state === "pending")) refuse("outcome_uncertain");
}
export interface EffectPermit {
  readonly effectId: string;
  readonly child?: ExactChild;
  /** The actual synchronous spawn/signal boundary, not a preliminary check.
   * Awaiting observations afterward does not grant a second effect. */
  atEffect<T>(effect: () => T): T;
  /** Opt-in audited direct-child boundary; no raw handle escapes. */
  spawnChild(command: DirectChildCommand): ExactChild;
  signalChild(signal: "SIGTERM" | "SIGKILL"): "signalled" | "already_exited";
}
export interface RoleCustody {
  ownership(): Ownership;
  childCoverage(): CurrentChildCoverage;
  recordChildExit(effectId: string): Promise<void>;
  captureLegacyInventory(captureId: string): Promise<void>;
  inspectLegacyAbsence(): Promise<RoleAbsence>;
  assertCurrent(kind?: "start" | "stop"): void;
  receipt(id: string): MutationReceipt | undefined;
  begin(id: string, operation: MutationReceipt["operation"]): void;
  perform(id: string, kind: "start" | "stop", run: (permit: EffectPermit) => Promise<void>): Promise<void>;
  complete(id: string, error?: string): void;
  recover(id: string, authorization: string): Promise<void>;
}
/** Staged SDK: only an explicit updater/owner imports and constructs it. There
 * is no daemon wiring, HTTP authority, source discovery or automatic enrollment. */
export class SupervisionHandoff {
  private readonly store: HandoffStore;
  private readonly children: DirectChildren;
  constructor(readonly instance: SelectedInstance, private readonly inspector: HandoffInspector, private readonly legacySources: LegacyRoleSources = {}, options: { enableAuditedDirectChildren?: true } = {}) {
    this.children = new DirectChildren(Object.freeze({ ...instance }), options.enableAuditedDirectChildren === true);
    this.instance = Object.freeze({ ...instance }); this.store = new HandoffStore(this.instance); this.legacySources = Object.freeze({ ...legacySources });
  }
  stage(policy: FloorPolicy, approve: StageApproval) { return this.store.stage(policy, approve); }
  handshake(hello: { protocol: number; instance: SelectedInstance }) { return this.store.handshake(hello); }
  read(role: HandoffRole) { return this.store.read(role); }
  async inspectRoleAbsence(role: HandoffRole, generation: number): Promise<RoleAbsence> {
    requireRole(role);
    return this.store.exclusive(async tx => {
      if (tx.state.roles[role].generation !== generation) refuse("ownership_changed");
      return inspectLegacyRole(tx, role, this.legacySources);
    }).catch(() => ({ state: "unknown" as const }));
  }
  pendingReceipts(role: HandoffRole, generation: number) { return this.store.pendingReceipts(role, generation); }
  authorize(intent: AuthorizationIntent, approve: OperatorApproval) { return this.store.authorize(intent, approve); }
  closeRollback(approve: StageApproval) { return this.store.closeRollback(approve); }
  revoke(token: string) { return this.store.revoke(token); }
  async activate(role: HandoffRole, authorization: string, desired: "running" | "stopped") {
    requireRole(role);
    if (!["running", "stopped"].includes(desired)) refuse("invalid_desired_state");
    return this.store.exclusive(async tx => {
      if (completedTransition(tx, authorization, role, "enroll")) {
        if (tx.state.authorizations[authorizationHash(authorization)]!.intent.desired !== desired) refuse("request_id_conflict");
        return;
      }
      const owner = tx.state.roles[role], consent = grant(tx, authorization, role, "enroll");
      if (consent.intent.desired !== desired) refuse("invalid_authorization");
      if (owner.owner !== null || owner.phase !== "staged" || consent.intent.target !== "R0") refuse("ownership_changed");
      await readiness(tx, role, "R0", this.inspector);
      const proof = await this.inspector.observe(role); tx.assertCurrent();
      if (!absent(proof)) refuse("absence_unproven");
      tx.state.roles[role] = { owner: "R0", generation: 1, phase: "active", desired };
      consent.state = "used"; tx.persist();
    });
  }
  async drain(role: HandoffRole, authorization: string) {
    requireRole(role);
    return this.store.exclusive(async tx => {
      if (completedTransition(tx, authorization, role, "handoff")) return;
      const owner = tx.state.roles[role], consent = grant(tx, authorization, role, "handoff", true);
      if (!owner.owner || consent.intent.target === owner.owner || !["active", "draining"].includes(owner.phase)) refuse("ownership_changed");
      if (owner.phase === "draining") {
        if (owner.transition?.authorization !== authorizationHash(authorization)) refuse("ownership_changed");
        return;
      }
      await readiness(tx, role, consent.intent.target, this.inspector);
      noPending(tx, role, owner.generation);
      owner.phase = "draining"; owner.transition = { authorization: authorizationHash(authorization), target: consent.intent.target };
      consent.state = "reserved"; tx.persist(); // All old-owner restart gates must read this before an effect.
    });
  }
  async transfer(role: HandoffRole, authorization: string) {
    requireRole(role);
    return this.store.exclusive(async tx => {
      if (completedTransition(tx, authorization, role, "handoff")) return;
      const owner = tx.state.roles[role], consent = grant(tx, authorization, role, "handoff", true);
      if (owner.phase !== "draining" || owner.transition?.authorization !== authorizationHash(authorization)) refuse("ownership_changed");
      await readiness(tx, role, consent.intent.target, this.inspector);
      noPending(tx, role, owner.generation);
      const proof = await this.inspector.observe(role); tx.assertCurrent();
      if (!absent(proof)) refuse("absence_unproven");
      if (owner.generation === Number.MAX_SAFE_INTEGER) refuse("generation_exhausted");
      tx.state.roles[role] = { owner: consent.intent.target, generation: owner.generation + 1, phase: "active", desired: owner.desired };
      consent.state = "used"; tx.persist(); // Commit authority, not an instruction to spawn.
    });
  }
  async resume(role: HandoffRole, authorization: string) {
    requireRole(role);
    return this.store.exclusive(async tx => {
      if (completedTransition(tx, authorization, role, "resume")) return;
      const owner = tx.state.roles[role], consent = grant(tx, authorization, role, "resume");
      if (owner.phase !== "draining" || owner.owner !== consent.intent.target) refuse("ownership_changed");
      await readiness(tx, role, consent.intent.target, this.inspector);
      noPending(tx, role, owner.generation);
      const proof = await this.inspector.observe(role); tx.assertCurrent();
      if (!absent(proof)) refuse("absence_unproven");
      if (owner.generation === Number.MAX_SAFE_INTEGER) refuse("generation_exhausted");
      const old = owner.transition && tx.state.authorizations[owner.transition.authorization];
      if (old) old.state = "revoked";
      tx.state.roles[role] = { owner: owner.owner, generation: owner.generation + 1, phase: "active", desired: owner.desired };
      consent.state = "used"; tx.persist();
    });
  }
  async exclusive<T>(owner: HandoffOwner, role: HandoffRole, generation: number, run: (lease: RoleCustody) => Promise<T>): Promise<T> {
    requireRole(role);
    return this.store.exclusive(async tx => {
      const state = tx.state.roles[role];
      const assertCurrent = (kind?: "start" | "stop") => {
        tx.assertCurrent();
        if (state.owner !== owner || state.generation !== generation || !["active", "draining"].includes(state.phase)) refuse("ownership_changed");
        if (kind === "start" && (state.phase !== "active" || state.desired !== "running")) refuse("role_draining_or_stopped");
      };
      assertCurrent();
      await readiness(tx, role, owner, this.inspector);
      assertCurrent();
      const key = (id: string) => {
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) refuse("invalid_request_id");
        return receiptKey(role, generation, id);
      };
      const receipt = (id: string) => tx.state.receipts[key(id)];
      const lease: RoleCustody = {
        childCoverage: () => { assertCurrent(); return currentChildCoverage(tx, role); },
        recordChildExit: async effectId => {
          assertCurrent();
          const effects = Object.entries(tx.state.receipts).filter(([key]) => key.startsWith(`${role}:${generation}:`))
            .flatMap(([, value]) => value.effects);
          const effect = effects.find(effect => effect.id === effectId && effect.kind === "start");
          const record = effect?.directChild;
          if (!record) refuse("child_birth_unproven");
          if (record.exit) return;
          const exit = await this.children.exit(record); assertCurrent();
          record.exit = exit; tx.persist();
        },
        ownership: () => { assertCurrent(); return structuredClone(state); }, assertCurrent,
        captureLegacyInventory: async captureId => { assertCurrent(); await captureLegacyRole(tx, role, captureId, this.legacySources); assertCurrent(); },
        inspectLegacyAbsence: async () => { assertCurrent(); const proof = await inspectLegacyRole(tx, role, this.legacySources); assertCurrent(); return proof; },
        receipt: id => { assertCurrent(); return structuredClone(receipt(id)); },
        begin: (id, operation) => {
          assertCurrent();
          if (!["start", "stop", "restart"].includes(operation)) refuse("invalid_operation");
          const prior = receipt(id);
          if (prior) {
            if (prior.operation !== operation) refuse("request_id_conflict");
            if (prior.state === "pending") refuse("outcome_uncertain");
            return;
          }
          noPending(tx, role, generation);
          if (state.phase === "draining" && operation !== "stop") refuse("role_draining_or_stopped");
          if (Object.keys(tx.state.receipts).length >= 256) refuse("receipt_capacity");
          if (state.phase === "active") state.desired = operation === "stop" ? "stopped" : "running";
          tx.state.receipts[key(id)] = { operation, state: "pending", effects: [] }; tx.persist();
        },
        perform: async (id, kind, runEffect) => {
          assertCurrent(kind);
          const current = receipt(id);
          if (!current || current.state !== "pending") refuse("pending_receipt_required");
          if (current.effects.some(effect => effect.state === "intent")) refuse("outcome_uncertain");
          if ((current.operation === "stop" && kind !== "stop") || (current.operation === "start" && kind !== "start")
            || current.effects.filter(effect => effect.kind === kind).length) refuse("effect_order_invalid");
          if (current.operation === "restart" && kind === "start" && !current.effects.some(e => e.kind === "stop" && e.state === "confirmed")) refuse("effect_order_invalid");
          const before = await this.inspector.observe(role); assertCurrent(kind);
          if (kind === "start" && !absent(before)) refuse("absence_unproven");
          if (kind === "stop" && !absent(before) && before.state !== "owned") refuse("identity_unproven");
          if (before.state === "owned") {
            exact(before.child, tx, role, generation);
            const known = Object.entries(tx.state.receipts).some(([key, value]) => key.startsWith(`${role}:${generation}:`)
              && value.effects.some(effect => effect.state === "confirmed" && effect.child
                && sameChild(effect.child, before.child)));
            if (!known) refuse("identity_unproven");
          }
          const effect: Effect = { id: randomBytes(16).toString("hex"), kind, state: "intent" };
          current.effects.push(effect); tx.persist();
          let admitted = false, open = true;
          try {
            if (!(kind === "stop" && absent(before))) {
              const atEffect = <T>(action: () => T): T => {
                assertCurrent(kind); if (!open || admitted) refuse("effect_scope_closed");
                admitted = true;
                const result = action();
                if (result && typeof (result as { then?: unknown }).then === "function") refuse("async_effect_boundary");
                return result;
              };
              await runEffect({ effectId: effect.id, ...(before.state === "owned" ? { child: structuredClone(before.child) } : {}), atEffect,
                spawnChild: command => {
                  if (kind !== "start") refuse("effect_order_invalid");
                  return atEffect(() => {
                    effect.directChild = this.children.spawn(role, generation, effect.id, command);
                    tx.persist(); // Birth is durable before any awaited observation.
                    return structuredClone(effect.directChild.child);
                  });
                },
                signalChild: signal => {
                  if (kind !== "stop" || before.state !== "owned") refuse("identity_unproven");
                  return atEffect(() => this.children.signal(before.child, signal));
                },
              });
              assertCurrent(kind); if (!admitted) refuse("effect_boundary_required");
            }
            const after = await this.inspector.observe(role); assertCurrent(kind);
            if (kind === "stop" && !absent(after)) refuse("absence_unproven");
            if (kind === "start") {
              if (after.state !== "owned") refuse("identity_unproven");
              exact(after.child, tx, role, generation, effect.id);
              if (effect.directChild && !sameChild(effect.directChild.child, after.child)) refuse("identity_unproven");
              (effect as { child?: ExactChild }).child = structuredClone(after.child);
            }
            effect.state = "confirmed"; tx.persist();
          } finally { open = false; }
        },
        complete: (id, error) => {
          assertCurrent(); const current = receipt(id);
          if (!current) refuse("pending_receipt_required");
          if (current.state === "done") return;
          if (current.effects.some(effect => effect.state !== "confirmed")) refuse("outcome_uncertain");
          if (!error && (current.operation === "restart" ? current.effects.length !== 2 : current.effects.length !== 1)) refuse("effect_incomplete");
          if (error && !/^[A-Za-z0-9_]{1,64}$/.test(error)) refuse("invalid_error_code");
          current.state = "done"; if (error) current.error = error; tx.persist();
        },
        recover: async (id, authorization) => {
          assertCurrent(); const consent = grant(tx, authorization, role, "recover");
          if (consent.intent.target !== owner || consent.intent.requestId !== id) refuse("invalid_authorization");
          const current = receipt(id); if (!current || current.state !== "pending") refuse("pending_receipt_required");
          if (current.effects.length && current.effects.every(effect => effect.state === "confirmed")) {
            current.state = "done"; consent.state = "used"; tx.persist(); return;
          }
          const proof = await this.inspector.observe(role); assertCurrent();
          const pending = current.effects.find(effect => effect.state === "intent");
          if (pending && pending.kind === "start" && proof.state === "owned") {
            exact(proof.child, tx, role, generation, pending.id);
            if (pending.directChild && !sameChild(pending.directChild.child, proof.child)) refuse("identity_unproven");
            pending.child = structuredClone(proof.child); pending.state = "confirmed";
          } else if (absent(proof)) {
            if (pending) pending.state = "confirmed";
            if (current.operation !== "stop") current.error = "recovered_absent";
          } else refuse("outcome_uncertain");
          current.state = "done"; consent.state = "used"; tx.persist(); // Never repeat the effect.
        },
      };
      return run(lease);
    });
  }
}

export { createProcessEvidenceReader, type ProcessEvidenceReader, type ProcessSample, type ProcessSampleResult, type ProcessComparison } from "./process-evidence.js";

export { LEGACY_ROLE_SURFACES, type LegacyResource, type LegacyRoleCapture, type LegacyRoleContext, type LegacyRoleSources, type RoleAbsence } from "./role-absence.js";

export { directChildCapability, type DirectChildCommand, type DirectChildRecord, type CurrentChildCoverage } from "./child-custody.js";

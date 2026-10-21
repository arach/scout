import { closeSync, constants, fstatSync, openSync } from "node:fs";
import { join } from "node:path";
import { acquireOwnershipLock, owned, HandoffStore, type CustodyTransaction } from "./store.js";
import { refuse, requireRole, type HandoffOwner, type HandoffRole, type SelectedInstance } from "./contracts.js";
import { EFFECT_EXCLUSION_CAPABILITY, profileHash, type EffectExclusionProfile, type FenceIdentity } from "./exclusion-contracts.js";
import { CARRIER_LAYOUT, markCloseOnExec } from "./carrier-layout.js";

export function selectedProfile(tx: CustodyTransaction, role: HandoffRole, capabilities: readonly string[]): EffectExclusionProfile | undefined {
  tx.assertCurrent();
  const profile = tx.state.policy.effectProfiles?.[role], selection = tx.state.roles[role].proofProfile;
  if (!profile) { if (selection) refuse("proof_profile_changed"); return; }
  if (tx.state.version !== 3) refuse("cohort_store_version_required");
  if (!capabilities.includes(EFFECT_EXCLUSION_CAPABILITY)) refuse("proof_capability_required");
  if (tx.state.roles[role].owner !== null && (!selection || selection.id !== profile.id
    || selection.hash !== profileHash(profile) || selection.capability !== EFFECT_EXCLUSION_CAPABILITY)) refuse("proof_profile_changed");
  return profile;
}
export function assertFenceIdentity(tx: CustodyTransaction, role: HandoffRole, fd: number): FenceIdentity {
  tx.assertCurrent();
  const expected = tx.state.lifetimeFences?.[role];
  if (!expected) refuse("lifetime_fence_unprepared");
  const path = join(tx.state.instance.supportDirectory, "supervision-handoff-v1", `lifetime-${role}.lock`);
  const actual = owned(path, false, tx.state.instance.uid), opened = fstatSync(fd, { bigint: true });
  if (!opened.isFile() || opened.uid !== BigInt(tx.state.instance.uid) || (opened.mode & 0o7777n) !== 0o600n || opened.nlink !== 1n
    || actual.dev !== expected.dev || actual.ino !== expected.ino || opened.dev.toString() !== expected.dev || opened.ino.toString() !== expected.ino) refuse("lifetime_fence_changed");
  return { ...expected };
}
export function openFence(tx: CustodyTransaction, role: HandoffRole): number {
  tx.assertCurrent();
  // Do not leak a lifetime reference to unrelated execs. Deliberate stdio
  // mapping duplicates the description into the child's non-CLOEXEC slot.
  const cloexec = process.platform === "darwin" ? 0x01000000 : process.platform === "linux" ? 0x80000 : 0;
  if (!cloexec) refuse("ownership_lock_unsupported");
  const fd = openSync(join(tx.state.instance.supportDirectory, "supervision-handoff-v1", `lifetime-${role}.lock`), constants.O_RDWR | constants.O_NOFOLLOW | cloexec);
  try { assertFenceIdentity(tx, role, fd); return fd; } catch (error) { closeSync(fd); throw error; }
}
type Held = { fd: number; owner: HandoffOwner; generation: number };
/** One local controller reference per role; deliberately inherited references
 * can outlive it. Never LOCK_UN/downgrade: close only. No timers or adoption. */
export class LifetimeFences {
  private held = new Map<HandoffRole, Held>();
  acquire(tx: CustodyTransaction, role: HandoffRole): number {
    tx.assertCurrent();
    if (this.held.has(role)) refuse("lifetime_fence_still_held");
    const fd = openFence(tx, role);
    try { acquireOwnershipLock(fd); return fd; } catch (error) { closeSync(fd); throw error; }
  }
  retain(role: HandoffRole, fd: number, owner: HandoffOwner, generation: number) {
    this.held.set(role, { fd, owner, generation });
  }
  assertCurrent(tx: CustodyTransaction, role: HandoffRole): number {
    const value = this.held.get(role), state = tx.state.roles[role];
    if (!value || value.owner !== state.owner || value.generation !== state.generation) refuse("lifetime_fence_required");
    assertFenceIdentity(tx, role, value.fd);
    return value.fd;
  }
  release(tx: CustodyTransaction, role: HandoffRole) {
    const fd = this.assertCurrent(tx, role);
    this.held.delete(role); // Disable local effect scopes before closing.
    closeSync(fd);
  }
  releaseIfHeld(tx: CustodyTransaction, role: HandoffRole) {
    if (this.held.has(role)) this.release(tx, role);
  }
  /** Host shutdown drops references, never changes durable ownership or settles
   * work. Existing carrier references keep the kernel lock alive. */
  close() {
    const held = [...this.held.values()]; this.held.clear();
    for (const value of held) closeSync(value.fd);
  }
}

/** Entry-point check only, not a durable authorization or effect permit. The
 * child must wait for the parent's ledger scope to finish, and must continue
 * fencing effects at their landing-side generation/receipt boundary. */
export class ChildRoleCustody {
  private readonly store: HandoffStore;
  private readonly capabilities: readonly string[];
  constructor(instance: SelectedInstance, capabilities: readonly string[]) {
    this.store = new HandoffStore(Object.freeze({ ...instance })); this.capabilities = Object.freeze([...capabilities]);
  }
  async check(role: HandoffRole, owner: HandoffOwner, generation: number, descriptor: number = CARRIER_LAYOUT.fence) {
    requireRole(role);
    if (!Number.isSafeInteger(descriptor) || descriptor < 3) refuse("invalid_carrier_descriptor");
    return this.store.exclusive(async tx => {
      const profile = selectedProfile(tx, role, this.capabilities), state = tx.state.roles[role];
      if (!profile || state.owner !== owner || state.generation !== generation || state.phase !== "active" || state.desired !== "running" || state.retirement) refuse("ownership_changed");
      const identity = assertFenceIdentity(tx, role, descriptor);
      // A separately opened fd on the right inode is not a mapped carrier.
      // First establish contention, then require the supplied description's
      // idempotent exclusive lock. Never unlock the tested shared description.
      const probe = openFence(tx, role);
      try {
        let busy = false;
        try { acquireOwnershipLock(probe); } catch (error) {
          if (!(error && typeof error === "object" && "code" in error && error.code === "ownership_busy")) throw error;
          busy = true;
        }
        if (!busy) refuse("carrier_lock_unheld");
      } finally { closeSync(probe); }
      acquireOwnershipLock(descriptor);
      markCloseOnExec(descriptor); // Subsequent exec needs a deliberate next-hop mapping.
      tx.assertCurrent(); assertFenceIdentity(tx, role, descriptor);
      return { state: "verified" as const, role, owner, generation, profileId: profile.id, profileHash: profileHash(profile), fence: identity, closeOnExec: true as const };
    });
  }
}

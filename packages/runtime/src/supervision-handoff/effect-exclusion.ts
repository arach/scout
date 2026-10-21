import { refuse, type HandoffInspector, type HandoffRole } from "./contracts.js";
import { randomBytes } from "node:crypto";
import { policyHash, type CustodyTransaction } from "./store.js";
import { EFFECT_EXCLUSION_CAPABILITY, profileHash, type EffectExclusionProfile, type ExclusionContext, type ExclusionEvidence, type RoleEffectExclusion } from "./exclusion-contracts.js";
import { assertFenceIdentity } from "./lifetime-fence.js";

function same(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b); }
/** Acquiring the anchored lifetime fence is necessary, never sufficient.
 * Missing inventory/legacy/landing-side evidence and any unexplained live
 * resource refuse. This is never exposed as worker absence. */
export async function certifyEffectExclusion(tx: CustodyTransaction, role: HandoffRole, fd: number,
  profile: EffectExclusionProfile, inspector: HandoffInspector): Promise<RoleEffectExclusion> {
  const ownership = tx.state.roles[role];
  const context: ExclusionContext = { instance: { ...tx.state.instance }, role, owner: ownership.owner, generation: ownership.generation,
    profileId: profile.id, profileHash: profileHash(profile), policyHash: policyHash(tx.state.policy), fence: assertFenceIdentity(tx, role, fd), observationId: randomBytes(16).toString("hex") };
  if (!inspector.exclusion) refuse("effect_exclusion_unavailable");
  const value = structuredClone(await inspector.exclusion(structuredClone(context)));
  tx.assertCurrent(); assertFenceIdentity(tx, role, fd);
  if (value.state !== "observed") refuse("effect_exclusion_unproven");
  const evidence: ExclusionEvidence = value;
  try {
    if (Object.keys(evidence).some(key => !["state", "instance", "role", "owner", "generation", "profileId", "profileHash", "policyHash", "fence", "observationId",
      "coverageId", "resources", "legacy", "delegated", "durableWorkContract", "relaunch", "inFlight", "descendants", "nonOwners"].includes(key))
      || !same(evidence.instance, context.instance) || evidence.role !== role || evidence.owner !== context.owner || evidence.observationId !== context.observationId
      || evidence.generation !== context.generation || evidence.profileId !== context.profileId || evidence.profileHash !== context.profileHash
      || evidence.policyHash !== context.policyHash || evidence.fence.dev !== context.fence.dev || evidence.fence.ino !== context.fence.ino
      || evidence.coverageId !== profile.coverageId || evidence.resources.inventoryId !== profile.resourceInventory.id
      || !Array.isArray(evidence.resources.unexplained) || evidence.resources.unexplained.length
      || evidence.legacy.state !== "settled" || evidence.legacy.evidenceId !== profile.legacyEvidenceId
      || evidence.relaunch !== "fenced" || evidence.inFlight !== "quiescent" || evidence.descendants !== "unproven"
      || !["settled", "covered"].includes(evidence.delegated)
      || (evidence.delegated === "covered" && (!profile.durableWorkContract || evidence.durableWorkContract !== profile.durableWorkContract))
      || !Array.isArray(evidence.nonOwners) || evidence.nonOwners.length > 64) refuse("effect_exclusion_unproven");
    const survivors = new Set<string>();
    for (const survivor of evidence.nonOwners) {
      const sample = survivor.sample;
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(survivor.id) || survivors.has(survivor.id)
        || !profile.nonOwnerContracts.includes(survivor.contractId) || sample.format !== "darwin-bsd-process/1"
        || !same(sample.instance, context.instance) || sample.uid !== context.instance.uid
        || !Number.isSafeInteger(sample.pid) || sample.pid < 1 || sample.pid > 0x7fffffff
        || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(sample.bootSession)
        || !/^[1-9][0-9]{0,19}$/.test(sample.startSeconds) || !/^(0|[1-9][0-9]{0,5})$/.test(sample.startMicroseconds)
        || !sample.executable.startsWith("/") || sample.executable.includes("\0")) refuse("effect_exclusion_unproven");
      survivors.add(survivor.id);
    }
    if (!Array.isArray(evidence.resources.entries) || evidence.resources.entries.length !== profile.resourceInventory.resources.length) refuse("effect_exclusion_unproven");
    const seen = new Set<string>();
    for (const entry of evidence.resources.entries) {
      const expected = profile.resourceInventory.resources.find(resource => resource.id === entry.id);
      if (!expected || seen.has(entry.id) || expected.kind !== entry.kind
        || !["released", "non_owner"].includes(entry.state)
        || (entry.state === "non_owner" && (!entry.nonOwnerId || !survivors.has(entry.nonOwnerId)))) refuse("effect_exclusion_unproven");
      seen.add(entry.id);
    }
  } catch { refuse("effect_exclusion_unproven"); }
  const { state: _state, ...dimensions } = evidence;
  return { ...dimensions, state: "role_effect_excluded", capability: EFFECT_EXCLUSION_CAPABILITY, carriers: "excluded" };
}

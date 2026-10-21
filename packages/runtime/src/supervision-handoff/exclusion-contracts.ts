import { createHash } from "node:crypto";
import { refuse, type HandoffRole, type HandoffOwner, type SelectedInstance } from "./contracts.js";
import type { ProcessSample } from "./process-evidence.js";

export const EFFECT_EXCLUSION_CAPABILITY = "role-effect-exclusion/1";
export type FenceIdentity = Readonly<{ dev: string; ino: string }>;
/** Approved audit inputs, not discovery or permission to autostart. The runtime
 * is the custody host, never an enrolled role. Its generation checks at the
 * enrolled roles' broker effect boundaries are part of each coverage audit. */
export type EffectExclusionProfile = {
  kind: typeof EFFECT_EXCLUSION_CAPABILITY;
  id: string;
  coverageId: string;
  runtimeArtifacts: string[];
  launcherArtifacts: string[];
  resourceInventory: { id: string; resources: { id: string; kind: "listener" | "registration" | "advertisement" | "executor" | "other" }[] };
  legacyEvidenceId: string;
  nonOwnerContracts: string[];
  durableWorkContract?: string;
};
export type ProfileSelection = { id: string; hash: string; capability: typeof EFFECT_EXCLUSION_CAPABILITY };
export type ExclusionContext = Readonly<{
  instance: SelectedInstance; role: HandoffRole; owner: HandoffOwner | null; generation: number;
  profileId: string; profileHash: string; policyHash: string; fence: FenceIdentity;
  observationId: string;
}>;
export type SurvivingNonOwner = { id: string; sample: ProcessSample; contractId: string };
/** Trusted local adapter observations only. Unknown and unexplained resources
 * refuse even when the lifetime fence is free. Landing-side generation checks
 * or receipt settlement must cover every delegated effect's linearization. */
export type ExclusionEvidence = ExclusionContext & {
  state: "observed";
  coverageId: string;
  resources: { inventoryId: string; entries: { id: string; kind: string; state: "released" | "non_owner"; nonOwnerId?: string }[]; unexplained: string[] };
  legacy: { evidenceId: string; state: "settled" };
  delegated: "settled" | "covered";
  durableWorkContract?: string;
  relaunch: "fenced"; inFlight: "quiescent";
  descendants: "unproven";
  nonOwners: SurvivingNonOwner[];
};
/** Deliberately not Absence or Observation. Only SDK ownership/retirement
 * decisions consume this certificate; worker absence() still reports unknown. */
export type RoleEffectExclusion = Omit<ExclusionEvidence, "state"> & {
  state: "role_effect_excluded";
  capability: typeof EFFECT_EXCLUSION_CAPABILITY;
  carriers: "excluded";
};
export function profileHash(profile: EffectExclusionProfile): string {
  return createHash("sha256").update(JSON.stringify(profile, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest("hex");
}
export function profileSelection(profile: EffectExclusionProfile): ProfileSelection {
  return { id: profile.id, hash: profileHash(profile), capability: EFFECT_EXCLUSION_CAPABILITY };
}
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
export function validateProfile(profile: EffectExclusionProfile) {
  try {
    const resources = profile.resourceInventory.resources;
    if (profile.kind !== EFFECT_EXCLUSION_CAPABILITY || !id(profile.id) || !id(profile.coverageId)
      || !id(profile.resourceInventory.id) || !id(profile.legacyEvidenceId)
      || !profile.runtimeArtifacts.length || !profile.launcherArtifacts.length
      || ![...profile.runtimeArtifacts, ...profile.launcherArtifacts].every(v => typeof v === "string" && !!v.trim())
      || !Array.isArray(profile.nonOwnerContracts) || !profile.nonOwnerContracts.every(id)
      || new Set(profile.nonOwnerContracts).size !== profile.nonOwnerContracts.length
      || (profile.durableWorkContract !== undefined && !id(profile.durableWorkContract))
      || !Array.isArray(resources) || !resources.length || resources.length > 64
      || new Set(resources.map(r => r.id)).size !== resources.length
      || resources.some(r => !id(r.id) || !["listener", "registration", "advertisement", "executor", "other"].includes(r.kind))) refuse("invalid_exclusion_profile");
  } catch { refuse("invalid_exclusion_profile"); }
}

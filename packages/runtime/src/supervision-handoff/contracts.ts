import type { DirectChildRecord } from "./child-custody.js";
import type { EffectExclusionProfile, ExclusionContext, ExclusionEvidence, ProfileSelection, RoleEffectExclusion } from "./exclusion-contracts.js";
/** Temporary, explicitly enrolled custody protocol. Not extension autostart. */
export const HANDOFF_PROTOCOL = 1;
export const HANDOFF_CAPABILITY = "supervision-handoff/1";
export const HANDOFF_ROLES = ["web", "scoutbot", "phone-controller", "app-edge", "menu"] as const;
export type HandoffRole = typeof HANDOFF_ROLES[number];
export type HandoffOwner = "R0" | "P1";
export type SelectedInstance = Readonly<{ uid: number; id: string; supportDirectory: string }>;
export type FloorPolicy = { id: string; minimumRuntimeVersion: string; runtimeArtifacts: string[];
  launcherArtifacts: string[]; rollbackArtifacts: string[]; rollbackOpen: boolean;
  effectProfiles?: Partial<Record<HandoffRole, EffectExclusionProfile>> };
export type Ownership = { owner: HandoffOwner | null; generation: number; phase: "staged" | "active" | "draining";
  desired: "running" | "stopped"; proofProfile?: ProfileSelection; transition?: { authorization: string; target: HandoffOwner };
  retirement?: { requestId: string; state: "retiring" | "retired" } };
export type ExactChild = { uid: number; instance: string; role: HandoffRole; generation: number;
  pid: number; birth: string; executable: string; effectId: string };
export type Absence = { state: "absent"; processes: "absent"; jobs: "disabled"; relaunch: "fenced"; inFlight: "quiescent" };
export type Observation = Absence | { state: "owned"; child: ExactChild } | { state: "occupied" | "unknown" };
export type Readiness = { protocol: 1; ready: boolean; runtimeVersion: string; runtimeArtifact: string;
  launcherArtifact: string; assistantClaims: boolean; integratedRoles: HandoffRole[];
  capabilities?: string[];
  roleEffectCoverage?: Partial<Record<HandoffRole, { profileId: string; profileHash: string; coverageId: string }>> };
/** Trusted host observations, never evidence accepted from request JSON. */
export interface HandoffInspector {
  readiness(role: HandoffRole): Promise<Readiness>;
  observe(role: HandoffRole): Promise<Observation>;
  exclusion?(context: ExclusionContext): Promise<ExclusionEvidence | { state: "unknown" | "occupied" }>;
}
export type AuthorizationIntent = { role: HandoffRole; generation: number; source: HandoffOwner | null;
  target: HandoffOwner; action: "enroll" | "handoff" | "recover" | "resume"; desired?: "running" | "stopped"; requestId?: string };
export type StageApproval = (selection: SelectedInstance, policy: Readonly<FloorPolicy>) => Promise<boolean>;
export type OperatorApproval = (selection: SelectedInstance, policy: Readonly<FloorPolicy>, intent: Readonly<AuthorizationIntent>) => Promise<boolean>;
export type Effect = { id: string; kind: "start" | "stop"; state: "intent" | "confirmed" | "retired";
  carrier?: "role-lifetime/7"; child?: ExactChild; directChild?: DirectChildRecord };
export type MutationReceipt = { operation: "start" | "stop" | "restart"; state: "pending" | "done"; effects: Effect[]; error?: string;
  retirement?: { policyHash: string; signal: "SIGTERM" | "SIGKILL"; signalAttempted?: true;
    signalResult?: import("./retained-child.js").ChildSignalResult; exclusion?: RoleEffectExclusion; nextGeneration?: number } };
/** A receipt snapshot, not a new observation on replay. Never process absence. */
export type CohortRetirement = { state: "retired"; role: HandoffRole; owner: HandoffOwner; generation: number;
  requestId: string; replayed: boolean; exclusion: RoleEffectExclusion };
/** Recovery discovery only: no authorization token, child custody or effect permit. */
export type PendingReceipt = { requestId: string; operation: MutationReceipt["operation"]; state: "pending";
  effects: Pick<Effect, "id" | "kind" | "state">[] };
export class HandoffError extends Error {
  constructor(readonly code: string) { super(code); this.name = "HandoffError"; }
}
export function refuse(code: string): never { throw new HandoffError(code); }
export function requireRole(role: HandoffRole): void { if (!HANDOFF_ROLES.includes(role)) refuse("invalid_role"); }
/** This SDK artifact cannot be chosen as an integrated R0 release. */
export function productionHandoffReadiness() {
  return { capability: HANDOFF_CAPABILITY, protocol: HANDOFF_PROTOCOL, ready: false as const,
    reason: "r0_effect_integration_unavailable", integratedRoles: [] as HandoffRole[] };
}

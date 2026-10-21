import { createProcessEvidenceReader, type ProcessSample, type ProcessSampleResult } from "./process-evidence.js";
import { refuse, type Absence, type HandoffRole, type SelectedInstance } from "./contracts.js";
import { policyHash, type CustodyTransaction } from "./store.js";

/** Explicit source coverage, not a list inferred from whichever records exist. */
export const LEGACY_ROLE_SURFACES = Object.freeze({
  web: Object.freeze(["server", "terminal-relay", "listeners", "descendants", "jobs", "relaunch", "in-flight"]),
  scoutbot: Object.freeze(["worker", "resident-answerers", "descendants", "jobs", "relaunch", "in-flight"]),
  "phone-controller": Object.freeze(["controller", "relay", "listeners", "mdns", "rendezvous", "descendants", "jobs", "relaunch", "in-flight"]),
  "app-edge": Object.freeze(["caddy", "mdns", "listeners", "descendants", "jobs", "relaunch", "in-flight"]),
  menu: Object.freeze(["application", "launch-services", "login-jobs", "descendants", "jobs", "relaunch", "in-flight"]),
} satisfies Record<HandoffRole, readonly string[]>);
export type LegacyResource = { id: string; kind: "process"; sample: ProcessSample }
  | { id: string; kind: "resource"; incarnation: string };
export type LegacyRoleCapture = { format: "legacy-role-capture/1"; instance: SelectedInstance; role: HandoffRole;
  generation: number; captureId: string; runtimeArtifact: string; surfaces: Record<string, LegacyResource[]> };
export type LegacyRoleContext = Readonly<{ instance: SelectedInstance; role: HandoffRole; generation: number; captureId: string }>;
export type RoleAbsence = Absence | { state: "occupied" | "unknown" };
/** Trusted local R0 adapters only. Never deserialize these functions or accept
 * a request's claim of coverage/fencing. Missing adapters cannot prove absence. */
export interface LegacyRoleSources {
  capture?(context: LegacyRoleContext): Promise<LegacyRoleCapture>;
  /** Holds all legacy restart/manual/GUI sources closed and in-flight work
   * quiescent throughout the enclosing custody scope; no TTL/PID-file proof. */
  assertFenced?(context: LegacyRoleContext): Promise<"fenced" | "unknown">;
  /** Positive observations only. An empty list is never an absence proof. */
  liveOccupants?(context: LegacyRoleContext): Promise<string[]>;
  resourceState?(context: LegacyRoleContext, surface: string, resource: Extract<LegacyResource, { kind: "resource" }>): Promise<"gone" | "occupied" | "unknown">;
  sampleProcess?(pid: number): ProcessSampleResult;
}
function sameInstance(a: SelectedInstance, b: SelectedInstance) {
  return a.uid === b.uid && a.id === b.id && a.supportDirectory === b.supportDirectory;
}
const idValid = (id: string) => typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);
const uuidValid = (id: string) => typeof id === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id);
const keysOnly = (value: object, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
function validSample(sample: ProcessSample, instance: SelectedInstance) {
  return sample?.format === "darwin-bsd-process/1"
    && keysOnly(sample, ["format", "instance", "pid", "uid", "bootSession", "startSeconds", "startMicroseconds", "executable"])
    && keysOnly(sample.instance, ["uid", "id", "supportDirectory"]) && sameInstance(sample.instance, instance) && sample.uid === instance.uid
    && Number.isSafeInteger(sample.pid) && sample.pid > 0 && sample.pid <= 0x7fffffff && uuidValid(sample.bootSession)
    && typeof sample.startSeconds === "string" && /^[1-9][0-9]{0,19}$/.test(sample.startSeconds)
    && typeof sample.startMicroseconds === "string" && /^(0|[1-9][0-9]{0,5})$/.test(sample.startMicroseconds)
    && typeof sample.executable === "string" && sample.executable.startsWith("/") && !sample.executable.includes("\0")
    && Buffer.byteLength(sample.executable) < 4096 && Buffer.from(sample.executable).toString("utf8") === sample.executable;
}
function context(tx: CustodyTransaction, role: HandoffRole, captureId: string): LegacyRoleContext {
  return Object.freeze({ instance: Object.freeze({ ...tx.state.instance }), role, generation: tx.state.roles[role].generation, captureId });
}
function validateCapture(capture: LegacyRoleCapture, expected: LegacyRoleContext, artifacts: string[]) {
  try {
    if (!keysOnly(capture, ["format", "instance", "role", "generation", "captureId", "runtimeArtifact", "surfaces"])
      || !keysOnly(capture.instance, ["uid", "id", "supportDirectory"])
      || capture.format !== "legacy-role-capture/1" || !sameInstance(capture.instance, expected.instance)
      || capture.role !== expected.role || capture.generation !== expected.generation || capture.captureId !== expected.captureId
      || !idValid(capture.captureId) || !artifacts.includes(capture.runtimeArtifact)) refuse("legacy_capture_invalid");
    const names = LEGACY_ROLE_SURFACES[expected.role];
    if (Object.keys(capture.surfaces).length !== names.length || names.some(name => !Object.hasOwn(capture.surfaces, name))) refuse("legacy_coverage_incomplete");
    const ids = new Set<string>(); let count = 0;
    for (const name of names) {
      const resources = capture.surfaces[name];
      if (!Array.isArray(resources)) refuse("legacy_coverage_incomplete");
      for (const resource of resources) {
        if (++count > 64) refuse("legacy_capture_capacity");
        if (!idValid(resource.id) || ids.has(resource.id)) refuse("legacy_capture_invalid"); ids.add(resource.id);
        if (["server", "worker", "controller", "caddy", "application", "descendants"].includes(name) && resource.kind !== "process") refuse("legacy_capture_invalid");
        if (resource.kind === "process") {
          if (!keysOnly(resource, ["id", "kind", "sample"]) || !validSample(resource.sample, expected.instance)) refuse("legacy_capture_invalid");
        } else if (resource.kind !== "resource" || !keysOnly(resource, ["id", "kind", "incarnation"]) || !idValid(resource.incarnation)) refuse("legacy_capture_invalid");
      }
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) throw error;
    refuse("legacy_capture_invalid");
  }
}
export async function captureLegacyRole(tx: CustodyTransaction, role: HandoffRole, captureId: string, sources: LegacyRoleSources) {
  tx.assertCurrent();
  const owner = tx.state.roles[role];
  if (owner.owner !== "R0" || owner.phase !== "draining") refuse("legacy_capture_not_draining");
  if (!idValid(captureId)) refuse("invalid_request_id");
  if (owner.transition?.target !== "P1") refuse("legacy_capture_not_draining");
  const grant = tx.state.authorizations[owner.transition.authorization];
  if (!grant || grant.policy !== policyHash(tx.state.policy) || grant.state !== "reserved" || grant.intent.source !== "R0" || grant.intent.target !== "P1"
    || grant.intent.role !== role || grant.intent.generation !== owner.generation) refuse("invalid_authorization");
  const captureKey = `${role}:${owner.generation}`;
  const prior = tx.state.legacyCaptures?.[captureKey];
  if (prior) {
    if (prior.manifest.generation === owner.generation && prior.manifest.captureId === captureId && prior.authorization === owner.transition.authorization) return;
    refuse("legacy_capture_conflict");
  }
  if (Object.entries(tx.state.receipts).some(([key, receipt]) => key.startsWith(`${role}:${owner.generation}:`) && receipt.state === "pending")) refuse("outcome_uncertain");
  if (!sources.capture || !sources.assertFenced) refuse("legacy_capture_unavailable");
  if (Object.keys(tx.state.legacyCaptures ?? {}).length >= 32) refuse("legacy_capture_capacity");
  const selected = context(tx, role, captureId);
  if (await sources.assertFenced(selected) !== "fenced") refuse("legacy_sources_unfenced"); tx.assertCurrent();
  const capture = structuredClone(await sources.capture(selected)); tx.assertCurrent();
  validateCapture(capture, selected, tx.state.policy.runtimeArtifacts);
  if (await sources.assertFenced(selected) !== "fenced") refuse("legacy_sources_unfenced"); tx.assertCurrent();
  if (Object.entries(tx.state.receipts).some(([key, receipt]) => key.startsWith(`${role}:${owner.generation}:`) && receipt.state === "pending")) refuse("outcome_uncertain");
  (tx.state.legacyCaptures ??= {})[captureKey] = { manifest: capture, authorization: owner.transition.authorization }; tx.persist();
}
/** Caller already holds the stable-inode custody lock. Never reacquire it here. */
export async function inspectLegacyRole(tx: CustodyTransaction, role: HandoffRole, sources: LegacyRoleSources): Promise<RoleAbsence> {
  tx.assertCurrent();
  const owner = tx.state.roles[role];
  const captureGeneration = owner.owner === "P1" ? owner.generation - 1 : owner.generation;
  const record = tx.state.legacyCaptures?.[`${role}:${captureGeneration}`];
  const capture = record?.manifest;
  const selected = Object.freeze({ ...context(tx, role, capture?.captureId ?? "uncaptured"), generation: captureGeneration });
  let unknown = false;
  if (sources.liveOccupants) {
    try {
      const live = await sources.liveOccupants(context(tx, role, selected.captureId)); tx.assertCurrent();
      if (!Array.isArray(live) || live.some(surface => !LEGACY_ROLE_SURFACES[role].includes(surface))) unknown = true;
      else if (live.length) return { state: "occupied" };
    } catch { unknown = true; }
  }
  if (!capture || !record || capture.generation !== selected.generation) return { state: "unknown" };
  const grant = tx.state.authorizations[record.authorization];
  if (!grant || grant.policy !== policyHash(tx.state.policy) || grant.intent.role !== role || grant.intent.generation !== captureGeneration || grant.intent.action !== "handoff"
    || grant.intent.source !== "R0" || grant.intent.target !== "P1"
    || !(owner.owner === "R0" && owner.phase === "draining" && owner.transition?.authorization === record.authorization && grant.state === "reserved"
      || owner.owner === "P1" && owner.generation === captureGeneration + 1 && grant.state === "used")) return { state: "unknown" };
  const uncertain = () => Object.entries(tx.state.receipts).some(([key, receipt]) =>
    (key.startsWith(`${role}:${owner.generation}:`) || key.startsWith(`${role}:${captureGeneration}:`))
    && receipt.state === "pending" && receipt.effects.some(effect => effect.state === "intent"));
  // An inherited R0 inventory cannot certify children possibly born under
  // P1. Until a current-owner native inventory is integrated, remain closed
  // even if a later stop receipt exists; never reuse bootstrap absence.
  const newerBirth = () => owner.owner === "P1" && Object.entries(tx.state.receipts).some(([key, receipt]) =>
    key.startsWith(`${role}:${owner.generation}:`) && receipt.effects.some(effect => effect.kind === "start"));
  if (uncertain() || newerBirth()) unknown = true;
  try { validateCapture(capture, selected, tx.state.policy.runtimeArtifacts); } catch { return { state: "unknown" }; }
  const fenced = async () => {
    if (!sources.assertFenced) return false;
    try { const proof = await sources.assertFenced(selected); tx.assertCurrent(); return proof === "fenced"; } catch { return false; }
  };
  if (!await fenced()) unknown = true;
  const sample = sources.sampleProcess ?? createProcessEvidenceReader(tx.state.instance).sample;
  for (const [surface, resources] of Object.entries(capture.surfaces)) for (const resource of resources) {
    try {
      if (resource.kind === "process") {
        const current = sample(resource.sample.pid); tx.assertCurrent();
        if (current.state === "pid_absent" && current.pid === resource.sample.pid) continue;
        if (current.state !== "sampled" || !validSample(current.sample, selected.instance) || current.sample.pid !== resource.sample.pid) { unknown = true; continue; }
        const before = resource.sample, after = current.sample;
        // Exec can change the executable/UID without ending the process.
        // Only boot/birth replacement, never generic "different_sample", discharges it.
        if (before.bootSession.toLowerCase() !== after.bootSession.toLowerCase() || before.startSeconds !== after.startSeconds
          || before.startMicroseconds !== after.startMicroseconds) continue;
        return { state: "occupied" };
      }
      const result = await sources.resourceState?.(selected, surface, structuredClone(resource)); tx.assertCurrent();
      if (result === "occupied") return { state: "occupied" };
      if (result !== "gone") unknown = true;
    } catch { unknown = true; }
  }
  if (!await fenced() || uncertain() || newerBirth()) unknown = true;
  tx.assertCurrent();
  return unknown ? { state: "unknown" } : { state: "absent", processes: "absent", jobs: "disabled", relaunch: "fenced", inFlight: "quiescent" };
}

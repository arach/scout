/** Pure acquisition observations. This module grants no service or custody authority. */
import type { RuntimeServiceAdapterKind } from "./runtime-adapters.js";

export const CORE_ACQUISITION_SCHEMA = "scout.core-acquisition/v1" as const;
export const CORE_ACQUISITION_BLOCKED_REASONS = Object.freeze([
  "unqualified_legacy_auto_start", "unverified_effect_coverage", "wrong_identity",
  "observation_unavailable", "observation_refused", "observation_timed_out",
  "observation_absent", "observation_cancelled", "observation_not_checked",
  "observation_invalid", "wrong_target", "identity_unverified", "core_unhealthy",
] as const);
export type CoreAcquisitionBlockedReason = typeof CORE_ACQUISITION_BLOCKED_REASONS[number];

export type CoreAcquisitionTarget = Readonly<{
  instance: string;
  brokerUrl: string;
  /** Independently configured expectation, never copied from the response. */
  expectedNodeId?: string;
}>;
type Endpoint = Readonly<Pick<CoreAcquisitionTarget, "instance" | "brokerUrl">>;
export type CoreAcquisitionObservation = Readonly<{
  target: Endpoint;
  checkedAt: number | null;
}> & (
  | Readonly<{ state: "observed"; status: number; ok: boolean; nodeId: string | null;
      runtimeArtifactId: string | null }>
  | Readonly<{ state: "absent" | "unavailable" | "refused" | "timed_out" | "cancelled" | "not_checked" | "invalid_response" }>
);

/** Trusted host adapter input, NOT a proof accepted from client JSON or a permit.
 * No production evidence producer or service integration is added by this contract. */
export type CoreAcquisitionAdapterEvidence = Readonly<{
  adapter: RuntimeServiceAdapterKind;
  target: Endpoint;
  /** Binds coverage to this observation, not an arbitrary cached observation. */
  checkedAt: number;
}> & (
  | Readonly<{ state: "unqualified_legacy_auto_start" | "unverified_effect_coverage" }>
  | (Readonly<{ state: "core_only"; basis: "adapter_artifact_effect_coverage";
      adapterArtifactId: string; runtimeArtifactId: string; coverageId: string }> & (
      | Readonly<{ adapter: "headless-foreground"; acquisition: "operator_foreground" }>
      | Readonly<{ adapter: Exclude<RuntimeServiceAdapterKind, "headless-foreground">; acquisition: "service_manager" }>
    ))
);
export type CoreAcquisitionIdentityBasis = Readonly<{
  state: "matched" | "mismatch" | "unverified";
  basis: "independent_expected_node_id" | "not_observed" | "missing_expected_node_id" | "missing_observed_node_id" | "wrong_target";
  expectedNodeId: string | null;
  observedNodeId: string | null;
}>;
export type CoreAcquisitionCoverageBasis =
  | Readonly<{ state: "unverified"; basis: "not_supplied" | "unverified_effect_coverage" | "unqualified_legacy_auto_start" }>
  | Readonly<{ state: "verified_core_only"; basis: "adapter_artifact_effect_coverage";
      adapter: RuntimeServiceAdapterKind; adapterArtifactId: string; runtimeArtifactId: string;
      coverageId: string; checkedAt: number; binding: "observed_runtime_artifact" | "candidate_runtime_artifact" }>;
export type CoreServiceAcquisition = Readonly<{
  schema: typeof CORE_ACQUISITION_SCHEMA;
  target: CoreAcquisitionTarget;
  observation: Readonly<{ state: CoreAcquisitionObservation["state"]; checkedAt: number | null }>;
  identity: CoreAcquisitionIdentityBasis;
  coverage: CoreAcquisitionCoverageBasis;
  custody: "not_assessed";
}> & (
  | Readonly<{ outcome: "verified_existing_core";
      identity: CoreAcquisitionIdentityBasis & { state: "matched"; basis: "independent_expected_node_id";
        expectedNodeId: string; observedNodeId: string };
      coverage: Extract<CoreAcquisitionCoverageBasis, { state: "verified_core_only" }> & { binding: "observed_runtime_artifact" } }>
  | Readonly<{ outcome: "operator_foreground_handoff"; command: "openscout-runtime broker";
      identity: CoreAcquisitionIdentityBasis & { state: "unverified"; basis: "not_observed" };
      coverage: Extract<CoreAcquisitionCoverageBasis, { state: "verified_core_only" }> & {
        adapter: "headless-foreground"; binding: "candidate_runtime_artifact" } }>
  | Readonly<{ outcome: "blocked"; reason: CoreAcquisitionBlockedReason }>
);
export type CoreAcquisitionInput = Readonly<{
  target: CoreAcquisitionTarget;
  observation: CoreAcquisitionObservation;
  adapterEvidence?: CoreAcquisitionAdapterEvidence;
}>;

const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const time = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const sameEndpoint = (left: Endpoint, right: Endpoint): boolean => left.instance === right.instance && left.brokerUrl === right.brokerUrl;

/** Classify supplied observations only. No clock, environment, I/O, app discovery,
 * lifecycle call, enrollment, start permission, ownership or readiness handshake. */
export function assessCoreServiceAcquisition(input: CoreAcquisitionInput): CoreServiceAcquisition {
  const { target, observation, adapterEvidence: evidence } = input;
  const selected = { instance: target.instance, brokerUrl: target.brokerUrl,
    ...(target.expectedNodeId !== undefined ? { expectedNodeId: target.expectedNodeId } : {}) };
  const matchingTarget = sameEndpoint(target, observation.target);
  const expected = text(target.expectedNodeId) ? target.expectedNodeId : null;
  const node = observation.state === "observed" && text(observation.nodeId) ? observation.nodeId : null;
  const identity: CoreAcquisitionIdentityBasis = {
    state: matchingTarget && expected && node ? expected === node ? "matched" : "mismatch" : "unverified",
    basis: !matchingTarget ? "wrong_target" : observation.state !== "observed" ? "not_observed"
      : !expected ? "missing_expected_node_id" : !node ? "missing_observed_node_id" : "independent_expected_node_id",
    expectedNodeId: expected, observedNodeId: node,
  };
  let coverage: CoreAcquisitionCoverageBasis = { state: "unverified", basis: evidence ? "unverified_effect_coverage" : "not_supplied" };
  const evidenceBound = evidence && sameEndpoint(target, evidence.target) && time(evidence.checkedAt)
    && evidence.checkedAt === observation.checkedAt;
  if (evidenceBound && evidence.state === "unqualified_legacy_auto_start") {
    coverage = { state: "unverified", basis: "unqualified_legacy_auto_start" };
  }
  if (evidenceBound && evidence.state === "core_only" && evidence.basis === "adapter_artifact_effect_coverage"
    && text(evidence.adapterArtifactId) && text(evidence.runtimeArtifactId) && text(evidence.coverageId)) {
    const foreground = evidence.adapter === "headless-foreground" && evidence.acquisition === "operator_foreground";
    const managed = ["macos-scoutd", "linux-systemd-user", "windows-service"].includes(evidence.adapter)
      && evidence.acquisition === "service_manager";
    const binding = matchingTarget && observation.state === "observed" && observation.runtimeArtifactId === evidence.runtimeArtifactId
      ? "observed_runtime_artifact" : matchingTarget && observation.state === "absent" ? "candidate_runtime_artifact" : null;
    if ((foreground || managed) && binding) {
      coverage = { state: "verified_core_only", basis: evidence.basis, adapter: evidence.adapter,
        adapterArtifactId: evidence.adapterArtifactId, runtimeArtifactId: evidence.runtimeArtifactId,
        coverageId: evidence.coverageId, checkedAt: evidence.checkedAt, binding };
    }
  }
  const base = { schema: CORE_ACQUISITION_SCHEMA, target: selected,
    observation: { state: observation.state, checkedAt: observation.checkedAt }, identity, coverage, custody: "not_assessed" as const };
  const blocked = (reason: CoreAcquisitionBlockedReason): CoreServiceAcquisition => ({ ...base, outcome: "blocked", reason });
  if (!text(target.instance) || !text(target.brokerUrl) || !matchingTarget) return blocked("wrong_target");
  if (observation.state === "refused") return blocked("observation_refused");
  if (observation.state === "timed_out") return blocked("observation_timed_out");
  if (observation.state === "unavailable") return blocked("observation_unavailable");
  if (observation.state === "cancelled") return blocked("observation_cancelled");
  if (observation.state === "not_checked") return blocked("observation_not_checked");
  if (!["observed", "absent", "invalid_response"].includes(observation.state) || observation.state === "invalid_response" || !time(observation.checkedAt)) return blocked("observation_invalid");
  if (observation.state === "observed") {
    if (identity.state === "mismatch") return blocked("wrong_identity");
    if (identity.state !== "matched") return blocked("identity_unverified");
    if (!Number.isInteger(observation.status) || observation.status < 100 || observation.status > 599
      || typeof observation.ok !== "boolean") return blocked("observation_invalid");
    if (!observation.ok || observation.status < 200 || observation.status >= 300) return blocked("core_unhealthy");
  }
  if (coverage.state !== "verified_core_only") return blocked(coverage.basis === "unqualified_legacy_auto_start"
    ? "unqualified_legacy_auto_start" : "unverified_effect_coverage");
  if (observation.state === "absent") {
    return coverage.binding === "candidate_runtime_artifact" && coverage.adapter === "headless-foreground"
      ? { ...base, outcome: "operator_foreground_handoff", command: "openscout-runtime broker",
          identity: { ...identity, state: "unverified", basis: "not_observed" },
          coverage: { ...coverage, adapter: "headless-foreground", binding: "candidate_runtime_artifact" } }
      : blocked("observation_absent");
  }
  // Unknown observation states from JavaScript callers cannot produce success.
  if (observation.state !== "observed") return blocked("observation_invalid");
  return { ...base, outcome: "verified_existing_core",
    identity: { ...identity, state: "matched", basis: "independent_expected_node_id",
      expectedNodeId: expected!, observedNodeId: node! },
    coverage: { ...coverage, binding: "observed_runtime_artifact" } };
}

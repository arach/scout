import { expect, test } from "bun:test";
import {
  assessCoreServiceAcquisition, CORE_ACQUISITION_BLOCKED_REASONS, CORE_ACQUISITION_SCHEMA,
  type CoreAcquisitionInput, type CoreAcquisitionAdapterEvidence, type CoreAcquisitionObservation,
} from "./core-acquisition.js";

const target = { instance: "fixture", brokerUrl: "http://127.0.0.1:43139", expectedNodeId: "node-fixture" };
const endpoint = { instance: target.instance, brokerUrl: target.brokerUrl };
const observed = (): CoreAcquisitionObservation => ({ target: { ...endpoint }, checkedAt: 42,
  state: "observed", status: 200, ok: true, nodeId: "node-fixture", runtimeArtifactId: "runtime-artifact-a" });
const evidence = (): CoreAcquisitionAdapterEvidence => ({ adapter: "linux-systemd-user", target: { ...endpoint }, checkedAt: 42,
  state: "core_only", basis: "adapter_artifact_effect_coverage", adapterArtifactId: "adapter-artifact-a",
  runtimeArtifactId: "runtime-artifact-a", coverageId: "all-effects-fixture", acquisition: "service_manager" });
const input = (): CoreAcquisitionInput => ({ target: { ...target }, observation: observed(), adapterEvidence: evidence() });
const absent = (): CoreAcquisitionObservation => ({ state: "absent", target: { ...endpoint }, checkedAt: 42 });
const foreground = (): CoreAcquisitionAdapterEvidence => ({ ...evidence(), state: "core_only", basis: "adapter_artifact_effect_coverage",
  adapterArtifactId: "adapter-artifact-a", runtimeArtifactId: "runtime-artifact-a", coverageId: "all-effects-fixture",
  adapter: "headless-foreground", acquisition: "operator_foreground" });
function reason(value: CoreAcquisitionInput) {
  const result = assessCoreServiceAcquisition(value);
  expect(result.outcome).toBe("blocked");
  if (result.outcome !== "blocked") throw new Error("expected blocked fixture");
  expect(CORE_ACQUISITION_BLOCKED_REASONS).toContain(result.reason);
  return result.reason;
}

test("verified existing core names its exact identity and artifact coverage basis, never custody", () => {
  const result = assessCoreServiceAcquisition(input());
  expect(result).toEqual({
    schema: "scout.core-acquisition/v1", outcome: "verified_existing_core", custody: "not_assessed", target,
    observation: { state: "observed", checkedAt: 42 },
    identity: { state: "matched", basis: "independent_expected_node_id", expectedNodeId: "node-fixture", observedNodeId: "node-fixture" },
    coverage: { state: "verified_core_only", basis: "adapter_artifact_effect_coverage", adapter: "linux-systemd-user",
      adapterArtifactId: "adapter-artifact-a", runtimeArtifactId: "runtime-artifact-a", coverageId: "all-effects-fixture",
      checkedAt: 42, binding: "observed_runtime_artifact" },
  });
  expect(result).not.toHaveProperty("command");
  expect(result).not.toHaveProperty("permit");
});

test("load-bearing negative: healthy matched identity and equal versions without adapter evidence never verify", () => {
  const value = { ...input(), adapterEvidence: undefined, expectedVersion: "1.2.3", observedVersion: "1.2.3" };
  expect(reason(value)).toBe("unverified_effect_coverage");
  const result = assessCoreServiceAcquisition(value);
  expect(result.identity.state).toBe("matched");
  expect(result.coverage).toEqual({ state: "unverified", basis: "not_supplied" });
  expect(result.custody).toBe("not_assessed");
});

test("no adapter evidence never yields a foreground handoff, even for an explicitly absent observation", () => {
  expect(reason({ ...input(), observation: absent(), adapterEvidence: undefined })).toBe("unverified_effect_coverage");
});

test("qualified foreground candidate and explicit absent observation produce advice, not verified identity or a start permit", () => {
  const result = assessCoreServiceAcquisition({ ...input(), observation: absent(), adapterEvidence: foreground() });
  expect(result.outcome).toBe("operator_foreground_handoff");
  if (result.outcome !== "operator_foreground_handoff") throw new Error("handoff fixture");
  expect(result.command).toBe("openscout-runtime broker");
  expect(result.identity).toEqual({ state: "unverified", basis: "not_observed", expectedNodeId: "node-fixture", observedNodeId: null });
  expect(result.coverage.state).toBe("verified_core_only");
  if (result.coverage.state === "verified_core_only") expect(result.coverage.binding).toBe("candidate_runtime_artifact");
  expect(result.custody).toBe("not_assessed");
  expect(result).not.toHaveProperty("permit");
});

test("absence is not unavailable and a qualified managed candidate cannot produce a start permit or foreground advice", () => {
  expect(reason({ ...input(), observation: absent() })).toBe("observation_absent");
});

for (const state of ["unavailable", "refused", "timed_out", "cancelled", "not_checked", "invalid_response"] as const) {
  test(`${state} observation stays a distinct blocked result, never absence or handoff`, () => {
    const observation = { state, target: { ...endpoint }, checkedAt: 42 };
    expect(reason({ ...input(), observation, adapterEvidence: foreground() })).toBe(state === "invalid_response" ? "observation_invalid" : `observation_${state}`);
    const result = assessCoreServiceAcquisition({ ...input(), observation, adapterEvidence: foreground() });
    expect(result.observation.state).toBe(state);
    expect(result.identity.basis).toBe("not_observed");
  });
}

for (const state of ["unqualified_legacy_auto_start", "unverified_effect_coverage"] as const) {
  test(`${state} is a negative adapter finding, distinct from observation failure`, () => {
    expect(reason({ ...input(), adapterEvidence: { adapter: "macos-scoutd", target: endpoint, checkedAt: 42, state } })).toBe(state);
  });
}

test("a wrong node never borrows coverage or the independently configured expectation", () => {
  expect(reason({ ...input(), observation: { ...observed(), state: "observed", status: 200, ok: true, nodeId: "another-node", runtimeArtifactId: "runtime-artifact-a" } })).toBe("wrong_identity");
});

test("missing expected identity cannot be copied from health; missing observed identity cannot be filled from selection", () => {
  expect(reason({ ...input(), target: { ...target, expectedNodeId: undefined } })).toBe("identity_unverified");
  expect(reason({ ...input(), observation: { ...observed(), state: "observed", status: 200, ok: true, nodeId: null, runtimeArtifactId: "runtime-artifact-a" } })).toBe("identity_unverified");
});

test("wrong selected instance or endpoint is blocked even with a matching node ID", () => {
  for (const wrong of [{ ...endpoint, instance: "other" }, { ...endpoint, brokerUrl: "http://127.0.0.1:1" }]) {
    expect(reason({ ...input(), observation: { ...observed(), target: wrong } })).toBe("wrong_target");
    expect(reason({ ...input(), adapterEvidence: { ...evidence(), target: wrong } })).toBe("unverified_effect_coverage");
  }
});

test("unhealthy and reachable-but-unhealthy foreground observations do not become handoffs", () => {
  for (const change of [{ ok: false }, { status: 503 }]) {
    expect(reason({ ...input(), observation: { ...observed(), state: "observed", status: 200, ok: true,
      nodeId: "node-fixture", runtimeArtifactId: "runtime-artifact-a", ...change }, adapterEvidence: foreground() })).toBe("core_unhealthy");
  }
});

test("artifact mismatch, missing coverage IDs and unbound observation time cannot verify effects", () => {
  for (const change of [{ runtimeArtifactId: "other-artifact" }, { coverageId: "" }, { adapterArtifactId: "" }, { checkedAt: 41 }, { checkedAt: NaN }]) {
    expect(reason({ ...input(), adapterEvidence: { ...evidence(), ...change } as CoreAcquisitionAdapterEvidence })).toBe("unverified_effect_coverage");
  }
});

test("legacy/unverified findings from another observation cannot be mistaken for qualified coverage", () => {
  expect(reason({ ...input(), adapterEvidence: { adapter: "macos-scoutd", target: endpoint, checkedAt: 41,
    state: "unqualified_legacy_auto_start" } })).toBe("unverified_effect_coverage");
});

test("invalid observations and malformed JavaScript scalar evidence fail closed", () => {
  for (const checkedAt of [null, NaN, Infinity, -1]) expect(reason({ ...input(), observation: { ...observed(), checkedAt } })).toBe("observation_invalid");
  for (const status of [0, 600, NaN, 200.5]) expect(reason({ ...input(), observation: { ...observed(), state: "observed", status,
    ok: true, nodeId: "node-fixture", runtimeArtifactId: "runtime-artifact-a" } })).toBe("observation_invalid");
  for (const change of [{ basis: "version_equality" }, { adapter: "unknown" }, { adapter: "headless-foreground", acquisition: "service_manager" }]) {
    expect(reason({ ...input(), adapterEvidence: { ...evidence(), ...change } as CoreAcquisitionAdapterEvidence })).toBe("unverified_effect_coverage");
  }
  expect(reason({ ...input(), observation: { ...observed(), state: "invented" } as unknown as CoreAcquisitionObservation })).toBe("observation_invalid");
});

test("qualified healthy externally controlled foreground core is an existing-core observation, not a handoff", () => {
  expect(assessCoreServiceAcquisition({ ...input(), adapterEvidence: foreground() }).outcome).toBe("verified_existing_core");
});

test("schema and blocked vocabulary are exact, closed and frozen", () => {
  expect(CORE_ACQUISITION_SCHEMA).toBe("scout.core-acquisition/v1");
  expect(CORE_ACQUISITION_BLOCKED_REASONS).toEqual([
    "unqualified_legacy_auto_start", "unverified_effect_coverage", "wrong_identity", "observation_unavailable",
    "observation_refused", "observation_timed_out", "observation_absent", "observation_cancelled",
    "observation_not_checked", "observation_invalid", "wrong_target", "identity_unverified", "core_unhealthy",
  ]);
  expect(Object.isFrozen(CORE_ACQUISITION_BLOCKED_REASONS)).toBe(true);
});

test("classification is deterministic, does not mutate inputs and returns detached nested data", () => {
  const value = input();
  function freeze(object: object) { for (const child of Object.values(object)) if (child && typeof child === "object") freeze(child); Object.freeze(object); }
  freeze(value);
  expect(assessCoreServiceAcquisition(value)).toEqual(assessCoreServiceAcquisition(value));
  const mutable = input();
  const result = assessCoreServiceAcquisition(mutable);
  Object.assign(mutable.target, { expectedNodeId: "changed" });
  Object.assign(mutable.observation.target, { instance: "changed" });
  Object.assign(mutable.adapterEvidence!, { coverageId: "changed" });
  expect(result.target).toEqual(target);
  expect(result.identity.expectedNodeId).toBe("node-fixture");
  if (result.coverage.state === "verified_core_only") expect(result.coverage.coverageId).toBe("all-effects-fixture");
});

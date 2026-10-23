# Core acquisition observation contract

`assessCoreServiceAcquisition` is a pure function exported from the existing
`@openscout/runtime/onboarding` subpath. It classifies supplied core observations
and trusted adapter evidence. It does not gather observations or control a
service. This contract is staged; onboarding does not call it yet.

```ts
import {
  assessCoreServiceAcquisition,
  type CoreAcquisitionInput,
  type CoreServiceAcquisition,
} from "@openscout/runtime/onboarding";

const result: CoreServiceAcquisition = assessCoreServiceAcquisition(input);
// input: CoreAcquisitionInput, gathered by a trusted host adapter outside this function
```

## Schema and exports

Every result has `schema: "scout.core-acquisition/v1"`. The schema name never
changes meaning in place. An incompatible field, outcome, reason, evidence
requirement or verification-meaning change requires a new versioned schema name
and an explicit migration. This document defines v1, not the setup.v2 mapping.

The public runtime exports added through `onboarding` are:

- `assessCoreServiceAcquisition`;
- `CORE_ACQUISITION_SCHEMA` and frozen `CORE_ACQUISITION_BLOCKED_REASONS`;
- types `CoreAcquisitionInput`, `CoreAcquisitionTarget`,
  `CoreAcquisitionObservation`, `CoreAcquisitionAdapterEvidence`,
  `CoreAcquisitionIdentityBasis`, `CoreAcquisitionCoverageBasis`,
  `CoreAcquisitionBlockedReason`, and `CoreServiceAcquisition`.

There is no new package subpath, broker endpoint, CLI command, lifecycle API,
start-permitted outcome or operator authorization token.

## Inputs and provenance

`target` identifies the selected `instance` and exact `brokerUrl`. An optional
`expectedNodeId` is an independently configured expectation. The adapter must
not derive it from the observed health response. No URL normalization, endpoint
fallback, instance selection or environment read occurs inside the assessor.

`observation` names the same endpoint and an explicit `checkedAt` timestamp.
An `observed` record supplies HTTP `status`, boolean `ok`, `nodeId` and exact
`runtimeArtifactId`. Other states are `absent`, `unavailable`, `refused`,
`timed_out`, `cancelled`, `not_checked` and `invalid_response`. An observer must
report those states truthfully. In particular, timeout, refusal, network failure
and missing data are not `absent`.

`absent` means the observer explicitly reported no existing core response. It
is **not** a process/job absence certificate, proof a port is free, or permission
to start a process. Only that explicit observation can support foreground
handoff advice. An unavailable, refused or timed-out observation stays blocked.

`adapterEvidence` is optional so that absence can be represented truthfully.
**No evidence supplied means blocked, never foreground handoff or verified
existing core.** Health OK, matching node IDs, matching semantic versions and a
healthy `core-report` do not supply effect coverage.

The typed evidence object names:

- `adapter`: the producing runtime adapter, one of `macos-scoutd`,
  `linux-systemd-user`, `headless-foreground` or `windows-service`;
- `target` and `checkedAt`: the selected endpoint and the exact observation time
  to which this evidence is bound;
- `state`: `unqualified_legacy_auto_start`, `unverified_effect_coverage`, or
  `core_only`.

A `core_only` record additionally supplies `basis:
"adapter_artifact_effect_coverage"`, nonempty `adapterArtifactId`,
`runtimeArtifactId` and `coverageId`, plus its acquisition mode.
`headless-foreground` uses `operator_foreground`; the other adapter types use
`service_manager`. The basis means the **trusted producer** has verified that
the named adapter/runtime artifact pair's relevant effects are core-only. The
coverage identifier names the producer's coverage evidence, not a version or
process name. For an existing core, the observed runtime artifact must exactly
match that evidence. For an absent core, coverage refers only to the named
candidate artifact, not a running process.

The function checks the supplied identifiers, mode, target and time binding.
It cannot authenticate the producer or inspect artifacts. This is a typed
trusted-host interface, not a parser or verifier for untrusted client JSON.
A caller that fabricates coverage can fabricate the observation; the DTO is not
a security credential. Observation gathering, artifact verification, clock
freshness policy and safe transport selection remain producer obligations.
No current production adapter is newly qualified and no producer is integrated
by this PR. Windows is an existing adapter type, not a newly implemented
Windows service. Tests use synthetic evidence, not production qualification.

## Outcomes and verification limits

All outcomes include the selected `target`, `observation.state` and `checkedAt`,
`identity`, `coverage`, and literal `custody: "not_assessed"`.

| Outcome | Required evidence | Meaning |
| --- | --- | --- |
| `verified_existing_core` | Successful observed health, independently expected matching node identity, and time/endpoint/artifact-bound core-only adapter coverage | The supplied observation identifies the expected existing core and the supplied trusted adapter evidence covers its named artifact pair. |
| `operator_foreground_handoff` | Explicit `absent` observation and bound core-only candidate coverage from the `headless-foreground` adapter | Advice to run `command: "openscout-runtime broker"` under the operator's existing foreground authority. No running core or matched node is claimed. |
| `blocked` | A failed, missing, uncertain or incompatible prerequisite | `reason` is one of the closed values below. Nothing is started or authorized. |

`identity` carries `state` (`matched`, `mismatch` or `unverified`), the expected
and observed node IDs (or null), and its basis:
`independent_expected_node_id`, `not_observed`, `missing_expected_node_id`,
`missing_observed_node_id` or `wrong_target`. A result never fills either node ID
from the other. Wrong-target observations cannot claim matched identity.

Verified `coverage` carries `state: "verified_core_only"`, its
`adapter_artifact_effect_coverage` basis, the adapter/artifact/coverage IDs and
binding time. `binding: "observed_runtime_artifact"` means that the existing
core observation named that exact runtime artifact.
`binding: "candidate_runtime_artifact"` means only that the explicitly absent
observation is accompanied by coverage of the intended candidate. It is not
running coverage or process absence. Unverified coverage instead reports
`basis: "not_supplied"`, `unverified_effect_coverage` or
`unqualified_legacy_auto_start`.

These bases are independent prerequisites. For example, an unhealthy core can
have matched identity and supplied verified coverage while the outcome remains
blocked. Consumers must inspect the outcome and must not promote one positive
basis into success.

"Verified" does not mean service ownership, full core completion, harness
sign-in, storage/journal/projection readiness, exact child custody or permission
to start, stop, uninstall, restart or take over anything. Use `core-report` for
its separate core-health/completion checks. Neither report grants authority.

## Closed blocked reasons and precedence

`CoreAcquisitionBlockedReason` is the exact closed union exported by
`CORE_ACQUISITION_BLOCKED_REASONS`. There are no free-text reasons or raw error
payloads. Consumers must not interpret a reason as mutation authorization.

| Reason | Meaning |
| --- | --- |
| `unqualified_legacy_auto_start` | Bound adapter evidence explicitly reports an unqualified legacy auto-start path. |
| `unverified_effect_coverage` | Adapter evidence is missing, reports unverified coverage, is malformed, lacks identifiers, or does not bind the selected endpoint/time/runtime artifact and acquisition mode. |
| `wrong_identity` | The observed node differs from the independently expected node. |
| `observation_unavailable` | The observer could not obtain the observation; not absence. |
| `observation_refused` | The observer was refused; not an unhealthy/absent service finding. |
| `observation_timed_out` | The observation timed out; not absence. |
| `observation_absent` | An explicitly absent core has qualified managed-candidate coverage but cannot receive foreground advice. No start is permitted. |
| `observation_cancelled` | Observation was cancelled. |
| `observation_not_checked` | No observation was attempted. |
| `observation_invalid` | Invalid response/state, missing or invalid observation time, invalid HTTP status or non-boolean observed health. |
| `wrong_target` | Selection is empty or the observation names a different instance/endpoint. |
| `identity_unverified` | An observed response lacks a nonempty independent expectation or observed node ID. |
| `core_unhealthy` | An identity-matched response reports health false or a non-success HTTP status. |

Evaluation order is deterministic: target, non-observed failure state, valid
observation time/state, observed identity, observed status/health, effect
coverage, then explicit absence versus existing core. Within observed identity,
a mismatch precedes missing identity. Within coverage, a bound negative legacy
finding retains its named reason; missing/mismatched evidence stays unverified.
For example, absence without adapter evidence returns
`unverified_effect_coverage`, never a handoff. Refusal without evidence returns
`observation_refused`, still blocked, while coverage says `not_supplied`.
Timestamps must be finite and nonnegative; an observed HTTP status must be an
integer from 100 through 599, with 200 through 299 required for success.

The assessor is deterministic for the same inputs. It reads no clock,
environment, filesystem, process table or network. It does not mutate inputs
and returns detached output records. Types are readonly; no ambient state is
stored between calls.

## Staging and adoption boundary

`runOpenScoutOnboardingSetup` keeps its exact existing behavior. Setup and doctor
schemas, service-manager behavior, automatic maintenance and native update are
unchanged. There is no app discovery/download/launch, lifecycle call, private
app import, native binding load or supervision-handoff enrollment in this
assessor. Importing the added module requires no Bun or native custody runtime.

Core service stop/uninstall remain owned by the existing runtime service
managers. The R0/P1 production readiness stub remains closed. This API does not
certify legacy supervisor effect coverage or open a provider/transport gate.

Later adoption needs separate approval of exact setup.v2 wire names/mapping and
the production adapter evidence/qualification path. Do not infer adoption,
custody or successful cold core-only acquisition from this additive contract.

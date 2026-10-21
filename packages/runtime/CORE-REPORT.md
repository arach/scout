# Core service report and setup completion

Import from `@openscout/runtime/core-report`. This subpath projects observations
the caller already holds. It performs no I/O, starts no service and does not
load onboarding, native supervision, app discovery, credential handling or
harness probing at runtime. It adds no route.

## Five-line contract

1. `buildCoreServiceReport` returns `scout.core-report/v1` for an explicit instance, broker endpoint and optional expected node, retaining the supplied observation.
2. Core liveness, startup/replay, projection, journal writes and cached storage are assessed separately as working, starting, impaired, inconclusive or not checked.
3. App, local edge, PTY and native supervision are optional, each available, unavailable or not checked, with supplied provenance; none changes core assessment.
4. `describeCoreHarnessPresence` says found, missing or not checked from supplied executable-path evidence; authentication and readiness remain not checked.
5. `assessCoreSetupCompletion` returns core-scoped complete, pending or failed, independently of the app and harness; it never offers app installation, browser/server or phone pairing.

## Inputs and evidence

`CoreReportTarget` names the selected instance and broker URL. Optional
`expectedNodeId` checks the returned node. Each `CoreHealthObservation` also
names the instance/endpoint that was actually read and its observation time.
A different endpoint, instance or node cannot establish the selected core's
state. A missing expected identity is unverified, not matched.

Health observation states are `observed`, `not_checked`, `unavailable`,
`timed_out`, `cancelled`, `refused` and `invalid_response`.
The supplied status, error, refusal body and payload are retained. Inputs must
be structured-cloneable, serializable observations. The caller should decode
and validate HTTP data before treating it as an observed health payload; basic
malformed/missing liveness evidence still becomes inconclusive.

`CoreReportHealthPayload` reuses existing startup, projection, journal-write,
journal-replay and cached storage types through **type-only** imports.
The runtime's existing `/health` already supplies these fields. The builder
does not request health, read storage, open SQLite, enumerate processes,
search app bundles or inspect PATH. A CLI adapter supplies its existing
endpoint read, not `BrokerServiceStatus` or a fabricated ownership object.

The report records both report generation time and the original observation
times. It does not refresh evidence or impose a freshness TTL. The caller must
label cached observations accurately and obtain a new read when current
status is needed. A report is a diagnostic observation, not a custody,
installation, authorization or readiness lease.

The report contains no installed/loaded/PID/service-adapter claim.
`custody: "not_assessed"` is explicit, even when every core check works.
Without an expected node, a matching endpoint response is usable endpoint
evidence but its node identity remains unverified.

## Core assessment

There are five checks: health, startup, projection, journal and storage.

- Liveness `ok:false` or an observed non-success HTTP status is impaired.
  `ok:true` alone does not establish durable writes.
- Startup failure/degradation/error, journal replay failure/error and journal
  compaction capacity deferral are impaired. Restoring, closed mutation
  admission, incomplete core/history coverage or unfinished replay is starting.
- A degraded or disabled projection, nonzero skip ledger or open quarantine
  is impaired. A warming projection is starting.
- Failing canonical journal writes are impaired. Error code, count and
  timestamps remain in the original evidence.
- Cached critical disk pressure, maintenance-needed storage or a storage
  maintenance error is impaired. Unknown measurements, missing sample time or
  a failed measurement are inconclusive. Last known pressure remains impaired
  even if a newer sampling attempt failed.
- Missing component evidence is not checked, never silently working.
  Old liveness-only health therefore gives an inconclusive full core report.

Any impairment wins over starting or unknown evidence. Starting wins over
remaining unknown checks. Otherwise, any inconclusive/not-checked check makes
the aggregate inconclusive; all five checks must work for aggregate working.
Timeout, transport failure or refusal alone does not prove the service stopped.

The complete supplied payload, including additional diagnostics, is retained.
The summary assesses only the named fields above; it does not interpret
unknown future fields. Compaction deferral and projection quarantine remain
core concerns, not optional app failures.

## Optional capabilities and harness presence

`optional` has fixed keys: `app`, `local_edge`, `pty`, `native_supervision`.
Omitted observations default to `{ availability: "not_checked", evidence: null }`.
Available/unavailable observations include source, observation time, scope
(machine or selected instance), and detail. Availability describes the
optional capability under the supplied observation, not core health or
custody. A failed core journal cannot be reclassified as optional native
supervision. Supply it in core health evidence.

The optional observations never change the core result. Missing an app,
PTY or local edge does not impair a healthy core. Having all of them does not
repair unhealthy or unknown core evidence.

`CoreHarnessPresence` names a harness, its observed executable path or null,
source and time. A supplied path is **found**, not authenticated or ready.
A checked lookup with no path is missing; no lookup is not checked. Both
`authentication` and `readiness` remain `not_checked`. The report re-projects
these fields rather than accepting an incoming ready label.

Legacy harness-catalog policy stays unchanged. Its ready/configured states can
include environment/file evidence and active checks; they must not be relabeled
as active sign-in proof under a PATH-only policy. A caller can feed the
catalog's observed binaryPath and its observation source/time to
`describeCoreHarnessPresence`, without importing or running the catalog here.

## Core setup completion

`CoreSetupCompletion` has schema `scout.core-setup-completion/v1`, scope
`core`, outcome, headline, nextStep, required-core failures and the report.
The completion function re-derives checks from retained observations instead
of trusting an edited summary.

- Any required core setup failure or impaired core gives `failed`.
- Working core gives `complete`, even without an app or harness.
- Starting, missing or inconclusive core evidence gives `pending`.

Completion means **core only**. The headline explicitly says coding-agent
sign-in has not been checked. Guidance is terminal-only: doctor, runtimes or
whoami. It does not search the app, read environment/TTY/platform state or offer
a GUI. Required core failures must not contain optional app installation
offers. The API does not invent a foreground handoff or alter service custody.

## CLI adoption and JSON compatibility

This PR changes no CLI file and no existing setup JSON or
`scout.doctor.v1` NDJSON event. It is not a drop-in v1 report replacement.

C can next split setup/doctor away from private local-edge/PTY imports:
- Read the selected core's existing `/health` once, retaining target, status,
  failure/refusal and time. Feed that evidence to `buildCoreServiceReport`.
- Leave optional capabilities not checked in core-only operation, or pass an
  already-held observation. Do not load app/native inspectors to fill defaults.
- Project passive catalog binary paths with `describeCoreHarnessPresence`,
  without copying catalog or core-health logic.
- Feed the report plus required core setup failures to
  `assessCoreSetupCompletion`. Do not call legacy `assessSetupCompletion` or
  `hasUsableScoutApp` in the core-only presentation path.

For Fable's wire review, the named replacement proposal is
**`scout.doctor.core.v1` NDJSON**, with `start` (target) and `complete`
(report) phases over `scout.core-report/v1`. C must introduce it explicitly
rather than silently putting this DTO in `scout.doctor.v1`. That CLI stream
is proposed, not implemented by this runtime PR; the legacy stream remains
unchanged. Core setup's new completion schema is likewise explicit, not an
implicit promise to preserve product-only JSON fields.

The existing onboarding start/custody path still waits for gate 09. A pure
completion/report API does not make core-only setup service acquisition pass
that gate. Credential/acquisition separation is the later dist-access PR.
Stop, uninstall, native update and repair behavior remain unchanged.

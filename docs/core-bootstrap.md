# Core-only bootstrap: runtime catalog slice

`scout runtimes` selects its handler before the legacy ask, app-readiness and
service-maintenance graph. Both the Bun entry and the Node headless entry use
this path. It needs public CLI/runtime/protocol source or the corresponding
bundles, not a desktop or web source checkout.

This is the runtime-catalog slice of the bootstrap split. It does not complete
the setup, doctor, native-update, stop or uninstall cutover. In particular, the
legacy setup/doctor paths still require their core/optional-readiness split.
Do not use this change as evidence that the complete package is app-independent.

## Passive harness readiness

The command uses the runtime's existing catalog model with `localOnly` and an
explicit PATH resolver. It checks executable and declared env/file presence.
It does not search app bundles, execute a shell, probe a version, run a login or
provider status command, resolve a keychain value, or initialize onboarding.
A harness whose readiness needs a skipped healthcheck remains unverified; a
missing optional app does not make the core unhealthy.

This changes readiness observation from the previous active catalog scan.
Binary version and app-bundle alternate information are no longer collected by
this command. Make a harness executable available on PATH before expecting it
in this passive readiness view. Catalog definitions and supported model/effort
choices still come from the runtime/protocol model, not a new CLI-owned catalog.

## Broker and app availability

The command makes passive broker reads for the runtime catalog, capability
snapshot and health. It starts, restarts, installs or repairs no service.
An unavailable live catalog leaves the bundled choices available, with explicit
read-failure metadata. Those choices are not evidence that a runtime is healthy.

JSON retains the existing Bun catalog/report fields and adds:

- `readinessPolicy: "path_and_env_file_evidence_only"`;
- `appReadiness` with unavailable/not inspected and `requiredForCore: false`;
- `brokerReads` with catalog/capability availability and refused HTTP status;
- `coreHealth` with working/impaired/inconclusive state and the preserved broker
  health observation, or explicit unavailability.

Human output adds core-health and optional-app availability lines. A real
journal-write failure stays impaired even if broker liveness is OK. Degraded or
failed projection/startup stays impaired; restoring/warming is inconclusive.
An unreachable broker is not a confirmed healthy broker or an empty success.

The Node headless command now uses the same report/rendering as Bun. Its old
`onboarding` report field and implicit onboarding timestamp update are removed
for this command. Node also gains the same `runtimes --help` behavior as Bun.
Setup and doctor retain their existing Node implementation; no service custody
or repair policy is silently changed by this entry split.

## Remaining bootstrap contracts

Setup still needs a runtime-owned core bootstrap/custody operation that cannot
implicitly acquire private app roles. The completion model must separate core
next steps from optional private app discovery and acquisition guidance. Doctor
needs a reviewed core service/readiness report that can represent unavailable
optional app/edge/PTY facilities without fabricating service ownership or
classifying their absence as core impairment.

Those are not implemented by copying runtime lifecycle or credential logic
into the CLI. Native update, stop and uninstall also wait for the owned-role
custody contract. Until those contracts and the package/source-boundary work
land, the complete core-only fresh-install acceptance remains open.

# Asynchronous harness-catalog commands

`loadHarnessCatalogSnapshot` awaits binary discovery, installation verification
and readiness checks. Its returned snapshot has the same report fields as the
synchronous `evaluateHarnessReadiness` API. Active command failures do not become
successful local-presence checks.

Use `evaluateHarnessReadinessAsync` for one entry. Use
`HarnessCatalogAsyncLoadOptions` to inject Promise-or-value `whichBinary` and
`runCommand` callbacks. Their optional second argument contains the operation's
`signal`. Existing synchronous callbacks and `HarnessCatalogLoadOptions` remain
accepted by the snapshot loader. The synchronous evaluator remains synchronous;
a supplied synchronous callback can still block either evaluator.

Both command paths share readiness configuration and report projection. The
async operation captures its supplied entry and environment before yielding.
The snapshot captures its command environment before reading overrides. Ordinary
lookup/verify/health commands retain their inherited process environment; the
supplied `env` controls requirements and Codex inventory, as before.

`resolveCodexExecutableInventoryAsync` returns the full inventory, including all
candidate metadata and the selected candidate. The catalog projects selection
flags from that inventory. An explicit executable
override wins selection but does not skip inventory probes. The existing
path-only async selector has a different purpose and does not supply this data.
The inventory retains its three-second version deadline. Lookup, verification
and health commands receive no new deadline, retry or watchdog.

`localOnly: true` starts no default child commands and skips verification and
health checks. It retains local credential-presence evaluation. It is not a
pure presence-only core report: a core-report collector must supply presence
observations separately and keep authentication and readiness `not_checked`.

An aborted operation rejects rather than reporting a missing or ready harness.
Abort requests termination of the owned direct child and observes its close;
it does not certify descendant exit or descriptor absence. A shell descendant
that retains a pipe can delay close. This API makes no subtree-custody claim.

This change does not add a catalog cache, single flight, service stop method or
broker shutdown hook. Independent loads remain independent. The existing
capability-matrix cache still controls daemon refresh frequency. Single flight
and service cancellation require a separate reviewed change, including the
start-time-input force contract and the abandoned-flight join-age escape.

The synchronous catalog evaluator and Codex inventory remain callable. Their
sync-execution allowances must remain until those APIs are separately migrated
or removed. Removing synchronous commands from the async loader retires no
existing synchronous file/symbol pair.

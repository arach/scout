# Mesh bridge fallback retirement: verification ledger

Date: 2026-10-20. Branch: `lane/e1-bridge-flip`.
Base: `integration/m5` at `cb7bed278024788eb89b93d2ac5d37cb4776749b`.
Target: draft PR into `core-split`. The completion/help branch is unchanged.

## Decisions

1. Keep the trusted installed extension and explicit `OPENSCOUT_MESH_BRIDGE_BIN`.
   Extension selection still wins, including refusal/removal fences. Remove all
   inferred CLI candidates, even in dev mode. Development source can run only
   when its absolute CLI filename is explicitly assigned to BIN. BIN is a Bun
   CLI file with the `mesh bridge --config` contract, not the portable extension
   executable's `bridge --config` contract.
2. Do not implicitly install executable code. Refuse an enabled bridge loudly
   with a persisted reason/fix and backoff warning; never launch a checkout
   copy. Stage the extension (or durable BIN) before adopting this runtime.
   Installation changes the selected digest and lifts absence refusal. Neither
   installation nor preflight changes bridge enablement or starts a bridge.
3. `openscout-runtime mesh-bridge-preflight` is the read-only per-machine,
   per-instance gate: JSON, exit 0/78, explicit enabled-without-extension report
   and fix. Use the candidate runtime and scout-base's service environment.
   Invalid configuration fails closed; a legacy owner does not exempt an enabled
   machine from the installation requirement.

The consuming cutover checklist must include the ordering in
[`packages/runtime/MESH-BRIDGE-CUTOVER.md`](../../packages/runtime/MESH-BRIDGE-CUTOVER.md).
**Keep the PR draft until that checklist exists.** This ledger is not evidence
that the fleet has the extension installed or that the consuming checklist has
been adopted. No live service, relay or enabled configuration was changed.

## Checks

| Check | Bun 1.3.14 (`0d9b296a`) | Bun 1.3.13 (`bf2e2cec`) |
| --- | --- | --- |
| `bun run --cwd packages/runtime check` | PASS | PASS |
| Affected suites below | 85 pass, 0 fail; 365 assertions, 8 files | 85 pass, 0 fail; 365 assertions, 8 files |

Exact suite command (run once with each Bun):

```bash
bun test \
  packages/runtime/src/mesh-bridge-supervisor.test.ts \
  packages/runtime/src/mesh-bridge-reconcile.test.ts \
  packages/runtime/src/mesh-bridge-extension.test.ts \
  packages/runtime/src/mesh-bridge-preflight.test.ts \
  packages/runtime/src/mesh-bridge-management.test.ts \
  packages/runtime/src/room-listening-supervisor.test.ts \
  apps/desktop/src/cli/extensions.test.ts \
  apps/desktop/src/cli/extension-install.test.ts
```

For 1.3.13, prepend
`PATH="$HOME/.scout/work/tools/bun-1.3.13:$PATH"` to both commands. This also
selects 1.3.13 for nested Bun build/install fixtures, not just the test runner.

Additional checks:

- `bun run sync-exec:fence`: PASS, 147 allowlisted symbol/file pairs. Added only
  the isolated preflight test's subprocess permission. An initial run correctly
  rejected that unlisted test; the narrow test allowlist entry fixes it.
- `bun run --cwd packages/runtime build`: PASS on Bun 1.3.14.
- Node v22.22.2 built-dist preflight smoke: PASS; isolated no-config exit 0,
  enabled/absent exit 78, no credential output or service writes.
- `git diff --check`: PASS.

Coverage includes enabled absence under the actual base-daemon reconciler with
public-checkout runtime discovery; zero implicit candidate probes even with
all candidate paths treated as present; explicit BIN and removal fencing;
absence stopping the old child; installation lifting refusal; disabled/no-config
remaining idle; digest/config rotation and cooldown; ordered process fencing;
preflight JSON/exit status/help/flag handling, invalid config, legacy owner,
credential redaction and no selected-command execution; existing artifact
build/install and extension management suites.

Local raw logs are retained under `reviews/e1-bridge-flip/` (ignored, not
published): `runtime-check-1.3.14.log`, `runtime-check-1.3.13.log`,
`tests-1.3.14.log`, `tests-1.3.13.log`, `sync-exec-fence.log`,
`runtime-build.log`, and `node-smoke.log`.

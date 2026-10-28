# scoutd health sweep

scoutd checks host health and publishes active conditions for local clients.
It restarts only its retained base child. It does not repoint a service, restart
pairing, write app service configuration, or signal a pid found on disk.

## Conditions and actions

The regular sweep runs every 30 seconds, starting at supervisor startup.

| Condition | Grace | Action |
| --- | --- | --- |
| Startup projection degraded by SQLITE_FULL, ENOSPC, or equivalent text | 120 seconds | Wait for both 2 GiB and 5% free space, then restart the owned base child once. |
| Other startup projection error | 120 seconds | At most three owned-base restarts; subsequent retries wait 120 seconds, then 240 seconds. |
| Disk below 2 GiB or 5% free | 60 seconds | Report low space and Scout's top three observed consumers. |
| Disk below 1 GiB or 2% free | 60 seconds | Mark the same disk condition critical and refresh its consumer inventory. |
| Web expected but not running | 90 seconds | Report the cause. Never start or restart web from scoutd. |
| Pairing intent running without a relay listener | 90 seconds | Report the cause. Leave pairing claim retry to the runtime. |
| Version skew | None; checked every 10 minutes | Report the service, CLI, and app versions and the repair action. |
| Unresolved Scout-owned stale files | None; checked every 10 minutes | Report preserved files that require operator inspection. |

A mutation-ready health response removes a projection condition. Five minutes
of continuously observed readiness replenishes its restart budget. A missing
or invalid health response does not clear an existing projection incident.

### Web expectation

Web is expected when a Scout app bundle is installed or runtime child-service
health reports web intent. Bundle discovery checks the service's recorded
`OPENSCOUT_APP_BUNDLE_PATH`, app ancestors of the service's installed paths,
and `/Applications/Scout.app`.

Runtime health exposes explicit intent as `services.web.expected`. A core-only
base does not request web startup without an entry. A direct web start request
sets intent even if startup fails.

If an expected web service has no entry, the condition says:

- Cause: `no web entry: legacy-app-services.json is missing`
- Action: `open Scout.app once`

scoutd does not write `legacy-app-services.json`. A headless host with neither
an installed app nor runtime web intent has no web condition. An unknown health
probe does not clear an existing runtime-intent-only web condition.

### Version skew

The slow sweep reads the package directory in the service plist, resolves the
first executable `scout` on PATH to its package, and reads the app's
`CFBundleShortVersionString`. It does not execute the CLI on PATH.

A service/CLI directory mismatch is actionable even when versions match. The
action names this one-time command, run from the new package:

```sh
OPENSCOUT_ALLOW_SHARED_SERVICE_REPOINT=1 scoutd install
```

The sweep only reports this command. It never runs it.

## Notifications and state

`scoutd-health.json` lives beside `scoutd-state.json`. Native `status --json`
exposes the same object as `healthSweep`. Each active condition has:

- `condition`, `cause`, `action`, and `since`;
- `escalated`, `notifiedAt`, and `notifyAfter`.

The object also has `checkedAt` and restart-budget checkpoints. Menu clients
must treat old `checkedAt` values as stale evidence, not as recovery.

After a condition's grace, scoutd persists `notifiedAt` before dispatch. A
supervisor restart therefore does not resend the same incident. Dispatch uses
the service package's `scout notify` implementation, which shares the
`sendScoutMessage` operator-signal path with MCP `notify_operator`. The command
uses the supervised instance, not the ambient client instance. If the runtime
cannot accept the notification, macOS receives a local notification instead.

An explicit delivery failure clears the reservation and schedules a retry in
five minutes. Clearing a condition sends no notification. Notification display
and reading remain unconfirmed. The durable reservation gives at-most-once
crash behavior: a crash between reservation and dispatch can lose a notice,
rather than duplicate it after restart.

The supervisor keeps a 64-KiB Scout-owned temporary reserve for ENOSPC/EDQUOT
state publication. It releases only a verified reserve and retries publication
once. It replenishes the reserve after disk recovery. This does not authorize
removing any user data.

## Disk inventory and cleanup

Disk samples use one `statvfs` call. Only transitions into warn or critical run
an inventory. The inventory uses seven fixed Scout-owned roots, at most 512
entries per root, depth six, and a 20-ms budget per root. It skips symlinks and
marks incomplete results as bounded estimates. It reports the largest three
observed allocations. These are estimates, not a complete filesystem census.

The slow sweep can remove only these pid/lock files:

- pairing `supervisor.pid`;
- pairing `runtime.pid`;
- relay `on-air.lock`.

A file must be owned by the current user, regular, singly linked, and written
before this boot. Its recorded pid must be dead or demonstrably not Scout.
Unknown process identity preserves the file. A legacy lock without a pid is
preserved and reported. Live Scout holders are never signalled.

Journal orphan cleanup accepts only
`broker-journal.jsonl.<pid>.<timestamp>.tmp` directly inside the control-plane
directory. Both its timestamp and modification time must be older than ten
minutes. Its pid must be dead. A bounded `lsof` probe must prove there is no
holder. Errors, timeouts, symlinks, hardlinks, and changed files are preserved.
The scan examines at most 4096 directory entries and 20 orphan candidates.

The regular sweep rotates fixed Scout-owned child log names. A bounded tail is
retained in `.1`, then the active append inode is truncated. Symlinks and
multiply linked files are not truncated. Rotation occurs before notification
state writes so that reclaimable log space can support diagnosis. If ENOSPC or
EDQUOT prevents a snapshot, scoutd can discard the owned active log to reclaim
space. Other write errors do not authorize that emergency truncation.

## Verification

`SupervisionTestHooks` supplies health, disk, relay, web, and slow observations.
It intercepts restart and notification actions. Loop tests cover detection,
grace, bounded action, clear, notification retry, persisted deduplication, and
slow-cadence scheduling. Filesystem tests cover cleanup and rotation guards.

Run the foreground recovery smoke test after building the checkout binary:

```sh
bun run scoutd:build
bun scripts/scoutd-health-recovery-smoke.ts
```

The script derives a new `dev-health-smoke-<pid>` instance. It injects a
file-controlled projection-open error into a scratch source copy, clears the
fault, verifies a new supervised base pid, waits for `mutationsAdmitted:true`,
and verifies that the projection condition disappears. It stops only its owned
foreground supervisor. It never installs, stops, restarts, or repoints the
shared service. The script prints its state and log locations.

The smoke test disables operator delivery for its dev instance through
`OPENSCOUT_HEALTH_SWEEP_TEST_NO_NOTIFY=1`. That switch is ignored for prod.
Notification routing and actions are covered by the hook tests rather than
sending test notifications to the operator.

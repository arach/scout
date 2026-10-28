# scoutd

Native first slice for SCO-062.

This binary is the native daemon for the existing Bun-backed Scout base service. The supervisor path stays small and easy to reason about; the probe/repo child
uses serde for the local socket protocol.

```bash
cargo run --manifest-path crates/scoutd/Cargo.toml -- status --json
cargo run --manifest-path crates/scoutd/Cargo.toml -- install --json
cargo run --manifest-path crates/scoutd/Cargo.toml -- doctor --json
cargo run --manifest-path crates/scoutd/Cargo.toml -- --version
cargo run --manifest-path crates/scoutd/Cargo.toml -- start --json
cargo run --manifest-path crates/scoutd/Cargo.toml -- stop --json
cargo run --manifest-path crates/scoutd/Cargo.toml -- uninstall --json
cargo run --manifest-path crates/scoutd/Cargo.toml -- supervise
```

The TypeScript service manager shells out to `scoutd` for local service control.

`supervise` is the long-running daemon mode intended for launchd. It starts the
existing Bun base service as a child, restarts it with bounded backoff, handles
shutdown by terminating the child, and writes `scoutd-state.json` under the
runtime directory for `status` and `doctor`.

`status --json` includes `scoutdVersion` and `scoutdBuild`. Local builds always
report the Cargo package version; packaged builds can set `SCOUTD_GIT_SHA` at
compile time to populate the optional git SHA without making local development
depend on git metadata.

Before each child spawn, `scoutd` bounds the child `stdout.log` and `stderr.log`
files: if either expected scoutd-owned log is above 512 KiB, it writes a tail
snapshot to `.1` and truncates the active file before opening it for append.

## Probe/repo socket

`scoutd probes serve` listens on `$OPENSCOUT_HOME/run/scoutd-probes.sock` (or
`OPENSCOUT_PROBES_SOCKET`). Probe/repo requests receive one JSON response per
connection. Native read subscriptions keep the same mode-`0600` Unix socket
open and exchange newline-delimited JSON frames. The capabilities response
advertises probe families plus job capabilities: `repo.scan` and `repo.diff`.

The native agent read path uses `openscout.native.read.request/v1`. Rust tails
the broker journal asynchronously and serves a bounded persisted projection;
it never proxies the runtime or web server. Snapshot mode returns one
`openscout.native.read.snapshot/v1` frame. Subscribe mode sends the initial
snapshot plus material updates and `openscout.native.read.event/v1` heartbeats.

Repo jobs use request schemas `openscout.repo.scan/v1` and
`openscout.repo.diff/v1`; the remaining request fields are the same JSON
contract accepted by the one-shot `openscout-repo-service` wrapper. Responses
are wrapped as `openscout.repo.response/v1` with `{ operation, value, error,
daemonVersion }`. Repo jobs are executed per request with no daemon-side TTL or
snapshot cache; the TypeScript repo-watch/repo-diff job/cache layers remain the
freshness owners.

## Health sweep (work in progress)

The supervisor samples runtime startup health and filesystem availability every
30 seconds after a two-minute startup allowance. Projection failures have a
separate two-minute grace period. Disk-related failures wait for at least 2 GiB
and 5% free space before one owned-base restart. Other projection errors receive
at most three restarts with increasing backoff. Five minutes of continuously
observed readiness replenishes the budget; connection failures do not.

`status --json` exposes `healthSweep`, also persisted as `scoutd-health.json`
beside daemon state. Each active condition includes `condition`, `cause`,
`action`, `since`, and `escalated`. Consumers must check `checkedAt` for staleness.
A confirmed mutation-ready health response clears the projection condition.

The sweep also bounds fixed, Scout-owned base child logs in place, including
`broker.stdout.log` and `broker.stderr.log`. Existing append descriptors remain
valid; a bounded tail is retained in `.1`. No recursive home-directory scan or
user-data deletion is performed.

This is not yet the complete host health contract: operator notification,
relay/web intent checks, stale lock diagnostics, version-skew checks, temp
orphan cleanup, and supervisor-loop fault-injection coverage remain pending.

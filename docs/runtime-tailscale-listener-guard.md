# Runtime-targeted Tailscale listener guard

A fresh Tailscale ServeConfig targeting the runtime's own listener removes
ambient local tier **on that listener only**. Requests are evaluated as remote,
including in verify-warn mode. Public discovery remains public; peer routes
still require peer proof; local-only routes refuse the request. The other
listener keeps its existing behavior. First-party clients on the targeted
listener fail closed; this change does not add request signing or new upgrades.

A refusal uses `tailscale_runtime_listener_guarded`. Its detail explains that a
Tailscale Serve or Funnel handler forwards to this runtime listener, and that
removing the handler restores local access after the next successful status
read. It contains no config text, socket path or hostname. Existing proxy-header
refusal and explicit local-admin-proof errors remain separate. WebSocket clients
can observe a closed connection instead of an HTTP denial body under Bun's
HTTP-upgrade compatibility layer; no upgrade is accepted on a guarded listener.

## What matches

The parser examines `TCP[*].TCPForward`, `Web[*].Handlers[*].Proxy`, and the
same mappings inside foreground/service configs. It matches actual loopback
TCP ports (including localhost, IPv6 and mapped loopback aliases), or a
canonical owned Unix socket path. Socket symlinks and parent-directory aliases
are resolved. Remote hosts, other ports, other sockets, arbitrary strings
containing a port, and `AllowFunnel` alone do not match. The receiving server
binds listener identity; client headers cannot select it. A TLS peer-facing
address does not become the loopback listener just because its port is equal.

The walker ignores unrelated and future fields without discarding recognized
forwarding targets. `AcceptAppCaps` arrays and `Redirect` handlers can coexist
with a runtime `Proxy`. It does not recursively treat arbitrary fields named
`Proxy` as targets: only the known positions above confer evidence. A wrong
type on a target field is skipped without coercion or erasing another valid
target; invalid JSON cannot produce evidence. No field names or map keys are
included in diagnostics.

The designed web exposure on **:43120 is not the runtime listener** and does not
activate this guard. Listener matching uses the actual runtime configuration,
not a hard-coded web/runtime port guess. Status fixtures use synthetic values
in [Tailscale's real source-defined JSON shape](../packages/runtime/src/test-helpers/fixtures/tailscale-status/README.md),
not captured operator configuration.

## Re-reading and idle cost

One ServeConfig includes both Serve and Funnel (`AllowFunnel`). The guard reads
it immediately after listeners start, then every **5 seconds**, with at most one
read in flight. Each read has a **1.5-second timeout** and a **2 MiB output cap**.
Requests use the cached result; they never start a process or a status read.
The standard Unix LocalAPI, when present, is read directly without a process.
Other installations use a single `tailscale serve status --json` command.
There is no parallel Funnel command in either the watcher or the inventory.

Before selecting the cadence, eight read-only CLI samples on macOS measured
**26.57 ms mean wall time and 34.81 ms mean child-process CPU per read**.
Twelve reads per minute therefore budget approximately **0.418 CPU seconds per
minute (0.70% of one core)** for that fallback. This is measured CLI CPU, not a
claim about total daemon/system CPU or Linux performance. The Unix LocalAPI
path has no child-process cost; its real daemon CPU was not measured here.
A separate eight-read warm watcher measurement used **1.37 ms mean parent CPU
per read** (about 0.016 CPU seconds per minute). Adding these measured components
estimates **0.434 CPU seconds per minute**, or **0.72% of one core**, excluding
tailscaled CPU. These are burst-sample extrapolations, not a whole-system idle
profile. No configuration, credentials or hostnames were retained with the
measurement.

Inspected Tailscale source at `47743a8b9ad16cf3a49504dc443208c37748072e`:
[`GetServeConfig`](https://github.com/tailscale/tailscale/blob/47743a8b9ad16cf3a49504dc443208c37748072e/client/local/serve.go#L17-L36)
provides a processless LocalAPI GET. The
[IPN notification structure](https://github.com/tailscale/tailscale/blob/47743a8b9ad16cf3a49504dc443208c37748072e/ipn/backend.go#L311)
has no ServeConfig-change field, and the
[ServeConfig setter](https://github.com/tailscale/tailscale/blob/47743a8b9ad16cf3a49504dc443208c37748072e/ipn/ipnlocal/serve.go#L339-L414)
does not broadcast a general config-change notification. A bus watch is not a
reliable replacement for these reads. Both APIs are upstream implementation
details, not a promise of compatibility with future Tailscale versions.

## On, off and exposure window

A successful recognized parse with an own-listener target enables demotion for
that listener. Evidence expires **10 seconds from the start of its read**, not
from late completion. On activation, existing connections on that listener are
closed so accepted HTTP streams or upgrades cannot retain ambient access
indefinitely. Other listeners are not closed. Already accepted work is not
cancelled or rolled back. New connections are gated per request.

The latest failed, unknown or unparseable result clears automatic enforcement
immediately. A recognized empty or web-only result clears it too. A hung read
cannot keep old evidence alive beyond expiry. A missing CLI, unavailable socket,
permission error or flaky daemon is advisory only. Explicit protected mode does
not turn off when this guard clears.

Under an on-time timer and responsive daemon, a newly added handler can expose
local tier until the next read completes: up to approximately **6.5 seconds**
(5-second cadence plus timeout). Event-loop stalls, unavailable probes or unrecognized
target structures can leave exposure undetected longer. This guard deliberately does not
lock out local users on uncertain evidence and is not a complete authentication
boundary. A handler removed in actual config can leave the cached listener
restricted until a successful re-read, failure result or expiry clears it.

## Reporting and explicit protection

The ingress report has a separate `tailscaleRuntimeListenerGuard` object:
`outcome`, `source`, `attemptedAt`, `completedAt`, `ageMs`, `pollIntervalMs`,
`maxAgeMs` and `guardedListeners` (`tcp` / `unix`). Age uses monotonic time.
The report reads this state after its other probes, rather than presenting an
old cached decision as current. Raw targets and socket paths are never reported.

The existing top-level `enforced` and `activation` fields still describe the
explicit cryptographic protected mode and scoped-access boundary. This transient
guard changes neither persistence nor scoped activation. An absent target match
never authorizes scoped access. Valid explicit local administration proof retains
its existing authority; no new credential is provisioned or distributed.

Unobserved TCP relays and marker-stripping HTTP proxies remain possible. The
[HTTP marker refusal](runtime-proxy-refusal.md) is independent defense in depth.
Protected-by-default ingress, first-party signing and authenticated upgrades
remain separate work. Real Linux guest enrollment and policy changes are not
part of this change.

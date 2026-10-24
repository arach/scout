# Slow SQLite diagnostics

The runtime SQLite adapter and core pairing's shared read-only control-plane
connection emit a structured `[scout-db]` warning for synchronous SQLite calls
that take at least 100 ms. Set `OPENSCOUT_SLOW_DB_MS` before starting a process
to change this threshold; `0` disables instrumentation. Invalid values use the
100 ms default. Existing processes require a controlled restart to load changes.

Warnings go to the process's existing stderr/log destination, not into SQLite.
They contain a fixed database role, PID, method, elapsed milliseconds, success or
failure, a truncated SHA-256 fingerprint of the input SQL, and up to four
repository-relative caller locations when available. No SQL text, parameters,
results, exception messages, or database paths are emitted. Query fingerprints
identify exact input SQL: dynamically interpolated SQL can have multiple IDs.
Bundled builds may not retain source caller locations.

Each connection emits at most ten warnings per minute. The next emitted warning
reports how many slow calls were suppressed. Fingerprinting and stack capture
happen only when a warning is emitted; normal calls take two monotonic timestamps.
Diagnostic failures do not replace the database's result or original exception.

Coverage includes `query`/`prepare` compilation and `all`, `get`, `run`, `values`,
plus database `exec`/`run`. It does not measure iterator consumption, complete
transaction callback duration, time before opening a database, or independent
connections constructed outside these two shared entry points. A warning is
produced when a call returns or throws, so it cannot report a call that never
returns. It measures elapsed time, not lock-wait time; use the caller and query
plan on a consistent snapshot to distinguish expensive reads from contention.

This instrumentation changes no WAL, locking, busy timeout, durability, migration,
or retention settings. It identifies slow operations; it does not itself repair them.

## Bounded core pairing reads

Host history ordering accepts both legacy epoch seconds and epoch milliseconds.
Its `CASE` expression must match an expression index; a raw `created_at` index
cannot satisfy that order. The broker installs the host read indexes through the
managed migration and the idempotent repair path. Host projection connections remain read
only. The failed-delivery query selects the ordered partial index explicitly:
otherwise SQLite can choose the status index and sort/join all old failures
before applying the page limit.

The attention poll reads only recent configuration hints, not full broker
counts, successful dispatch history, or delivery-attempt history. It also skips
the unused fleet activity feed, execution-envelope joins, and metadata payloads.
Session-to-agent mapping is skipped when there is no pairing attention to join. The fleet ask query selects its bounded page
before correlated activity/endpoint joins. Active-agent reads use the invocation
state index rather than scanning completed invocation payloads. Query-plan and
mixed-timestamp tests live in `packages/pairing/src/db-queries.test.ts`.

## App polling backoff and admission

The following policy describes the separately supplied app's Observe and
attention routes. Those routes are not shipped by the core. App builds must
verify their own routing, cache and admission behavior.


Observe and operator attention share each unfinished refresh across callers.
The completed-result TTL starts when the refresh finishes: 900 ms for Observe,
two seconds for attention. Observe admits at most four distinct refreshes at
once and keeps at most 32 keys. Neither pending work nor a failure cooldown is
evicted to make room for another key.

Failed reads use exponential cooldowns starting around one second and capped
at thirty seconds, with jitter. During a cooldown or at capacity, the route
returns HTTP 503 with `Retry-After` and a generic error. Successful reads reset
the failure count. Cached data is not presented as a fresh successful response
after failure. These controls apply only to read-only polls. Approval and
dismissal commands keep their canonical mutation path and invalidate the
attention response cache after success.

This bounds duplicate work. The routing acceptance boundary remains journal
append plus in-memory state. The background projection queue yields an event-loop
turn before each batch, preserving ordered projection and the explicit flush
boundary while allowing command continuations and socket I/O. The runtime's
SQLite projection worker keeps derived database work off the broker event loop;
the worker entrypoint must ship beside the broker bundle. Never acknowledge work
that has not reached its canonical durable journal.

## Managed app web recovery

The runtime applies this policy only to an explicitly configured app server.
It contains no implicit source-tree or bundled web fallback.


The broker probes only its own web child with an authenticated health request
every ten seconds. One missed probe records `suspect` without emitting a warning
or restarting anything. Recovery requires at least three consecutive failed
probes spanning twenty seconds. A child that has not yet answered gets sixty
seconds of startup grace. A monitoring gap longer than thirty seconds resets
the consecutive-failure evidence, so sleep or a stalled parent is not counted
as continuous child failure.

Recovery stops the exact owned child, waits up to ten seconds for graceful exit,
then uses SIGKILL if necessary and waits for confirmed exit before replacing it.
Manual restart uses the same stop boundary. Concurrent start/restart requests
share the lifecycle operation. An unowned listener is never adopted or killed,
and broker shutdown cancels monitoring. Automatic health recovery is limited to
two restarts in ten minutes; another persistent failure pauses it until a manual
restart or an observed healthy response. Startup/crash respawn retains its own
existing backoff and crash limit.

This monitor is outside the web event loop, but still runs in the broker. A
blocked broker or system-wide storage stall can delay it; the timing is a policy,
not a wall-clock availability guarantee. The mechanism does not replay operator
requests. A recovered health probe confirms serving availability, not the
completion of an interrupted request or terminal interaction.

## Finding recovery evidence

Broker web status and the cached `services.web` health snapshot expose
`recovery`: state, observation time, last healthy time, consecutive failures,
automatic restart count, and the latest recovery's times and old/new PIDs.
Broker health reads cached evidence and never performs a nested web probe.
`[scout-web-health]` transition records go to the broker log; routine successful
probes and isolated failures do not produce warnings. Counters and the latest
recovery are scoped to the broker process lifetime; the logs and retained
transition records provide evidence across restarts.
Transient `suspect`, startup, and recovery states expose unknown health rather
than a definitive unhealthy result. Persistent unavailable and paused states
remain unhealthy; consumers can inspect the recovery state for detail.

In separately supplied apps, intentional voice-command long polls declare their expected wait to the API
middleware. A successful 25-second poll is retained in the timing buffer with
`expectedWaitMs`, but does not produce a slow-request warning merely for waiting.
Excess delay and failed responses still warn. Client query parameters alone
cannot suppress latency diagnostics.

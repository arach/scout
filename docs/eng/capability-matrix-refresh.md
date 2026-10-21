# Capability matrix refresh ownership

`BrokerCapabilityMatrixService` owns one joinable refresh per service instance.
The service combines harness readiness, the model catalog and MCP discovery.
Independent service instances and direct catalog-loader calls do not share work.

## Cache and force

A normal read returns fresh memory immediately, including while a forced refresh
is running. A normal cache miss joins the pending disk read or refresh. Freshness
uses the existing snapshot timestamp and TTL policy: 60 seconds by default,
including the exact TTL boundary. Negative readiness uses the same cache policy
as positive readiness. TTL zero disables reuse and persistence, but overlapping
refreshes still join.

Force bypasses completed memory and disk caches. Force promotes a pending disk
read to a refresh without waiting for disk. The late disk result cannot satisfy
the promoted operation. Force after a completed disk hit starts a refresh.

A forced read that joins an in-flight refresh observes that refresh's start-time
inputs. A caller that changed overrides or the environment and needs evaluation
after the change must force again after the current flight settles. The service
captures the diagnostic environment, clock and input paths when refresh starts.
Each input file is read once by its existing loader; this is not an atomic
snapshot of concurrently edited files. Existing `options.env` remains the cache
TTL input, not a replacement diagnostic environment. MCP server-specific
environment values override the captured ambient environment. The optional
`env` transport argument makes that ambient capture explicit; callers that omit
it retain the existing process-environment behavior.

Refresh failures reject waiting readers and clear the slot. The next read can
try again. There is no automatic retry, rejected-promise cache or stale-on-error
success. Read/parse failures in the persisted cache remain cache misses. Cache
write failures remain advisory.

## Join-age escape

`CAPABILITY_MATRIX_REFRESH_JOIN_MAX_AGE_MS` is **120,000 milliseconds**. The bound
uses a monotonic clock and starts when diagnostic refresh starts, not when a
disk read starts. A force before the bound joins. A force at or after the bound
reserves a replacement, rejects old waiters with `AbortError`, and aborts the
retired refresh. Ordinary misses do not replace an old refresh by themselves.

Two minutes allows twice the default completed-cache lifetime before a force
replaces slow work. It provides an explicit escape from a stuck shared request
without timing out otherwise valid diagnostic commands. It is not a command
deadline, timer, retry or response-latency guarantee. Nothing happens merely
because time passes. An operator must request force or stop the service.

Only the current generation can publish or clear the refresh slot. Late
fulfillment or rejection from a retired generation cannot replace fresh data or
clear its replacement. Abort requests direct-child cleanup. A retired operation
that ignores cancellation can still be running while the replacement evaluates;
one joinable generation is not proof of one physically living process tree.

## Stop and process limits

`stop(): void` closes admission, clears memory, rejects shared waiters with
`AbortError` and aborts current work. It is idempotent and does not wait for
filesystem operations or diagnostic completion. All later reads refuse,
including reads that could previously have returned memory. Request disconnect
is not a cancellation authority for a refresh shared by other readers.

Broker shutdown calls `stop()` before its first awaited drain. Checks before
commands and between awaited stages prevent a retired generation from starting
later harness commands, model/MCP work or cache publication. Default MCP
transports close on abort, and every subsequent server transport checks the
generation before spawning. Injected dependencies must cooperate with the
signal to stop their own work; their late results remain fenced either way.

Abort acknowledgment and reader rejection are not direct-child exit proof.
Direct-child exit is not descendant absence proof. A test measures a direct
probe exiting while its inherited-pipe descendant is still alive. The fixture
releases and observes that descendant separately. This slice adds no process
group policy, kill escalation or bounded subtree-cleanup claim. Existing MCP
request timeouts and direct-child close behavior are unchanged.

## Persistence ordering

A refresh stages a generation-unique file beside `capability-matrix.json` and
checks its generation before the final rename. Default staged files use mode
`0600`. Renames already admitted by this service serialize before newer commits.
A retired staged write cannot later overwrite a newer commit. Temporary-file
cleanup is best effort, and its rejection is observed.

An already-issued filesystem operation cannot be recalled. Stop does not
certify that operation canceled. A pending rename can still finish after stop;
a newer commit waits behind it so the old rename cannot finish after the newer
commit. This ordering does not bound filesystem latency. It is per service,
not a lock shared by independent services that use the same cache path.

The injectable `writeTextFile` hook now receives the unique staging path.
`renameFile` commits it to the configured cache path, and `removeFile` cleans up
an owned stage. These hooks are test seams; no environment or token enters a
new cache key, log or persisted field.

## Verification

The refresh tests cover force promotion, start-time inputs, negative readiness,
TTL zero, separate instances, failed refresh recovery, replacement at the
join-age boundary, late fulfillment and rejection, staged-write ordering, held
real fake children, MCP cancellation, descendant limits and broker stop order.
Paired parent/candidate probes separately record concurrent evaluation counts
and the result after an old refresh settles late. They are ordering evidence,
not a performance benchmark or a process-tree custody certification.

# Projection worker lifecycle and failure containment

A stalled or retired SQLite worker degrades the derived projection, not the
broker process. The canonical journal remains the source for recovery.

## Generation ownership

The broker accepts messages and failure reports only from its current worker.
A source request can await journal I/O longer than the watchdog deadline.
After that await, the handler must recheck worker identity before sending
either a successful result or an error result. A stale completion must not
post to a retired worker or change a replacement worker's health.

All broker-to-worker posts use one guarded send path. A synchronous post
failure rejects pending projection RPCs, records degraded health and retires
that worker. The message listener also handles rejected async callbacks
through this same generation-scoped failure path. Worker termination handles
both synchronous exceptions and rejected termination promises.

A source handler separates computation errors from transport errors. It
constructs one reply, then makes at most one guarded post. A failed post must
not trigger another post to the same worker from an error-reporting catch.

## Worker-side replies

The entry module has the same boundary on its MessagePort. It sends one
result after an awaited operation, whether computation succeeds or fails.
If posting fails, it stops heartbeats, rejects pending source requests,
closes worker-local projection resources and closes the port. The broker
observes exit or its existing watchdog and marks the projection degraded.
The entry listener handles rejected callbacks explicitly as well.

This change does not solve disk exhaustion. ENOSPC can still make journal
I/O or projection work fail. It does not extend the watchdog on idle
heartbeats, add an unbounded retry queue, suppress caller RPC failures, or
replace the runtime process. The next projection request starts recovery
from the canonical journal using the existing worker startup path.

## Failure ledger

The regression instrument was run against public base `3972b4b4c`, then the
fixed implementation, on Bun 1.3.14 and pinned Bun 1.3.13. The final test
instrument and dependencies were unchanged between those runs.

| Case | Before | Fixed behavior |
| --- | --- | --- |
| Boundary await succeeds after watchdog retirement | Bun child exits with `InvalidStateError: Worker has been terminated`. | Old result is discarded; the already-recovered replacement remains ready. |
| Boundary await rejects after watchdog retirement | Error reply posts to a terminated worker and rejects the async listener. | Old error is discarded without touching the replacement. |
| Boundary succeeds or rejects after `close()` | Late reply can escape as an unhandled rejection. | Both completions are ignored; a new projection instance recovers. |
| Current worker's source-result post throws | Error-reporting catch repeats the failing post. | Exactly one attempted post; pending RPC fails and health degrades. |
| Async message dispatch rejects | `void onMessage` leaves the rejection unhandled. | The listener routes failure into generation-scoped degradation. |
| Outbound RPC post throws | Only that request fails; worker health remains stale. | The worker and all pending RPCs fail together; the next request recovers. |
| Entry's successful-result or error-result post throws | Entry repeats the post from its catch branch. | Both result paths make one attempt, then stop local work. |

**Same-instrument result on each Bun: 0 pass / 9 fail before; 9 pass / 0 fail
after.** The regression cases run in disposable Bun children without an
`unhandledRejection` listener. Normal child exit and empty stderr therefore
verify containment without installing a global handler that hides failures.
The watchdog cases wait for actual worker exit, recover a replacement, then
release the old boundary await. The entry cases substitute only the port
binding in the otherwise unchanged entry module to inject a post failure;
Bun's actual parentPort methods are readonly.

The runtime audit found the other worker-post-after-await pattern in
`sqlite-projection-worker-entry.ts` and fixed both its success and error
replies. Other runtime methods named `postMessage` are broker message APIs,
not worker transports. The web diff viewer's browser Worker is not owned by
the runtime and is outside this crash path.

## Verification

On both Bun versions, these four files pass **87 tests, 0 failures**:

```sh
bun test packages/runtime/src/sqlite-projection-worker.test.ts \
  packages/runtime/src/sqlite-projection-worker-retirement.test.ts \
  packages/runtime/src/sqlite-projection.test.ts \
  packages/runtime/src/broker-durable-store.test.ts
bun run --cwd packages/runtime check
bun run sync-exec:fence
```

Runtime typechecking passes on both versions. The fence permits only the
owned crash-test child runner, with a 15-second kill deadline and awaited
cleanup. Tests use temporary journals and databases and never start a broker
or operate on the installed runtime. No live disk-fill experiment is needed.

Local verification evidence is under `tmp/projection-retirement-before-*`,
`tmp/projection-public-tests-*`, `tmp/projection-public-check-*` and
`tmp/projection-public-fence.log` in the lane checkout. The before/after
instrument restores the fixed source in a `finally` block after substituting
only the two production files with their public-base versions.

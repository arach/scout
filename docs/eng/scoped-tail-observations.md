# Scoped Tail observations

Task Tail follows a source-owned endpoint identified by `{ nodeId, endpointId }`.
The source runtime binds that endpoint to a verified native harness session. A
runtime session ID, task title, or message body is not a substitute for that
binding. A pending tmux endpoint returns an actionable error until its native
session is verified; it never guesses from the pane name.

The local operator uses `/v1/tail/observations/subscribe`, `read`, and
`unsubscribe`. For a remote source, its local runtime forwards those operations
one hop to `/v1/mesh/tail/observations/*`. The source accepts only an authenticated
control peer and owns the observation lease. Peers cannot forward to a third
host or read another peer's lease. A source runtime without these routes reports
an upgrade error instead of silently falling back to the aggregate Tail feed.

`subscribe` returns an opaque observation ID, the exact source binding, recent
bounded events, a cursor, and source state. `read` renews the lease and waits up
to 12 seconds for a change. The cursor is an epoch and sequence; `reset` and
`gap` tell a reconnecting client when earlier events fell out of the 120-event
buffer. One source watcher serves concurrent observers of the same endpoint.
An explicit `unsubscribe` releases the lease. An abandoned lease expires after
60 seconds, releasing its watcher and buffer when it was the last consumer.

Only selected session events cross this API. The source strips raw payloads,
redacts secrets, and bounds summaries. It also reports permission
waits and finished/unavailable source state, so a quiet transcript does not
look like a live but empty session. The observation API does not answer a
permission prompt; the operator uses the source host's existing interaction
surface. The aggregate Tail feed remains a separate explicit view.

Implementation: `packages/runtime/src/tail-observations.ts` owns leases and
replay; `tail-observation-binding.ts` verifies endpoint identity;
`tail-observations-http.ts` owns local and mesh operations.

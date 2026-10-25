# Remote tail iterator, slice one

Import `subscribeRemoteTail`, `RemoteTailError`, and the types
`RemoteTailOptions`, `RemoteTailItem`, `RemoteTailErrorReason` from
`@openscout/runtime/remote-tail`. This Bun/Node client consumes the existing
`tail.events` procedure. No existing consumer migrates. No watcher, credential
store, broker route or recent-read poll is created.

The explicit origin accepts only `127.0.0.1` or `[::1]`, with an optional port.
HTTP/WS and HTTPS/WSS select `/trpc`; no DNS names, credentials, query, fragment,
base path, redirect or alternative broker is accepted. Set
`ingress: { kind: "trusted-loopback" }`, an AbortSignal, and finite positive
`reconnect.maxAttempts` and `maxElapsedMs`. There is no mesh-peer or signer API.
Sources and the optional initial `since` retain the existing procedure's meaning.

The lazy iterable has one owner. First `next()` starts a connection. Early
return or abort cancels work, closes the socket and settles reads. A second
iterator refuses without changing the first. Connection notices are coalesced;
every generation emits `continuity: unverified` before any of its events.
Events preserve tracked IDs. IDs must agree at `result.id`, `result.data.id`
and `event.id`; the outer RPC ID is not an event cursor.

The resume cursor advances only on yield, not receipt. A disconnect drains
queued events before a fresh subscription sends that cursor as `input.since`.
It never substitutes tRPC's `lastEventId`. Drain time counts against the outage
budget; only `started` ends the episode, not a socket open. Retry delay starts
at zero, then 2/4/8/16 seconds, capped at 30 seconds. An abort cancels backoff.

The broker replays at most 500 events. Unknown/expired cursors silently replay
the retained window; replay/live attachment is not atomic. The adapter cannot
certify continuity or detect all gaps. It adds no timestamp-inferred gap or
unbounded deduplication. Recovery and any phone acknowledgement remain private.

Client refusal limits are 256 queued events, 1 MiB serialized queued event
bytes, 30 seconds oldest queued age, and 1 MiB + 64 KiB per decoded message.
No silent drop-oldest policy is used. These do not bound total heap or Bun's
internal native receive allocations. Node ws also enforces maxPayload before
JavaScript receives the message.

## Terminal refusals

`RemoteTailError` has readonly `reason`, `lastDeliveredId: string | null`,
`resyncRequired: boolean`, `generation: number` and `name: "RemoteTailError"`.
Null means no event has been yielded, not an unknown server cursor. Generation
0 identifies preflight refusal. A failure snapshots the last delivered ID.

| Reason | resyncRequired | Meaning |
| --- | --- | --- |
| consumer_lag | true | Count, byte, age or message-size bound exceeded. |
| server_error | true | Procedure error or unexpected subscription stop. |
| retry_exhausted | true | Attempt or elapsed outage budget exhausted. |
| protocol_error | true | Invalid text protocol or mismatched tracked IDs. |
| auth_denied | false | Observable HTTP 401/403 or structured tRPC authorization denial. |
| handshake_error | false | Reserved legacy reason; the current client does not emit it. |
| invalid_options | false | Invalid policy/origin or repeated iterator ownership. |
| unsupported_ingress | false | Ingress other than trusted-loopback requested. |

Messages are static; server error messages are never parsed as gap/cursor
metadata. In particular, the broker's StreamResyncRequired arrives as a generic
tRPC internal error, not a stable `resync_required` wire field.

Bun 1.4 and Node expose failed-upgrade HTTP status. Both engines classify
401/403 as terminal auth_denied and retry 503 within the existing outage budget.
Other HTTP statuses are terminal server_error. The client never follows a
redirect or sends a second diagnostic TCP connection. Both engines resume
post-open losses and recognize structured tRPC authorization errors.
This is not an authentication fallback. Mesh-peer ingress is a separate slice
and requires review before any credential API is added.

## Verify on both engines

From the checkout root, with dependencies installed:

```sh
bun test --isolate packages/runtime/src/remote-tail.test.ts
bun packages/runtime/scripts/build-remote-tail-node-tests.mjs
node --test packages/runtime/node_modules/.cache/remote-tail-tests/remote-tail.test.mjs
```

The builder changes only the runner import from bun:test to node:test. The
same assertions and installed real tRPC server adapter run on both engines.
Fixtures inject in-memory events; they never start transcript watchers.

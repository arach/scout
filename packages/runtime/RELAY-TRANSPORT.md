# Opaque room relay transport

The runtime owns the opaque relay transport. The core host-pairing package
composes phone pairing and encrypted RPC above it. This contract does not
authorize a new peer or activate a pairing opportunity.

## Ownership and API

`@openscout/runtime/relay-transport` owns the Bun WebSocket room server.
`startRelay(port, options?)` returns `{ stop(): void }`. Each invocation owns
its own rooms, connection IDs, routing index and timers. The optional `hostname`
selects the bind address; its default is `0.0.0.0` for compatibility with both
existing wrappers. Optional `tls: { cert, key }` values are certificate and key
file paths read by Bun. Node execution is not supported.

The module has no value imports. It does not depend on a web server, pairing
implementation, local configuration, native service, broker or tail watcher.

`RelayTransportOptions.httpHandler` is an optional, trusted build-time HTTP
composition callback:

```ts
type RelayHttpHandler = (
  request: Request,
  context: { clientAddress: string | null },
) => Response | Promise<Response> | undefined;
```

The relay invokes the callback before its HTTP and upgrade routes. The address
comes from Bun's accepted connection, not client forwarding headers. A
synchronous `undefined` delegates to the existing routes. A `Response` or
`Promise<Response>` completes the request. An asynchronous callback must not
resolve to `undefined`. There is no implicit handler, origin or outbound HTTP
request. A caller controls its callback and must constrain any proxy it adds.
This hook is not a remote extension loader or a sandbox.

## Wire compatibility

The extraction retains the original room algorithm and Bun server defaults:

- An upgrade requires a nonempty `room` query value and `role=bridge` or
  `role=client`. Invalid input returns HTTP 400. A failed upgrade returns 500.
- Each room has one bridge and any number of clients. Each client connection
  receives a fresh UUID. A replacement bridge closes the previous bridge with
  code 4001 and reason `Replaced by new bridge`.
- A client frame becomes a text JSON envelope to its room's bridge:
  `{ phase: "relay", event: "message", clientId, payload }`. Client binary
  frames retain the original UTF-8 decoding. This is not an arbitrary binary
  forwarding API.
- A bridge sends text JSON envelopes addressed to a client ID in its room.
  `event: "message"` forwards a nonempty string payload. `event: "close"`
  closes that client with the supplied code and reason. Invalid JSON, invalid
  phase/event/ID, bridge binary frames and empty message payloads are ignored.
- A client close sends `{ phase: "relay", event: "close", clientId }` to the
  connected bridge. The move adds no buffering, retry, deduplication,
  cross-room delivery or new scheduling boundary to the message callbacks.
- A bridge absence starts the existing 30,000 ms grace timer. A connection
  joining the room cancels a pending cleanup timer. If the bridge is still
  absent at expiry, clients close with code 4004 and reason `Bridge absent`;
  the room and its indexed keys are removed.
- An empty room without a bridge retains the existing 60,000 ms idle cleanup.
  The internal missing-client-ID guard retains code 4000 and reason
  `Missing client id`.
- `stop()` clears current timers and maps, requests code 1001 with reason
  `Relay shutting down` on every current socket, then calls `server.stop()`.
  In direct probes of both the original and extracted implementations, Bun
  1.3.13 and 1.3.14 expose **1000** with that reason to the WebSocket client.
  This extraction retains that shutdown sequence and observed wire behavior.
- The move adds no room, client, payload, queue or rate limit. It leaves Bun
  defaults in force. It does not claim unlimited capacity or guaranteed
  delivery. Existing cleanup and replacement callback behavior is unchanged.

`GET /healthz` returns `{ ok: true, ts, bridgePublicKey, bridgeConnected,
roomId }`. The optional `bridgePublicKey` query value is trimmed; `roomId` is
null unless the indexed bridge is connected.

`POST /resolve` accepts JSON `{ bridgePublicKey }`. A live mapping returns
`{ room }`. Missing or invalid keys return 400; an unknown key or disconnected
bridge returns 404; invalid JSON returns 400. Bridge key labels enter the
routing index only after a successful upgrade. Failed upgrades neither retain
fresh key labels nor repoint existing labels.

Room names, key labels and client IDs are routing metadata, not credentials.
The relay must carry opaque application frames. Callers supply end-to-end
encryption and authenticate endpoints outside this module. The relay neither
implements nor verifies encryption. It stores no pairing private keys, trusted
identities, approvals or custody state. TLS does not substitute for endpoint
authentication. This is not a hardened untrusted multi-tenant relay.

Room occupation and key-index repointing are unauthenticated by design. Any
reachable peer can take a room's bridge slot or repoint `/resolve` for a key
label it knows. Callers' authenticated end-to-end encryption protects payload
confidentiality; the relay does not protect availability or routing direction.
Run the relay where only trusted peers can reach it, such as a restricted
tailnet, a trusted-peer LAN, or TLS behind a network ACL. Treat `/resolve`
answers as routing hints that the caller must verify end to end.

## Core phone HTTP composition

`packages/pairing/src/core/pairing/runtime/relay/relay.ts` wraps the public
transport. Its adjacent `pair-http-proxy.ts` contains the phone-specific policy.
There is one wrapper and one proxy implementation, not desktop and web copies.
No private extension or temporary app-source inventory is required.

The wrapper retains `RelayOptions.pairHttpOrigin`:

- Only `GET /pair` uses the proxy. An undefined origin resolves the configured
  legacy optional-app web port per request. Null, empty or whitespace-only
  origins return 503. Core LAN discovery advertises the bridge's own `/pair`
  listener; a caller using relay HTTP forwarding must supply that origin.
- The proxy preserves the query, uses GET, disables automatic redirects and
  retains the 3,000 ms deadline. Fetch failures return 502.
- Requests forward only the named pairing/client headers. The proxy sets
  `x-scout-pair-relay: 1` and derives forwarding IP headers from the accepted
  connection. It drops client forwarding headers, cookies and authorization.
- Responses retain the upstream status/body and nonempty `location`,
  `cache-control` and `content-type` headers.

The public transport alone does not install `/pair`. With no HTTP callback,
`GET /pair` without room/role follows its ordinary 400 path. Core pairing mounts
its existing admission routes in the encrypted bridge listener. It serves no
browser client. Operator `/api/*` routes require same-Mac identity and the
runtime bearer token; a remote knock is not consent.

The former two-copy comparison at `09b2d2a8` is historical extraction evidence.
Current wrapper/proxy tests live beside this core implementation.

## Tail is a separate contract

**No:** `@openscout/runtime/tail` alone does not replace the pair bridge's
remote `tail-fanout.ts` connection.

The public module exposes local `subscribeTail(handler)` and
`snapshotRecentEvents(limit)`. The subscription starts local discovery and
watchers. It accepts no broker URL, remote credential, resume cursor or source
filter. The snapshot is a local aggregate buffer, not remote resume.

The core `packages/pairing/src/core/pairing/runtime/bridge/tail-fanout.ts` adapter connects to the selected broker's `/trpc`
WebSocket and subscribes to `tail.events`. That broker procedure accepts
`since` and `sources`, replays its bounded recent buffer, and streams tracked
event IDs through a bounded live iterator. The broker's ingress gate authorizes
the upgrade. The core encrypted phone bridge remains responsible for its
phone-side authorization. A local tail callback supplies neither authority.

Any replacement remote adapter must preserve broker selection, transport
reconnect/resume semantics, source filters, tracked IDs and the ingress
credential boundary. Richer recent-read filters are not proof of subscription
filter parity. This extraction does not change tail, launch a second watcher,
or treat the HTTP recent-read endpoint as a subscription.

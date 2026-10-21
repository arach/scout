# Opaque room relay transport

Status: draft extraction from the desktop and web relays. This contract does
not activate a pairing provider or change the installed product. The narrow
package export requires public API review before merge.

## Ownership and API

`@openscout/runtime/relay-transport` owns the Bun WebSocket room server.
`startRelay(port, options?)` returns `{ stop(): void }`. Each invocation owns
its own rooms, connection IDs, routing index and timers. The server binds to
`0.0.0.0`. Optional `tls: { cert, key }` values are certificate and key file
paths read by Bun. Node execution is not supported.

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
routing index before upgrade, as before.

Room names, key labels and client IDs are routing metadata, not credentials.
The relay must carry opaque application frames. Callers supply end-to-end
encryption and authenticate endpoints outside this module. The relay neither
implements nor verifies encryption. It stores no pairing private keys, trusted
identities, approvals or custody state. TLS does not substitute for endpoint
authentication. This is not a hardened untrusted multi-tenant relay.

## Private phone HTTP composition

The desktop and web `relay.ts` files remain compatibility wrappers. Both use
one private `pair-http-proxy.ts` beside the desktop wrapper. The temporary
web-to-desktop source import is private composition, not a dependency of the
public runtime. Moving that policy into a private extension remains separate
work.

The wrappers retain `RelayOptions.pairHttpOrigin` and the existing behavior:

- Only `GET /pair` uses the proxy. An undefined origin resolves the private
  web port **per request**. Null, empty or whitespace-only origins return 503.
- The proxy preserves the query, uses GET, disables automatic redirect
  following and retains the 3,000 ms deadline. Fetch failures return 502.
- Requests forward only `accept`, `user-agent`, `x-scout-client` and
  `x-scout-device-name`. The proxy always sets `x-scout-pair-relay: 1`.
  It derives forwarding IP headers from the accepted connection. It drops
  client forwarding headers, cookies and authorization headers.
- Responses retain the upstream status and body. Only nonempty `location`,
  `cache-control` and `content-type` headers pass through.

The public transport alone does not install `/pair`. With no HTTP callback,
`GET /pair` without room/role follows the ordinary 400 path. The wrappers keep
the existing phone route. This extraction does not remove an installed
pairing capability.

## Resolution of the two copies

The comparison uses desktop and web relays at `09b2d2a8`:

| Original difference | Resolution | Phone-visible effect |
| --- | --- | --- |
| Web expands the `pairHttpOrigin` comment to explain LAN knocks and loopback web. | Keep that explanation in this private-composition contract. | None; comments only. |
| Web adds a comment before `GET /pair`. | Keep the explanation here; the shared private handler selects the same method/path. | None. |
| Desktop extracts request header construction; web inlines it. | Use desktop's `pairProxyHeaders` once in the private helper. The allowlist and authoritative edge headers match. | None. |
| Desktop loops over response header names; web spells out the three assignments. | Use the desktop loop. Names, iteration order and nonempty-value tests match. | None. |
| Blank-line placement differs. | Use desktop formatting in the private helper. | None. |
| Web includes `Buffer<ArrayBufferLike>` in two helper parameter types. | Retain web's widened annotations in the public kernel. | None; runtime branches are unchanged. |

Both existing wrapper test files remain unchanged. They retain their different
coverage. The named private inventory keeps both wrapper paths and adds the
shared proxy path for both existing JS outputs. The public kernel is not a
private exception.

## Tail is a separate contract

**No:** `@openscout/runtime/tail` alone does not replace the pair bridge's
remote `tail-fanout.ts` connection.

The public module exposes local `subscribeTail(handler)` and
`snapshotRecentEvents(limit)`. The subscription starts local discovery and
watchers. It accepts no broker URL, remote credential, resume cursor or source
filter. The snapshot is a local aggregate buffer, not remote resume.

The current private adapter connects to the selected broker's `/trpc`
WebSocket and subscribes to `tail.events`. That broker procedure accepts
`since` and `sources`, replays its bounded recent buffer, and streams tracked
event IDs through a bounded live iterator. The broker's ingress gate authorizes
the upgrade. The private encrypted phone bridge remains responsible for its
phone-side authorization. A local tail callback supplies neither authority.

A future public remote adapter must preserve broker selection, transport
reconnect/resume semantics, source filters, tracked IDs and the ingress
credential boundary. Richer recent-read filters are not proof of subscription
filter parity. This extraction does not change tail, launch a second watcher,
or treat the HTTP recent-read endpoint as a subscription.

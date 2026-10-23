# Relay pairing opportunities

Encrypted relay handshakes prove possession of a Noise private key. They do
not grant trust. Both the web and retained desktop relay clients construct
transports with `trustOnComplete: false`.

## Initial pairing lifecycle

1. The operator selects Show code / Start pairing in the authenticated host UI, or runs
   `scout pair`. That explicit action opens one local pairing opportunity and
   displays its QR. Reading pairing state does not open an opportunity.
2. Trusted runtime composition binds the opportunity to the canonical pairing
   root, a new logical room, a five-minute deadline and the verified owner
   baseline. It shares the one opportunity across the configured relay paths.
   The prior room closes; trusted phones can resolve the current room again.
3. A phone completes Noise in that room. An already-trusted full key reconnects
   without a new trust generation. A new key needs the live opportunity.
4. The canonical pairing owner checks the opportunity's room, lifetime, current
   authority baseline and actual connection lifetime. It checks again immediately
   before publication, under the managed gate when applicable. It publishes the
   full-key grant through the normal CAS, synchronization and recovery path.
5. Successful admission closes the opportunity, including admission of an
   already-trusted key. Timeout, cancellation, any intervening authority change,
   or a failed/uncertain publication also closes it. A failed grant never leaves
   an opportunity reusable. Human pairing waits do not hold the authority gate.

Opportunities use both wall-clock expiry and a process-monotonic deadline.
They are local callable objects, not serialized permission records. Their IDs
identify a QR view for cancellation; an ID cannot grant a peer. A stale view's
cancel request does not cancel a newer view.

A fresh room prevents direct reuse of the old invitation. The public relay
resolve endpoint still routes by bridge key. During a deliberately opened
window, the high-trust pilot accepts a key in the current room; this is not
proof that a particular person scanned the QR.

Controller/daemon startup and restart (including the maintenance Restart button)
are reconnect-only. Only the explicit Show code / Start pairing action opens a window. There is no
automatic QR refresh that extends permission or opens another opportunity.
Reopening the host pairing view explicitly creates a fresh room and baseline.
Merely retaining a room, changing its displayed expiry, reconnecting the relay,
or switching between XX and IK cannot restore trust. A fresh explicit local
pairing action can deliberately pair the same key after revocation.

## Trusted local control

The runtime exposes typed `openPairing` and `cancelPairing` composition methods.
A running controller receives local `pairing/opportunity` JSON-RPC control on
its direct Noise channel. The server intercepts this before the application
router and requires authenticated full-key equality with its own host identity.
A paired phone key, claimed device ID, plaintext client, HTTP header or relayed
RPC cannot open the opportunity. The local request contains only `open` or
`cancel` and an optional cancellation ID, never a principal or a grant.

This is the existing trusted same-user/local-build boundary, not a sandbox
against a hostile process holding the host's private key. Local service
possession is not an operator-decision entitlement. The desktop transport now
delegates to the runtime implementation so its own-key channel can use the
same no-trust-write behavior as the web channel.

A CLI pair view that attaches to a running controller opens a fresh opportunity
through this channel and cancels that view on exit. A CLI session that owns a
new runtime opens once after startup and closes the runtime on exit. A host UI
Stop action stops its controller. Once the opportunity closes, its QR is removed
from the controller snapshot; the relay remains available to trusted peers.

## Unadmitted and revoked peers

An unadmitted secure peer receives no session snapshots, bridge or broker
events, or application RPC responses. The bridge sends the existing per-client
relay close envelope with code `4003`, reason `Untrusted peer`, and tears down
local state even if the relay drops that envelope. Only admitted peers can
replace older connections, using full-key equality rather than a display
prefix. XX/IK, relay room and client ID are routing, not authorization.

A previously paired phone can reconnect over either XX or IK without adding an
authority generation. Advisory lastSeen can change. It does not cancel a live
pairing opportunity or enter the authority baseline.

A revoke stops a later reconnect from regranting itself. **This change does not
invalidate an already-connected session after revocation.** Live-session
invalidation is a separate mechanism. It also does not revoke existing SSH
authorized_keys grants or PTYs, HTTP bearer handoffs/artifact URLs, data already
received, or native input already accepted. Pairing-trust revocation is not
“remove all device access.” Plaintext relay mode is outside this contract.

Account-pairing waits are not implemented in these public relay clients. A host
integration that waits for account approval must keep that wait outside locks
and recheck the same scoped opportunity, revision, cancellation and connection
lifetime before publishing. It must not turn a completed handshake or a late
approval into an unconditional `saveTrustedPeer` call.

Older controllers must be updated before relying on this behavior. The fix
does not constrain an old binary that still grants on handshake completion.

Unmanaged roots keep the [owner's external-writer compatibility limits](./pairing-trust-owner.md).
A detected external projection change cancels an opportunity. Raw writers are
not serialized by unmanaged CAS, and an outside remove-and-restore entirely
between reads cannot be proved. Managed operation and deliberate exclusion of
old writers remain necessary for stronger guarantees.

## Verification

`bun test scripts/relay-pairing.test.ts` runs process-isolated real relay and
Noise exchanges for both relay clients. Application sinks are instrumented to
count dispatch/data leakage. It covers remembered-room revoke/reconnect,
XX/IK, opportunity completion/cancel/timeout/authority change, explicit regrant,
no generation growth on trusted reconnect, local-control rejection for a phone,
fresh rooms, stale cancellation and an authority mutation in another process.
`packages/runtime/src/pairing-security/pairing-opportunity.test.ts` covers owner
baselines, guarded publication and managed-gate use. These are not physical
phone UI or complete credential-revocation tests.

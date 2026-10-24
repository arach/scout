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
   The prior pairing room retires. The indexed reconnect room stays unchanged.
3. A phone completes Noise in that pairing room. An already-trusted full key connects
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

## Two relay rooms

The runtime joins a stable **reconnect room** at startup. The bridge key indexes
only this room for `/resolve` and `/healthz`. It accepts trusted full keys only;
it has no `admitNewPeer` callback. Admission here never closes a pairing window,
and opening a pairing window never disconnects an existing reconnect session.
`mobile.endpoints` reports this room as `relay.reconnectRoom` on the protected
trusted relay transport, including when called from the pairing connection.

Each explicit pairing action joins a fresh **pairing room** on every configured
relay, without the bridge-key query parameter. Only the QR invitation carries
that Show-code room; discovery by bridge key cannot obtain it. Any admission in this room
closes the window, including an already-paired phone scanning the QR. A revoked
phone that physically scans the new QR and pairs is a deliberate regrant.
An automatic revoked-phone retry resolves only the reconnect room and gets
`4003`; it cannot consume the intended phone's window.

### After closure: retire until empty

Closing, replacing or consuming a window retires its pairing connections.
Already-admitted devices retain their encrypted RPC/event connection. A retired
room accepts no new transport, even for a trusted key; pending unauthenticated
handshakes close with `4003`. The bridge leaves when the last admitted device
leaves, and does not reconnect a retired carrier. Runtime shutdown closes all
remaining connections.

This preserves the newly paired phone's current connection while it finishes
its pairing UI and learns reconnect coordinates. Immediate closure could defer
recovery until that UI exits. No physical-phone timing measurement is claimed;
the relay tests assert continued RPC, refusal of new transports, and carrier
closure within one second of the last device leaving.

### Rendezvous and approval

Neither rendezvous builder publishes `mobile_pairing`, even while a window is
open. The general presence builder also filters that kind. Existing phone
decoders require both room and expiry in this entrypoint, so publishing a
roomless entrypoint is not compatible. This change adds no new entrypoint kind.
**Known effect:** the phone's network pairing list is empty for these hosts.
Existing non-pairing mesh presence is unchanged.

## Request-bound approval windows

Approving a named request on the authenticated host is an explicit local pairing
action. It starts the reconnect-only controller if necessary, then opens a
private pairing window for that request. Before asynchronous controller startup,
the host captures the canonical owner's verified authority stamp. The receiving
owner compares that stamp before creating the opportunity. A revoke or other
authority change during startup therefore prevents the old approval from
arming a new window. The stamp comes from trusted host composition, never from
the device's request. It does not press Show code or read an
existing QR. The approved response is the possession channel in place of a QR.

A device can add the optional `x-scout-device-public-key` header to its first
`GET /pair` request. The value is its full 32-byte Noise static public key as
64 hexadecimal characters. The host normalizes hex case and rejects malformed
values or prefixes with HTTP 400. Older phones omit the header unchanged.
The request store keeps this key immutable for that token, including across
server instances. Different keys do not share pending requests. A fresh knock
never retrieves an already-approved token by IP or public key.

For a keyed request, the canonical owner's `openPairingOpportunity` captures the
expected full key. Its admission check rejects another full key **without
consuming or cancelling** the window. This applies to already-trusted keys too;
the relay cannot bypass request authorization through its trusted-key fast path.
A trusted matching key consumes the window without a new authority generation.
With no supplied key, the one-time approved response binds delivery and the
first admitted key consumes the window. Neither an IP address nor a display
label proves a Noise identity.

### Coexisting windows

One Show-code window and up to 32 request windows can coexist. Separate approvals
use separate rooms. Opening, reading or cancelling one request never replaces
the QR or another request window. Show code replaces only the previous QR
window. Admission retires only its own room under the same retire-until-empty
policy. **An actual trust-authority change invalidates every older opportunity**,
including a grant made by another window. Independence does not permit stale
baselines: after such a change an unconsumed request needs a new explicit
approval/request, not an automatic retry. A trusted admission with no generation
change does not invalidate the other windows.

The lifetime is at most five minutes from first opening, using both clocks.
Repeated approval calls for the same live token are idempotent and do not rotate
the room or extend the deadline. Cancellation, consumption or invalidation retains a spent request ID for
the runtime lifetime. Payloads and timers are collected at the fixed deadline,
but a retry cannot reopen that token; the host gets HTTP
409 and must use a new request. Expired request-store rows cannot retrieve a
payload even if the runtime's deadline has not elapsed. A delivered invitation
remains usable until admission, cancellation, authority change or the fixed
window deadline. Fulfillment is not admission.

### Delivery and the host view

Only a poll for that live approved token can read its private window over the
host-own-key local control channel. The route consumes the token through the
existing shared-store `fulfill(..., "approved")` CAS **before** returning the
invitation redirect. Pending, denied, expired, fulfilled or different tokens
get no room from that request. Denial cancels its runtime window, including when approval was waiting for
controller startup. Concurrent
polls have one fulfillment winner. Polls and state reads never open a window.
A bridge/control failure returns no payload and never falls back to the QR.

Approval rooms do not enter `onPairingOpportunity`, the runtime's QR payload,
controller status events, pairing state, rendezvous, `/resolve` or `/healthz`.
The host's existing QR card stays unchanged, or stays hidden if no Show-code
window is open. The request-list API shows the approval and optional full key, not
the room. Stop/shutdown closes all windows. Runtime restart loses private
windows rather than reconstructing permission from approved cache rows.

Approval before a later revocation does not authorize the revoked key to use
that window. A fresh explicit approval of the named key **after** revocation is
a deliberate regrant, just as physically scanning a fresh QR is.

Controller/daemon startup and restart (including the maintenance Restart button)
are reconnect-only. Only the explicit Show code / Start pairing action opens a window. There is no
automatic QR refresh that extends permission or opens another opportunity.
Reopening the host pairing view explicitly creates a fresh room and baseline.
Merely retaining a room, changing its displayed expiry, reconnecting the relay,
or switching between XX and IK cannot restore trust. A fresh explicit local
pairing action can deliberately pair the same key after revocation.

## Trusted local control

The runtime exposes typed `openPairing`, `cancelPairing` and request-scoped
`approvalPairing` composition methods.
A running controller receives local `pairing/opportunity` JSON-RPC control on
its direct Noise channel. The server intercepts this before the application
router and requires authenticated full-key equality with its own host identity.
A paired phone key, claimed device ID, plaintext client, HTTP header or relayed
RPC cannot open the opportunity. The QR control carries `open` or `cancel` and an optional cancellation ID.
If an approved request's window was consumed, cancelled, expired or invalidated
by an authority change before the phone fetched its room, its poll answers
`410` with status `expired`. The phone must make a new request. The poll does
not touch the old request's expiry. This is best-effort UX: spent IDs exist
only for the runtime lifetime. After a controller restart forgets them, an
approved request without a known window can answer `202` again. An unavailable
controller also remains unknown, not proof of a spent window. No persisted
approval reconstructs an invitation.

Cancellation marks the request ID spent even if its window has not opened yet.
A delayed open cannot revive that ID within the same runtime. The HTTP route
also keeps its denial recheck after controller startup.

Request control carries `request-open`, `request-read` or `request-cancel`, a
request ID and its optional expected full key. These are local composition
inputs after host approval, never a grant accepted from a relayed RPC.

This is the existing trusted same-user/local-build boundary, not a sandbox
against a hostile process holding the host's private key. Local service
possession is not an operator-decision entitlement. The desktop transport now
delegates to the runtime implementation so its own-key channel can use the
same no-trust-write behavior as the web channel.

A CLI pair view that attaches to a running controller opens a fresh opportunity
through this channel and cancels that view on exit. A CLI session that owns a
new runtime opens once after startup and closes the runtime on exit. A host UI
Stop action stops its controller. Once the opportunity closes, its QR is removed
from the controller snapshot; the reconnect room remains available to trusted peers.

## Unadmitted and revoked peers

An unadmitted secure peer receives no session snapshots, bridge or broker
events, or application RPC responses. The bridge sends the existing per-client
relay close envelope with code `4003`, reason `Untrusted peer`, and tears down
local state even if the relay drops that envelope. Only admitted peers can
replace older connections, using full-key equality rather than a display
prefix. XX/IK, relay room and client ID are routing, not authorization.

A previously paired phone can reconnect in the reconnect room over either XX or
IK without adding an authority generation or cancelling a live pairing window.
Advisory lastSeen can change; it does not enter the authority baseline.

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
`bun test scripts/relay-pairing-review.test.ts` covers trusted and revoked
resolve/reconnect during a window, non-disruption, two-phone pairing, unindexed
QR rooms, deliberate regrant by scan, and retirement for both relay clients.
`packages/runtime/src/pairing-security/pairing-opportunity.test.ts` covers owner
baselines, guarded publication and managed-gate use. These are not physical
phone UI or complete credential-revocation tests.

`bun test scripts/approval-pairing.test.ts` covers shared HTTP route/store logic
through the actual own-key control and both relay clients, with instrumented
application sinks. It verifies keyed and legacy admission, private delivery,
coexisting windows, denial/replay/expiry, and authority cancellation.

## Live-session authority and close codes

Secure endpoints require the v2 trust capsule before they start listening. A
host with a v1 store refuses startup with `pairing_trust_capsule_migration_required`.
It does not migrate on an incoming request. The host's trusted local cutover
procedure must drain old desktop, CLI and web users, exclude unsupported writers,
call the canonical owner's `migrateToCapsule(migrationId)` and complete recovery
before starting these endpoints. Registry startup is not that deployment
procedure and does not certify that old processes have been excluded.

A paired transport takes its authority stamp once after successful admission.
Every later admission and protected send verifies current authority. A changed
stamp invalidates the old handle, including after revoke and regrant of the same
key. Any real pairing authority change therefore requires older, still-trusted
phones to reconnect. Advisory updates and opening, cancelling or retiring an
unused pairing window do not change authority. The host's own authenticated
local-service channels are a separate class, not paired-phone principals.

The runtime exports `PAIRING_AUTHORITY_CHANGED_CLOSE_CODE` with value **4006**.
Its reason is `authority changed, reconnect`. This code is used only when the
same fresh view that invalidates the stamp still contains the authenticated full
key. A missing key, unavailable membership or changed root uses **4003**. Codes
4000 through 4005 are occupied; in particular the hosted relay uses 4005 for
`Host asleep`. A revoke acknowledgement confirms authority publication, not
physical closure or phone acknowledgement across every process. Close delivery
is advisory; a lost close frame does not preserve permission.

Pairing revocation is not removal of all device access. Existing SSH grants,
open terminal sessions, issued HTTP bearers and already-received data have
separate owners. Credential matching and prefix-only legacy migration remain
required follow-on work after the registry. Only an established full-key owner
can migrate automatically; ambiguous or unknown legacy ownership requires local
review or explicit re-provisioning. The registry does not complete credential
revocation or the private consuming-graph proof.

### Resumed mobile agent configuration

Both bridge families forward a trusted local admission callback from legacy
`mobile/session/create` and tRPC `mobile.createSession` through `upScoutAgent`
and `startLocalAgent` into the configuration writers. The callback resolves the
live transport again; no stamp, positive permission or callback is serialized.

Configuration JSON is serialized before admission. Directory submission is
checked next, and file submission is checked again after asynchronous directory
creation. The project ignore-file write re-admits after its asynchronous read;
legacy relay-link removal re-admits after project setup. Cold creation, imported
project updates, existing project ignore updates, agent forks and warm override
updates carry the same callback. Refusals propagate without a configuration
fallback. Trusted local callers that omit the hook retain their behavior.

The hook also reaches lazy ACP warmup for `grok_acp`, `kimi_acp` and
`devin_acp`. These branches publish a durable agent registry without starting
an ACP process. Registry publication re-admits after its asynchronous reads,
then re-admits the file after directory creation through the same configuration
writer. A protected warmup refusal propagates instead of becoming an offline
binding. Callers without the hook retain the existing best-effort fallback.
The callback belongs to the current call; it is not stored in a session or
agent record. Joining an existing warmup flight does not transfer authority
from its initiating caller or cancel that caller's work.

Process-launch warmup, broker binding, peer-session creation and seed delivery
have separate owners and still require their own resumed-effect qualification.
In particular, the warmup entry check does not qualify an engine's later
filesystem, daemon, fallback or process submission after another await.
A denied configuration or lazy ACP registry write does not
roll back filesystem operations already submitted. These submission checks do
not certify a private host's combined pairing-authority/journal ordering or
remove separately issued credentials.

### Synchronous delivery batches

The runtime registry shares one verified authority view across a synchronous
Bridge event fanout, broker message/lifecycle fanout, initial-session replay or
desktop Tail fanout. Every target still checks its own exact handle and lifetime.
Nested delivery batches reuse only the current synchronous stack. A publication
or a newer admission discards an older batch permission; it never rebases an old
handle. Network frames leave after the batch's narrow managed read callback
returns, rather than from inside that callback. This does not certify ordering
against an outer private native invocation.

No view survives an await, microtask, timer or later source callback. An explicit
managed context is always validated by the owner, even inside a public delivery
batch. Writer notifications run after verified durable publication or retry ACK,
not on ordinary reads. They remain an invalidation hint, never an authorization
cache or a substitute for the disk indicator and full-read backstop.

Independent inbound frames and subscription results resumed after a wait still
require fresh decisions. Synchronous fanout batching does not establish a bound
on arbitrary streaming CPU, and does not introduce a delayed output buffer,
frame aggregation policy or new authorization lifetime. Broker watcher domain
bindings are trusted local composition values and are not forwarded on the wire.

Each awaited subscription frame requires one full authority read. Prior gate (g)
owner-only large-tier CPU samples averaged 10.618–10.962 ms per read. At 75% of
one core, that gives a **reference model** of 68.4–70.6 read-only frames/s before
registry, encoding or network work. This is not a measured capacity of the
registry implementation. The registry cost gate must include a declared rate
of at least 10 awaited frames/s across live subscriptions, concurrently with
10 RPC admissions/s and 10 event batches/s at both store tiers. A passing gate
qualifies that declared workload, not the reference streaming rate. Payload
aggregation or a cheaper read requires separate review; a positive authority
view must never be retained across a wait to meet a CPU ceiling.

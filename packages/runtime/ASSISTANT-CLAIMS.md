# Exclusive assistant answerer claims

The broker enforces one active resident-assistant lease per protected agent
identity. `scoutbot` is protected by default in `createBrokerCoreService`.
Environment flags can select a process mode, but they cannot authorize an
answer or replace a lease.

This contract is machine-local and scoped to one broker instance. It is not a
mesh lock, global consensus, an agent authentication system, or per-message
exactly-once delivery. Existing delivery receipts and canonical message IDs
still govern retry identity. A holder label is descriptive, not authentication.
A lease token is a bearer credential for trusted same-user clients.

## Claim and renewal

All claim-management routes are local. Remote, forwarded, scoped/guest and
browser-origin requests cannot acquire a claim. Existing broker ingress/auth
checks still apply. Tokens are honored only on local, non-forwarded,
non-browser-origin requests.

| Request | Result |
| --- | --- |
| `GET /v1/assistant-claims` | `{ capability: "assistant-answerer-claims/1", agentIds: ["scoutbot"], ttlMs: 30000, agents: { scoutbot: { held, holderId, admitted, oldestAdmissionAgeMs } } }` |
| `POST /v1/assistant-claims` with `{ agentId: "scoutbot", holderId: "<unique process instance label>" }` | 201 and `{ agentId, token, ttlMs }` |
| `POST /v1/assistant-claims/renew` with `{ agentId }` and proof header | 200 and `{ agentId, ttlMs }` |
| `POST /v1/assistant-claims/release` with `{ agentId }` and proof header | 200 and `{ ok: true, draining: <boolean> }` |

The proof header is **`x-scout-assistant-claim-token: <token>`**. The broker uses a
cryptographically random token and a monotonic 30-second deadline. Renew at
half the TTL (15-second intervals for the default TTL), before expiry. Renewal keeps the same token. A new
claim receives a different token. The client cannot choose an unbounded TTL.

A second claim receives **409 `assistant_claim_busy`**, even if it repeats the
holder label. The response includes `retryAfterMs`, not the holder's token. A
zero delay means an expired/released lease still has an admitted mutation to
drain, not permission to take ownership or spin without backoff. Unknown
identities and malformed holder labels receive 400.

No proof receives **409 `assistant_claim_required`**. An incorrect, expired,
released or previous-broker token receives **409 `assistant_claim_lost`**.
Those responses must stop answering, not activate a legacy fallback.

If the acquire response is lost, a client has no token and must wait for expiry
or the current owner to release. Repeating a holder label never recovers the
secret. A client must not begin answering until it receives a successful claim.

## Death, release and restart

When a holder dies or loses contact, renewal stops. After the deadline, no new
mutation can use that token. A replacement can acquire once already-admitted
mutations settle. The broker does not need the client to send a release.

Admission pins the lease while a client mutation is running. Expiry or release
does not let a second owner overlap that admitted mutation. Release prevents
new admissions immediately and reports whether the old owner is draining. If
an admitted operation is stuck, takeover waits rather than stealing ownership.
The capability GET reports per-agent `held`, `holderId`, `admitted` and
`oldestAdmissionAgeMs`. A draining owner remains held after expiry or release.
An idle, expired owner reports `held: false` and `holderId: null`. An agent
without admissions reports `oldestAdmissionAgeMs: null`. Tokens are never
included. One diagnostic timer per admitted write logs its agent, holder,
admission count and age if it outlives the TTL. The timer does not revoke the
claim, cancel the write or permit takeover. Completion also checks the age
in case a stalled event loop has not run the timer. A diagnostic failure cannot
change the write result.

Existing operation timeouts/recovery apply; this API does not forcibly cancel
canonical writes or spawn/kill processes.

Leases exist only in the broker's memory. Broker restart invalidates every old
token. There is no credential file, journal replay of leases,
or automatic resumption under an old token. A reconnected client reacquires
and reconciles already accepted work by its existing message/request identity.
A lease change does not cancel or erase canonical invocations already accepted
by the broker. Their broker-owned execution/completion can finish normally;
that is not a new claimless external answer submission.

## Enforcement boundary

`createBrokerCoreService` guards the common client-write surface, before its
mutation delegates run. HTTP and active-service/in-process shortcuts share the
same guard. It covers:

- Actor/agent/endpoint registration for `scoutbot`, including generic commands.
- Direct answers authored by `scoutbot` through `/v1/messages`,
  `/v1/messages/reply`, and `conversation.post` commands.
- Deliver/invoke requests authored by the assistant, and the legacy web
  runner's delegations marked `source` or `generatedBy: "scoutbot"`. That
  runner delegates as the operator, so guarding only requester ID would miss it.

Ordinary operator messages and asks **to** Scoutbot do not require the operator
to own the assistant lease. Internal broker execution, canonical completion,
trusted mesh record import and journal replay are not new external assistant
registrations. They keep their existing authority and idempotency contracts.
Claims are not forwarded in mesh envelopes. No private process gets a bypass
of the client-write guard because its body claims to be a completion, sets an
environment flag, or puts a token in metadata.

Tokens travel in request context only. Do not put them in metadata, message
bodies, persisted commands, fingerprints, logs, snapshots or child environment.
The guard does not mutate canonical objects. Embedded callers use the service's
`assistantClaims.withToken(token, action)` request scope; unrelated concurrent
requests do not inherit another request's authorization. A token is not a
permanent privileged identity: a same-user client that deliberately shares it
can share its authority. This remains a high-trust local system.

## App compatibility and adoption

`packages/web/server/scoutbot/answerer-claim.ts` is the shared claimant for the
in-process web runner and the standalone process. Holder labels include mode,
pid and a unique process-instance suffix. Both acquire before registration,
endpoint retirement, event consumption or answering. They renew at half the
TTL. A busy candidate stays posting-only and retries quietly once per second.
It does not register, consume the inbox, generate an answer or retire an
endpoint while another owner holds the claim.

The claimant uses a monotonic local deadline, conservatively measured from the
start of each acquire/renew request. Renewal failure or expiry aborts the local
answering scope. Stop aborts new work, drains the runner and releases the claim.
A replacement generation cannot lend its token to old async work. The broker
still fences an already-sent request that arrives after expiry or takeover.
Canonical operations already admitted by the broker keep their existing
completion behavior and ownership pin.

Capability discovery is backward compatible. A missing capability (404, or a
successful legacy response with no capability field) permits the old, claimless
answering behavior **only against that older runtime**. Network errors, an
unknown capability version, 409 busy and failed renewal do not permit a legacy
fallback. Legacy mode probes the capability every 15 seconds, so a broker
upgrade exits legacy mode and reacquires before the next answering generation.
An older runtime cannot guarantee exclusive answering. The new
runtime always refuses claimless assistant mutations; discovery does not turn
off its enforcement.

The web runner attaches proof in its broker POST helper. Its UI posting and
thread-read APIs do not register or warm an answering endpoint. The standalone
process attaches proof in `process/broker-link.ts`. Its stdio MCP child uses a
generation-bound Unix socket proxy (`process/claim-broker-proxy.ts`) so tool
writes get the same proof without exposing it in child environment, tool
arguments or dispatch receipts. The proxy directory is mode 0700 and its socket
is 0600. It cannot manage claims, and a stopped generation cannot forward new
work with a successor's token. The proxy closes with the generation; it is not
a second answerer or a process supervisor.

The runtime claim change and this public claimant must ship in the same release.
Public npm installs retain a working assistant while the web is included. At
the app/runtime cutover, the private app adopts this claimant module unchanged,
along with the two runner integrations and the standalone transport adapter.
No port to the current private runtime is required: the new claimant can use
its old-runtime compatibility path until the paired cutover. Do not ship a new,
enforcing runtime with a claimless app build.

Affected tests pair the public runners and claimant with the runtime guard and
HTTP claim/answer routes. They cover a stray web without `managed`, quiet busy
retry, death and expiry, delayed old-token posts, renewal failure, stalled
renewal, broker restart, old-runtime discovery, and the generation-bound tool
socket. These are fixture tests; they do not start or change installed apps.

The lease establishes exclusivity, not preferred-owner selection. The app
launcher's desired-state handoff still determines which process should claim.
Full process handoff and rollback remain separate work.

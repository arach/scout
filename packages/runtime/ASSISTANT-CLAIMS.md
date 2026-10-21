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
claim, cancel the write or permit takeover.

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

## App compatibility and private adoption

**Choice: ship the public runtime contract; adopt it in the private app at the
CLI/runtime cutover.** This PR does not port changes into the current private
runtime or modify the private app's claimant implementation. It does not depend
on transitional app entry configuration.

Today's private runtime and app keep their existing behavior because neither
is changed here. At cutover, ship a paired private app build and public runtime
version with this capability. The installer must verify compatibility before
repointing the app. Do not call this API from today's private app against an
older runtime, and do not release the new runtime to app users with an old
claimless assistant implementation. Old claimless Scoutbot registration and
answer submissions to the new public runtime intentionally fail closed,
including the frozen web implementation still in this checkout.

A compatible no-op is **not** part of this contract. If the new claimant sees
404, a missing capability or a different capability version, it must remain
non-answering and report that a compatible runtime/app pair is required. Core
and operator posting remain usable. Do not interpret absence as permission for
two legacy answerers.

The private adoption work must do the following:

1. In the standalone process (`process/scoutbot-process.ts` bootstrap and run)
   and any answering web runner (`runner.ts`), acquire before registration,
   endpoint retirement, event consumption or model/tool execution. The posting
   handle remains posting-only without acquiring.
2. In `process/broker-link.ts` and the runner's broker request helper, attach the
   proof header to registration, answer and assistant-originated dispatch
   requests. Keep it out of payloads and persisted dispatch journals. UI/operator
   posting must not attempt answering-role registration without a claim.
3. Renew on a bounded loop. A failed renewal pauses new work immediately. On
   lost/expired claim, abort local generation/tool admission and stop publishing.
   Reacquire only through the selected owner's recovery policy. A second
   candidate reports `assistant_claim_busy` and stays inert/posting-only; it
   must not delete the holder's endpoint or activate another fallback mode.
4. Release after stopping new work and draining local work. On broker restart,
   reacquire, then reconcile canonical messages, invocations and private
   dispatch receipts before retrying a turn. Do not mint a new instruction to
   replace work whose outcome is unknown.
5. Test two live claimant fixtures, a stray web without `managed`, death/expiry,
   renewal failure, old-token delayed posts, old-runtime capability absence,
   broker restart and preserved operator posting. These are app adoption gates,
   not claims that this runtime-only PR has tested an updated private app.

The lease establishes exclusivity, not preferred-owner selection. The private
launcher's desired-state handoff still determines which process should claim.
Full app process handoff and rollback remain separate work.

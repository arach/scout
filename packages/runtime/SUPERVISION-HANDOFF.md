# Staged supervision ownership contract (R0/P1), version 1

## Release gate: this is not an integrated R0 runtime

R0 is the transitional runtime owner; P1 is the external app launcher.
These are owner principals, not PIDs or leases. This is local supervisor custody,
not mesh consensus or broker exactly-once delivery.

This PR supplies an opt-in SDK, a durable authority/receipt implementation and
failure fixtures. It does **not** wire the existing base/broker app supervisors,
install a launcher, enroll a machine, or advertise a usable handoff endpoint.
`productionHandoffReadiness()` and the SDK metadata handshake return
`ready: false`, `r0_effect_integration_unavailable`. There is no environment or
manifest override. Do not select this artifact as the compatible runtime floor.
The private production adapter must stay closed.

The next public R0 integration must route **every** legacy app effect through
this fence, prove that old restart/takeover/relaunch paths are disabled, and
supply the running runtime's verified artifact/coverage handshake. That includes
web and terminal-relay helpers, Scoutbot, menu/GUI/login paths, phone controller,
app edge and invented managed-child entries. A semantic version, a successful
metadata handshake or a matching source checkout is not that proof.

Existing machines and their launch jobs are unchanged by this SDK. No module
import, handshake, status read or fresh core install enrolls or starts an app.
An integrated R0 release must additionally prove full-runtime core-only startup;
the absence of SDK effects is not evidence that today's legacy supervisors are
already core-only. This PR intentionally makes no such claim.

## Safety statement and limits

For cooperating R0/P1 adapters using this contract, at most one owner principal
can hold a role's durable authority. This remains true across controller death,
restart, two controllers racing, repeated manual requests and GUI reopen.
Physical non-overlap additionally requires the trusted process adapter's exact
absence/custody proofs and synchronous effect boundary described below.

This is not a sandbox against malicious code running as the same UID. That user
can edit its own files or deliberately execute an unsupported pre-fence binary.
A file cannot fence an old program that ignores it. The updater must exclude
pre-fence processes and every supported route that can relaunch them before it
activates either new owner. Unknown jobs, old GUI/menu clients or an unresolved
OS launch request block handoff. Never substitute a TTL or PID file.

### Inductive argument

1. Staging gives every role owner `null`, generation 0 and stopped intent.
   Metadata/version agreement grants no authority.
2. Every mutation holds the same OS-backed exclusive lock, including across
   awaited observations and effects. Competing controllers fail `ownership_busy`.
3. Initial activation requires explicit, one-use operator authorization, a
   verified integrated runtime above the selected floor, and full absence.
4. Draining retains the old owner/generation. It prevents starts/restarts;
   verified stops remain possible. Draining stops preserve the original intent.
5. Transfer requires all prior receipts resolved and full absence again. One
   fsynced record advances generation and changes owner. Neither owner starts a
   process as a side effect of transfer. Old callbacks fail the new generation.
6. The new owner's first start re-proves absence under the same lock. Intent and
   receipt are durable before an effect, and completion follows its outcome
   proof. A crash between those points leaves a pending receipt, not permission
   to repeat the effect or hand off the role.
7. Reverse transfer uses exactly the same rules and another generation. There
   is no timeout takeover, generation decrement, database restore or implicit
   rollback. Repeated handoff acknowledgment does not advance generation again.

The two controller processes interpreting `P1` do not constitute two durable
owner principals. They share one generation, intent, ledger and serialized
physical-effect boundary. A second process cannot adopt an occupied role or
invent another start while a receipt is unresolved.

## Selection, lock and storage

Import `@openscout/runtime/supervision-handoff` explicitly in a Bun host. Select
`{ uid, id, supportDirectory }` from the authoritative instance locator. Do not
infer selection from environment, ports, display labels or source directories.
The support path must be absolute/canonical and owned by the effective non-root
UID, without group/world write access. Different instance values refuse.

The updater explicitly prepares this directory with exact mode 0700:

```
<selected supportDirectory>/supervision-handoff-v1/
  custody.log      # 0600, stable inode, one hard link
  identity.json    # 0600, initial device/inode anchor
```

`stage(policy, approve)` exclusively creates these files after approval. It only
records an unowned/staged policy. A second stage attempt refuses; it cannot
replace or reset an existing store. Reads do not create files or repair modes.
Symlinks, changed identity, unsafe modes and hard links refuse. Nothing opens the
canonical broker database. Private service receipts here are not broker messages,
flights, delivery receipts or global coordination records.

`custody.log` is both the stable-inode `flock(LOCK_EX | LOCK_NB)` target and an
append-only hash-chained sequence of complete state snapshots. Writes loop over
short writes and fsync before returning; creation also fsyncs the directory.
A failed persistence poisons the current effect scope. A reopened reader fsyncs
and validates the chain before using it. Replacement inode, partial/torn record,
unknown schema or invalid hash fails closed. The anchor prevents ordinary
rename-and-replace journal restoration from being mistaken for this lock.

Do not unlink, rotate, truncate, restore or recreate these authority files.
The tests' prefix images are failure simulation only. An in-place administrative
rollback is outside this protocol, just as deliberately running an unfenced
binary is. Restoring the broker DB cannot change this separate authority store
and is not a supported supervision rollback.

The lock assumes a host-local filesystem with working `flock` and `fsync`
semantics, not a shared network home or mesh store. The SDK loads the existing
system library (`libSystem.B.dylib` on macOS, `libc.so.6` on supported Linux).
There is no native build, PID-file fallback or unsupported-platform takeover.

The staged implementation bounds the file at 16 MiB and receipts/authorizations
at 256 each. Capacity refuses rather than evicting replay protection. There is
no compactor or partial-tail repair. A production retention/repair policy needs
review before an integrated floor opens long-lived service operation. These
limits are not a shipping steady-state supervisor database design.

## SDK handshake, floor and operator authorization

`SupervisionHandoff(instance, inspector)` uses trusted host adapters, not proof
objects supplied by an IPC client. The local discovery endpoint is `GET /v1/supervision-handoff`. A classified
Unix-socket or loopback caller receives the closed capability metadata with
HTTP 200. Remote, forwarded, browser-origin, guest, scoped and unclassified
callers receive 403. The endpoint reads no locator or store and grants no
mutation. There is no HTTP enrollment or lifecycle API.

The separately selected SDK metadata handshake is:

```
handshake({ protocol: 1, instance: { uid, id, supportDirectory } })
  -> { capability: "supervision-handoff/1", protocol: 1,
       ready: false, reason: "r0_effect_integration_unavailable",
       instance, floor, roles }
```

Unknown handshake keys, protocol mismatch and instance mismatch refuse. The
running-R0 readiness proof is a separate required integration input. Its
`HandoffInspector.readiness(role)` must verify the running artifact and compiled
effect coverage, not echo client fields. It supplies protocol, ready, runtime
version/artifact, launcher artifact, integrated roles and assistant-claim
capability. The SDK checks readiness on initial activation, transfer/resume and
entry to every role effect scope. The production stub supplies no coverage.
There is no broker HTTP lifecycle or arbitrary-spawn surface here.
Readiness is not broker liveness: the integrated adapter must retain verifiable
pinned artifact/startup-barrier evidence across a broker restart. An offline
broker does not release P1 custody or make the app a child of the broker.

The **operator supplies**, rather than this PR choosing:

- policy ID and minimum runtime version;
- exact verified runtime and launcher artifact allowlists;
- the compatible runtime artifacts allowed for reverse transfer;
- whether the rollback window is open.

Even a higher version is refused unless its artifact and role coverage match.
`closeRollback(approve)` closes the window durably; it cannot silently reopen it.
A pre-fence/unlisted artifact is never a fallback. The updater must bind actual
package/signing/process evidence to those identities. The SDK cannot infer that
from a version string.

`authorize(intent, approve)` obtains explicit operator approval and revalidates
under the lock. A one-use random token is bound to UID/instance, policy, role,
source, target and expected generation. Enrollment also binds desired state;
recovery binds the original receipt ID. Only the token's hash is persisted.
Do not put tokens in argv, child env, app journals or logs. `revoke(token)` keeps
its record and invalidates further use. Approval is a trusted local updater
callback, not a `confirmed: true` field from GUI reopen or an IPC request.

## State transitions and rollback

| Operation | Preconditions | Durable result; crash/retry behavior |
| --- | --- | --- |
| `stage(policy, approve)` | Selected paths safe, explicit policy approval, no existing store | All roles staged/unowned/stopped. No process or job action. |
| `activate(role, token, desired)` | Enrollment consent; integrated floor; full absence | R0 active, generation 1, approved intent. Same token/result replay does not reactivate. |
| `drain(role, token)` | Handoff consent matching source/generation; floor/window; no pending receipt | Old owner stays authoritative in draining. Repeating the same drain is inert. |
| `transfer(role, token)` | Matching reserved drain; readiness; resolved receipts; full absence | Target active at generation +1, intent preserved; no implicit start. Lost reply replays without advancing again. |
| `resume(role, newToken)` | Explicit abandoned-drain consent to old owner; no uncertainty; full absence | Same owner active at generation +1; old transition invalidated. Never decrement/reuse a generation. |
| Reverse transfer | P1 drain, exact exits/jobs quiescent, approved compatible R0/window | R0 receives a fresh generation and preserved intent. Broken P1 or elapsed time alone grants nothing. |

A revoked drain leaves the source draining. Resume requires new approval and
absence. It does not guess that the target never activated. If transfer already
committed, a stale resume token cannot act: use a reverse handoff from the
current owner. Unknown loaded jobs or in-flight LaunchServices requests prevent
both paths. A manual restart and a GUI reopen must delegate to the current
owner; they are not enrollment or rollback authorization.

## Authority and absence at physical effects

`exclusive(owner, role, generation, callback)` holds the lock until callback
settlement and revokes its scope afterward. `RoleCustody` exposes snapshots,
assertions, receipts and controlled effect admission. Escaped permits cannot
be reused. All five app roles participate; no extension manifest enrolls one.

Full absence means **all** of:

- role processes absent;
- conflicting jobs disabled;
- all old GUI/login/manual/restart sources fenced;
- queued/deferred OS launch and stop operations quiescent.

A quiet port, PID absence, a stop acknowledgment, unknown launchd state or a
matching version is insufficient. Observations happen inside the lock and are
rechecked after awaits. Every start has a write-ahead effect nonce. Owned
identity includes UID, selected instance, role, generation, PID, birth identity,
executable evidence and nonce. A stop must match a confirmed custody record by
values, not only PID. A reused PID or unrecorded process is never signaled.

The private native adapter must hold an appropriate process/job custody handle
through its synchronous `permit.atEffect(() => spawnOrSignal())` boundary. A
check followed by `kill(pid)` without protection against PID reuse is not that
proof. Asynchronous work must re-enter the permit at its actual effect; returning
a promise from this synchronous boundary refuses. Actual private/native effects
are deliberately not implemented or certified by these fake fixtures.

## Receipts and private engine mapping

Receipts are scoped to instance, role, generation and request ID. `begin(id, op)`
atomically persists pending receipt **and** desired state. `perform` persists an
effect intent before its synchronous boundary, then confirms only after exact
owned-start or full-exit proof. Restart confirms stop before starting replacement.
Draining stops preserve desired intent. `complete` cannot conceal an uncertain
effect. Completed replay performs no new effect; operation conflict refuses.

| Private ownership adapter concept | Shared SDK mapping / required change |
| --- | --- |
| `read(role)` | `sdk.read(role)`; never infer authority from status/child handle. |
| `exclusive(role,generation,fn)` | `sdk.exclusive("P1",role,generation,fn)`; hold through all actual effects. |
| `Lease.ownership/assertCurrent` | Snapshot and scoped assertion, not a lifetime lease or TTL. |
| Pending `putReceipt` plus `setDesired` | One `begin(id,op)` transaction. Separate `setDesired` must only validate that result, not create a second independent write. |
| Completed `putReceipt` | `complete(id, stableErrorCode?)`; pending effect uncertainty must remain pending even if the private engine catches an exception. |
| Child start/stop | Wrap the original request ID in `perform`; the native adapter enters `atEffect` at the actual syscall/job request. A preliminary assertion is insufficient. |
| Reconcile/automatic restart | Needs a durable attempt ID and write-ahead receipt, not today's receipt-free fake-engine reconciliation. Persist bounded retry state and do not re-key unresolved work. |
| Delayed exit/restart callback | Re-enter with its original generation; never carry an operation-scoped permit into future work. |
| Uncertain result | Recover exact original receipt, never fresh-ID retry, PID adoption or implicit ownership transfer. |

`recover(id, authorization)` never repeats an effect. A confirmed durable result
can finish its receipt. An uncertain start can be confirmed only by the exact
recorded nonce/custody identity. Complete absence can close the receipt without
pretending a missing start succeeded. An uncertain stop still occupied/unknown
remains blocked; quiescent absence confirms it. This is receipt reconciliation,
not adoption of a process discovered by name. Torn journal repair remains closed.

## Scoutbot and independent core health

Scoutbot readiness additionally requires `assistant-answerer-claims/1`. The
packaged worker must acquire/renew its separate runtime claim before model,
tool or answer work; web remains posting-only. Claim loss stops answers and
publishing. It does **not** release durable role ownership, advance generation,
authorize a fallback answerer, or open rollback. The owner can remain degraded
while it reacquires the claim under its own recovery policy.

Use the shared public claimant and its existing fenced-response tests when the
paired app/runtime cutover occurs. A role receipt is not an assistant token and
neither is a broker exactly-once delivery receipt. Application failure must not
change core storage/startup health or restore canonical coordination data.

## Rollout gates still open

1. Public integrated R0: cover every app effect/late callback and expose the
   actual running-artifact readiness handshake; test source and packed core-only
   startup with no app attempts. Metadata SDK tests do not satisfy this gate.
2. Private adapter: implement the mapping above, exact OS process/job/in-flight
   evidence and protected native effect boundary. No production adapter is
   supplied by this public PR.
   The production inspector for `app-edge` must count the old runtime's Caddy
   and mDNS advertisements as occupied evidence. It must not prove absence
   while either remains active.
3. Operator: choose the compatible artifact floor, rollback window and a live
   rollout authorization. Existing machines stay on their old owner until then.
4. Only afterward: shared forward/reverse native failure fixtures, independently
   authorized live-Mac checks, and activation. No current process or job changed.

The public contract and fixtures can be reviewed before these gates open. They
must not be advertised as a production custody certificate.

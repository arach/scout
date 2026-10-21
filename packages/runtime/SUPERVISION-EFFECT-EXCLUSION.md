# Staged role-effect exclusion

## Release gate

This is an inactive SDK contract, not an integrated owner. It installs no
service, enrolls no role and changes no daemon or launcher default.
`productionHandoffReadiness()` remains false. No actual worker binary has been
certified for descriptor retention by this change.

The runtime remains the custody **host**, not an enrolled role. The five
`HANDOFF_ROLES` are unchanged. The broker's generation checks at enrolled roles'
effect boundaries are part of each role's coverage audit. An unenrolled broker
is not an exemption for broker-mediated role effects.

The operator supplies the compatibility floor, artifact allowlists and rollback
window. This SDK verifies the pinned artifacts against an approved complete
role-effect coverage profile. It does not choose a released floor or implement
boot-provenance recovery.

## Two different proofs

Existing absence-only stores keep their current behavior. `Absence` means the
processes are absent, jobs disabled, relaunch fenced and in-flight work
quiescent. The legacy inventory and direct-child adapters are unchanged. A new
owner birth still makes descendant coverage unknown, including after direct
child exit. Worker `absence()` must keep reporting unknown when its living
descendants cannot be proved absent.

A selected exclusion profile supplies a distinct `RoleEffectExclusion` result:

- `state: "role_effect_excluded"`;
- `capability: "role-effect-exclusion/1"`;
- `carriers: "excluded"`;
- `delegated: "settled" | "covered"`;
- `relaunch: "fenced"` and `inFlight: "quiescent"`;
- **always** `descendants: "unproven"` and `nonOwners`, including an empty list;
- the source instance, role, owner and generation, policy/profile hashes,
  fresh observation ID, exact fence identity, and resource/legacy evidence.

`covered` requires the policy's approved durable-work contract. It means the
work is reconciled exactly once under that contract, not that arbitrary
external effects are cancelled. Generation enforcement or receipt settlement
must occur at each effect's **linearization point**, including effects that
land after their initiating process exits.

Only SDK ownership and cohort-retirement decisions consume this proof. It never
becomes a worker
`Observation` or `Absence`. Old worker start/stop and recovery observation
semantics are not relaxed. Wiring a production drain/stop receipt to an
approved role-specific actuator remains a separate integration obligation.
A transfer replay returns no fresh certificate; it replays only the committed
owner transition. A retirement replay returns a saved receipt snapshot with
`replayed: true`, not a fresh observation.

## Durable profile selection and compatibility

An explicitly approved `FloorPolicy.effectProfiles[role]` contains:

- the profile kind/ID and complete-coverage audit ID;
- the runtime and launcher artifacts covered by that audit;
- an inventory ID and a nonempty, bounded list of resource IDs and kinds;
- the legacy-evidence ID and permitted non-owner contracts;
- an optional approved durable-work contract.

The profile is an audit input, not discovery or permission to autostart.
Installing an extension cannot select it. `stage()` prepares its fence under
the ledger mutex but leaves the role unowned and stopped. Initial activation
still requires the existing legacy **absence** proof in addition to the new
profile's resource and legacy evidence.

Enrollment persists `Ownership.proofProfile` with the ID, profile hash and
capability. The complete profile also participates in `policyHash`, binding
operator grants exactly as other floor policy does. Changing a profile
invalidates the selection, old grants and old observations. There is no
per-call opt-in or automatic profile migration.

The host constructor must declare the capability through its fixed
`capabilities` option. Readiness must declare the same capability and return
matching per-role profile/hash/audit coverage for the pinned running artifacts.
Missing capability, including on a transition replay, refuses. Read-only
ownership inspection does not grant this capability.

**One-way store format:** a newly staged profile store writes state version 4
from its first record. Version 4 adds retention and checkpoint redo to version
3's cohort retirement and one-start rule. The earlier version-3 SDK must refuse
**before** a checkpoint publishes redo: an older writer that ignored a pending
redo file could otherwise append authority to the pre-checkpoint chain.
Absence-only stores remain version 1. This SDK can inspect version-2 and
version-3 stores, but cannot write them, including through administrative APIs.
A write cannot change the store's version. No automatic in-place upgrade exists.
Operator-reviewed re-staging is a separate cutover obligation, not permission to
replace an inode that might still carry authority. Rollback artifacts must
understand version 4, including redo recovery. Do not edit a version or restore
an earlier image to downgrade a store.

## Lifetime fence and ledger serialization

The ledger remains `custody.log`, with its existing short transaction lock.
Each selected role additionally has `lifetime-<role>.lock`. Its device/inode is
recorded in the hash-chained ledger. It is a separate owned 0600 regular file,
with one link, under the owned 0700 custody directory. Preparation uses
exclusive creation, fsyncs the file and directory, and never recreates a missing
or substituted inode. The existing explicitly authorized pre-authority staging
cleanup exception also covers incomplete fence preparation.

The lifetime description is close-on-exec. A reviewed carrier adapter must
explicitly map it into a child before the child can act. Parent references are
closed, **never unlocked or downgraded**. A carrier's duplicate description can
survive its parent, reparenting and session changes. Its last reference keeps
the kernel lock held even after the custodian loses its process handles.

The ownership transaction orders the following steps under the ledger mutex:

1. Validate capability, policy selection, authorization, pinned coverage,
   current owner/generation and pending receipts.
2. Open the exact anchored lifetime inode and acquire its nonblocking exclusive
   flock. Busy never grants a time-based steal. Other lock errors retain their
   existing distinct unsupported/failed diagnostics.
3. Obtain fresh trusted resource, legacy, relaunch and delegated-work evidence
   while retaining both locks. Revalidate authority and inode after awaits.
4. Persist and fsync the incoming owner/generation and profile selection.
5. Retain the controller's lifetime reference. Only that committed generation
   can enter its guarded effect scopes.

A rejected proof closes the candidate reference. A persistence failure does
not activate the incoming controller. The ledger's existing uncertain/torn-write
rules still refuse recovery rather than replaying an effect.

The old controller first persists draining and disables its start paths. After
settling its mutation receipts, `releaseLifetimeFence(owner, role, generation)`
closes only that controller reference under the ledger mutex. Any surviving
carrier still blocks the incoming owner's acquisition. Effects through a
released controller refuse. A pending SDK receipt cannot be waived by reporting
external work as `covered`.

`releaseControllerFences()` is serialized host-reference cleanup. It does not
change durable ownership, settle receipts or close child references. A newly
constructed controller has no effect rights from the ledger alone.
`acquireLifetimeFence()` requires the full proof and no pending mutation before
re-establishing those rights. It cannot adopt a process by PID.
It refuses a retiring or retired generation, even when its fence is free.

`recoverReceipt()` provides observation-only recovery when a lost controller
left a pending receipt. It uses the existing operator grant and exact-owned or
absence evidence, without obtaining a descriptor or effect permit. Unknown
observations still refuse. After settlement, re-acquiring effect rights still
requires the complete exclusion proof. This avoids requiring effect authority
merely to settle the receipt that blocks that authority.

## Necessary, never sufficient

Acquiring the lifetime fence certifies a role **only together with its approved
resource inventory and legacy evidence**. Any unexplained live listener,
registration, advertisement or other role resource refuses even if the lock is
free. A helper that silently drops the descriptor can otherwise remain active
while allowing a new lock holder. Kernel exclusion does not enforce advisory
participation.

`HandoffInspector.exclusion(context)` is a trusted local host adapter, not an
HTTP request body or a certificate supplied by the launcher client. It must
make fresh observations for the SDK's observation ID. It reports every approved
inventory entry, unexpected occupants and the surviving non-owners. Each
non-owner carries exact native process evidence and an approved contract ID;
an explained resource references a reported non-owner. Missing entries,
duplicate IDs, occupied/unknown states, stale context and unapproved evidence
refuse. The type supplies no optional “ignore descendants” boolean.

The adapter must keep creation/relaunch barriers closed through the transfer
scope. It must settle or fence deferred requests where they land. A free bind,
listener close, expired advertisement or parent exit is not such evidence.
An unfenced legacy owner cannot be excluded by introducing a new lock.

## Child-side custody check

An audited carrier adapter uses `permit.spawnChild()` in the committed owner's
start scope. Its command must select `carrier: "role-lifetime/7"` and an explicit
three-entry `stdio` tuple. Each stdio entry is `"ignore"` or `"inherit"`; pipes,
numeric FDs and arbitrary extra mappings are not supported. The SDK fills child
FDs according to exported `CARRIER_LAYOUT` (`role-custody/1`):

| Child slot | Meaning | Ownership |
| --- | --- | --- |
| 0, 1, 2 | Explicit ignore/inherit stdio | No arbitrary caller FD or pipe |
| 3 | Parent-loss channel, read end | SDK-created EOF-only pipe, never credentials or the fence |
| 4 | Reserved inherited context | Not implemented; currently ignored |
| 5, 6 | Unused padding | Ignored |
| 7 | Anchored role lifetime fence | SDK maps its own locked description |

The mapped fence descriptor is inherited by everything a carrier forks or execs until check() marks it close-on-exec. The coverage audit must therefore prove, per role: that an SDK-aware child calls check before its first fork or exec; that a plain-binary child which can never call check — Caddy and dns-sd are the known candidates — has its entire process tree audited as the carrier cohort, where any daemonizing descendant blocks retirement for its lifetime; and that no path maps the fence into an intended survivor. Deliberate next-hop mapping is the only sanctioned propagation.

The SDK retains the sole-reaper handle and the pipe's write end for the
controller's lifetime, not merely the short ledger transaction. It closes its
read-end reference after spawn. The writer is never mapped into a child. Both
host endpoints are close-on-exec. Retirement, role-fence release and controller
shutdown close the appropriate writer under ledger serialization. Host process
death also closes it. A worker must install its EOF/close parent-loss guard
before role work; verification of the fence does not install that guard.
The pipe carries no bytes or authority. EOF requests cooperative shutdown, not
proof that every carrier stopped. An uncooperative surviving carrier still
blocks the fence and the stop receipt.

Both numeric mapping sources are temporary CLOEXEC duplicates above slot 7.
This avoids ordered dup2 actions overwriting a low-numbered source while Bun
prepares the target slots. Copies close immediately after the audited borrowed-
FD spawn; the original host fence and writer remain owned. No lock is unlocked
or downgraded. Native preparation is synchronous with no JS await, but Darwin
pipe -> CLOEXEC setup is not atomic. The trusted host must exclude foreign
native fork/exec during that sequence; this remains a deployment obligation.

The caller supplies no descriptor number and receives no raw process handle.
The staged raw `lease.carrierDescriptor()` API is removed. The former
`role-lifetime/3` request refuses rather than choosing an alternate layout.
Raw `atEffect()` starts refuse under a profile, so this is the only supported
carrier-spawn path. Absence-only commands keep their unmapped, ignored-stdio
default; an explicit ignore/inherit tuple is also supported there.

`carrierChildCapability()` currently permits mapped starts only on the pinned
Darwin Bun 1.3.14 revision. Bun 1.3.13 still supports the existing unmapped
direct-child custody adapter, but mapped starts refuse before spawn with
`carrier_mapping_backend_unproven`. An isolated GC probe found that 1.3.13 closes
the caller's extra numeric FD during subprocess finalization; 1.3.14 leaves it
open. The pinned source corroborates this distinction:
[1.3.13 closes extra FDs](https://github.com/oven-sh/bun/blob/bf2e2cecf27e800962b1e7f03d66278f9d5d2e79/src/bun.js/api/bun/subprocess.zig#L727-L744),
whereas [1.3.14 preserves unowned FDs](https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/runtime/api/bun/subprocess.zig#L767-L785).
Passing the controller FD on 1.3.13 can invalidate it, or double-close an unrelated
reused FD after the controller releases it. A manually closed duplicate has the
same delayed-double-close hazard; a GC-owned duplicate would make stop depend on
GC. This SDK refuses that backend instead of adopting either workaround.

Mapping does not certify binary retention. Every effect-capable child or helper
must retain the description or use an approved fenced actuator. A child that
closes the descriptor can defeat advisory participation; unexplained resource
evidence must still refuse its cohort's retirement.

The child declares the capability when constructing `ChildRoleCustody`. Before
performing any role work, it calls `check(role, owner, generation)`, which defaults
to fence FD 7. The explicit descriptor argument remains a verification input,
not a parent-side mapping API.
Under the ledger mutex, the check:

1. Confirms the selected profile, committed active generation and running
   intent.
2. Verifies that the mapped FD is an owned 0600, single-link regular file with
   exactly the **durable ledger's device and inode**, and that its path still
   names that inode.
3. Requires a separately opened description to contend, then requires an
   idempotent exclusive-lock operation on the mapped description. A separately
   opened, unlocked FD on the right inode is not enough.
4. Sets and verifies FD_CLOEXEC on that descriptor. Deliberate next-hop mapping
   can pass the description again; an ordinary exec must not leak it to an
   independent server. This does not prevent inheritance across fork alone.
5. Revalidates the scope and returns a verification snapshot with
   `closeOnExec: true`, not an effect
   permit or a promise that later generations remain current.

A wrong inode, stale generation, missing capability or missing lock refuses
before role work. The child closes its reference on exit and never unlocks it.
Landing-side generation checks remain required after this initialization check.

**Do not await the child's check inside the parent's ledger scope.** The parent
returns its synchronous spawn handle and native birth observation, then releases
that scope. Child verification/readiness follows. Exact-process start
confirmation is not a declaration that the service has passed readiness. A
production adapter must not deadlock by making its in-scope observation wait
for a child that is waiting for the same ledger mutex.

A child's verified result is a carrier claim only once the parent controller
re-confirms its own retained fence after the child reports (its next lease scope
does this for free); a verified child whose parent cannot confirm is treated as
unknown and stopped through the ordinary landing-side gates.

### Reserved inherited context and verification lane

FD 4 reserves space for a later inherited-context contract. No format, credential
payload or context input is implemented here. A future reviewed extension must
construct and own the descriptor inside retained `spawnChild`, validate its
approved format/provenance before child work, and close it on every failure.
It must not accept caller FDs, arbitrary stdio mappings or raw handles. Context
and parent channel remain separate from the fence. Unknown command fields,
including attempted parent/context descriptor inputs, currently refuse.

A hosted mapped-spawn lane must use macOS and the exact audited Bun 1.3.14
revision. It must exercise FD-3 EOF guarding across ledger scopes and actual
custodian death, FD-7 identity/lock checks and CLOEXEC, explicit next-hop mapping,
uncooperative surviving carriers, low-numbered source collisions, spawn-failure
cleanup, GC after descriptor reuse, and the full start/retire/advance suite.
It must also run strict SDK typechecking, the execution fence, sanitized scratch
environments and survivor checks including zombies. A Linux lane or a Bun
1.3.13 refusal lane does not cover these Darwin mapping behaviors. No CI change
or hosted dispatch is part of this inactive SDK change.

## One cohort per generation

Under a selected profile, `begin(id, "start")` and `perform(id, "start", ...)`
admit at most one durable start intent per generation. The committed exclusion
proof and retained controller fence replace the pre-start Absence requirement.
The SDK still records the exact native birth and requires the matching owned
observation after spawn. This is not child readiness. The adapter must not wait
for child initialization while it holds the parent's ledger scope.

The intent consumes the generation even if command validation, spawn, birth
persistence or later confirmation fails. Retrying a completed request is inert;
another start intent in the same generation refuses. Reacquiring the same
generation's fence does not clear this history. Descendant observations and the
worker's `absence()` remain unknown where they were unknown before.

Ordinary `stop` and `restart` receipts refuse under a profile. The adapter uses
this explicit cycle instead:

1. Call `retireCohort(owner, role, generation, id, signal?)`. The default signal
   is SIGTERM; SIGKILL must be selected explicitly on the first call.
2. Retry the same call and ID on contention or incomplete exclusion evidence.
   A pending stop is not a stopped role. No timer grants takeover.
3. After retirement completes, call
   `advanceCohort(owner, role, generation, retirementId)` to authorize a restart.
4. Start once in the returned generation through `permit.spawnChild()`.

Retirement persists its intent and disables ordinary effect scopes before it
signals or closes any reference. An active role's desired state becomes stopped;
a draining handoff preserves its incoming running/stopped intent. It can request at most one signal through the
exact retained direct-child handle. The signal-attempt marker is durable before
the syscall. A lost acknowledgment never replays that syscall. With lost handle
custody, retirement sends no signal and never adopts a PID. There is no implicit
signal escalation. A surviving carrier that will not exit keeps the stop pending;
the SDK cannot promise to terminate a cohort after losing its handles.

The method never waits for child exit under the ledger mutex. It records an
exact exit when the retained handle has published one. It then closes only its
controller reference and attempts a new nonblocking exclusive lock on the
anchored inode, still under the ledger mutex. Other conforming controllers
cannot acquire in between. Any surviving carrier keeps the acquisition busy.
Acquisition also requires fresh resource, legacy, delegated-work and relaunch
evidence. A free fence alone never confirms the stop.

A completed stop receipt means **role effects are excluded**, not that every
process exited. Its `retirement.exclusion` preserves the distinct certificate,
including unproven descendants and surviving non-owners. Exact direct-child exit
is not mandatory when complete audited exclusion independently covers the role;
it cannot be reconstructed from a PID after host custody loss. A descriptor-
dropping direct child remains unknown unless the resource/legacy audit explains
it as an approved non-owner. No exit record is invented for that child.

Full retirement proof can settle an uncertain carrier-only start as
`error: "cohort_retired"`. Unconfirmed start effects become `state: "retired"`,
not successful start observations. This includes a crash between spawn and birth
persistence. Arbitrary pending mutation receipts without the SDK's carrier-start
marker still block. Generic `recoverReceipt()` cannot substitute Absence for a
retirement certificate.

Advance is a same-owner authority operation, not an operator-approved transfer.
It requires a completed retirement, no pending receipts, active ownership and
another fresh complete exclusion proof. The SDK fsyncs generation + 1 before it
retains the new controller reference. A draining handoff cannot be cancelled by
advance. Cross-owner transfer and the existing resume path keep their operator
grants. Advance does not spawn or reuse the old stop certificate. Its replay
returns the committed ownership without recreating lost effect rights.

The one-cohort hypothesis holds, but an in-generation restart does not: while the
controller keeps its own reference, a free-lock probe cannot exclude an escaped
carrier. That carrier also has the current generation. Closing the reference,
certifying retirement and advancing the generation are all required. Automatic
restart needs no new operator grant, but it still needs carriers to release and
the complete audit to pass. The cost is a full certification at retirement and
again at advance. The receipt and snapshot bounds still apply; retention below
removes the routine-restart lifetime budget.

## Open rollout obligations

No production inspector or coverage audit is supplied. Actual PTY, Caddy, Go
helper and LaunchServices descriptor retention remains unmeasured per binary.
A wrapper retaining an FD is insufficient if its child can act after wrapper
failure without carrying that FD. A custody-only child needs a retained handle
while its host lives; lost custody remains unknown unless the lifetime/actuator
coverage independently discharges it.

Prefer a non-owning menu that delegates lifecycle actions to the fenced
launcher. Do not invent a LaunchServices FD-transfer protocol here. Keep tmux
servers and agent computation independent; fence the runtime's role-specific
input, write and receipt boundaries instead of killing sessions to pass a gate.

Production rollout still needs legacy effect wiring, complete resource and
legacy inspectors, delegated-work contracts, shutdown/receipt integration,
crash-boundary tests, and reviewed storage retention/repair. Boot provenance and
the coverage definition of the compatibility floor remain operator policy.
Nothing in this contract authorizes a live handoff.


## Receipt retention and anchored-inode checkpoints

A successful `advanceCohort` removes this role's settled receipts through the
retired generation. It keeps the just-used retirement certificate, including
its persisted `nextGeneration`, until a later advance replaces it. The prune,
new ownership and replay marker persist together. A replay of that latest
advance returns committed ownership only, without another generation, proof,
spawn or acquired fence. An older, pruned retirement ID refuses; it does not
reopen its old generation. Other roles' receipts and all future generations
remain untouched. Any pending receipt in the generations to prune blocks
advance. The checkpoint never settles or drops pending work. `recoverReceipt`
still refuses retirement receipts; retirement remains the only settlement path.

After that advance snapshot commits, the controller drops its process-local
held-child entries for this role at or below the advanced-from generation,
including entries whose birth was never recorded. It defensively closes their
idempotent parent writers before forgetting the handles. Failed or pending
advances do not discard custody. A verified persisted advance replay completes
this cleanup after a lost acknowledgment, without touching the current or future
generation's child. Other roles' entries remain retained. Writer-close cleanup
is best-effort: a close error still deletes the entry and must not fail the
committed advance or prevent retention of the new generation's fence. A failed
close can leave its writer descriptor open until the host exits.

This is reference cleanup, not a kill, reap, adoption or new claim of process
absence. An already-started exact wait can finish; it is not canceled. The SDK's
ledger mutex prevents an active `recordChildExit` scope from racing advance.
After advance, the old generation fails ownership checks, and the new generation
cannot find the pruned old effect. Old-generation retirement also refuses before
consulting child custody. Controller shutdown closes parent channels by
iterating only entries still retained; discarded entries need no later lookup.

The global limits remain 256 receipts and 256 authorizations. Routine operation
with one start and one retirement per generation retains one retirement per
advanced role, plus the current generations' work, rather than two receipts per
restart forever. Grants are not pruned. Large live state, repeated failed
requests within one generation and repeated operator grants still have bounded
capacity; this is not an unbounded database or a recovery route for an already
exhausted older store. Restart frequency and backoff remain supervisor policy
above the SDK; advance grants authority, not a schedule.

Version-4 writes checkpoint when the next append would take the journal above
1 MiB. A single checkpoint snapshot may exceed that target, but never 16 MiB.
Version-1 stores keep the existing append-only 16 MiB limit. The SDK keeps the
same `custody.log` inode and its exclusive flock throughout these steps:

1. Write `checkpoint.prepare`, an exclusively created owned 0600 one-link file.
   It contains base64 images of the complete old chain and the new checkpoint
   root, the journal device/inode and a SHA-256 digest over those fields. Fsync
   the preparation file. An unpublished preparation is not authority.
2. Rename that sidecar to `checkpoint.pending`, then fsync the custody directory.
   No journal byte changes before this redo barrier succeeds. The rename is for
   the sidecar only; the authority/lock inode never moves or gets recreated.
3. Write the new root at offset zero of the already locked journal, handling
   short writes. Fsync it, truncate that same inode to the root length, then
   fsync it again. A torn overwrite does not have to be a prefix: recovery uses
   the independently durable redo image.
4. Unlink `checkpoint.pending` and fsync the directory before permitting any
   later append. A failure poisons the transaction; no effect follows a failed
   persistence acknowledgment.

On open, the SDK takes the anchored inode's exclusive flock before inspecting
redo. It checks sidecar ownership, mode, link count, size (at most 48 MiB),
identity binding, digest, both complete chains and the old-to-new sequence/hash
link. A valid unrelated later journal refuses stale redo. A torn journal is
replaced **in place** from valid redo, not reconstructed from process evidence.
Recovery re-fsyncs the redo file and directory before destructive IO, so a
previous failure just after rename is safe to retry. Recovery uses the same
write/fsync/truncate/fsync/unlink/directory-fsync sequence and can itself be
interrupted and retried. An orphan preparation is ignored on reads and safely
removed at the next checkpoint. Missing or replaced authority/lock inodes still
refuse even if redo exists. There is no timeout, PID adoption or lock stealing.

The checkpoint root preserves the global sequence and previous committed hash,
and hashes the next complete state as before. Its `checkpoint` base names the
discarded prefix's last sequence/hash. Subsequent records extend that root with
the same hash-chain rules. This retains verifiable suffix continuity, **not** the
discarded audit history. The temporary redo retains the full old chain only
until installation completes. Hashes detect corruption, not malicious rollback
by the trusted local owner; restoring old files remains outside the protocol.
The latest retirement and `nextGeneration` are ordinary snapshot data, so redo
replays a lost advance acknowledgment without inventing an effect outcome.
Version-2 and version-3 data cannot become a redo base or checkpoint root.

The crash fixtures inject faults before and after every filesystem boundary,
including redo recovery, partial writes and non-prefix torn pages. These are
filesystem-state simulations, not physical power-loss certification. Durability
still requires the existing host-local `fsync`/`flock` filesystem assumptions.
A torn ordinary append without published redo still fails closed; this work
does not implement general tail repair or open any production integration gate.

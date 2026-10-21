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

Only SDK ownership decisions consume this proof. It never becomes a worker
`Observation` or `Absence`. Old worker start/stop and recovery observation
semantics are not relaxed. Wiring a production drain/stop receipt to an
approved role-specific actuator remains a separate integration obligation.
A transfer replay returns no fresh certificate; it replays only the committed
owner transition.

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

**One-way store format:** a store staged with selected profiles writes state
version 2 from its first journal record. Absence-only stores remain version 1.
Older SDKs require version 1 and therefore refuse version 2 structurally instead
of silently ignoring an unknown profile and falling back to absence. Rolling
back such a store requires an approved artifact that understands version 2.
Do not edit a journal version or restore an earlier store to downgrade it.
Migrating an existing version-1 store to this profile is not implemented.

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

A trusted carrier adapter can obtain `lease.carrierDescriptor()` only inside an
active committed owner scope. This is mapping input, not another effect permit;
the actual spawn still belongs inside `EffectPermit.atEffect`. Deliberate
mapping and binary retention are the adapter's reviewed obligations. Existing
`spawnChild` is **not** silently changed to propagate an FD.

The child declares the capability when constructing `ChildRoleCustody`. Before
performing any role work, it calls `check(role, owner, generation, descriptor)`.
Under the ledger mutex, the check:

1. Confirms the selected profile, committed active generation and running
   intent.
2. Verifies that the mapped FD is an owned 0600, single-link regular file with
   exactly the **durable ledger's device and inode**, and that its path still
   names that inode.
3. Requires a separately opened description to contend, then requires an
   idempotent exclusive-lock operation on the mapped description. A separately
   opened, unlocked FD on the right inode is not enough.
4. Revalidates the scope and returns a verification snapshot, not an effect
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

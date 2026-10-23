# Pairing trust owner contract v1

The public runtime owns pairing trust persistence for one resolved pairing root.
Runtime pairing, retained desktop pairing, reconnect membership checks and the web
peer-delete route use this owner. A desktop identity module delegates to runtime;
it has no independent trust writer. Phone pairing is not operator-decision
entitlement. This mechanism introduces no host policy, input actuator, session
registry, authorization endpoint or automatic adapter installation.

## Public interface and compatibility

`@openscout/runtime/pairing-security/trust-owner` exports `pairingTrustOwner`,
`PairingTrustOwner`, `PairingTrustError` and the transaction types.

- `read(context?)` returns an owned snapshot of authoritative peers and the owner
  revision, with display-only advisory `lastSeen` values merged in memory.
- `mutate(expectedRevision, mutationId, mutation, context?)` publishes one grant,
  full-key revoke, or explicit managed adoption. A conflicting revision
  refuses. There is no automatic retry of a relative change.
- An exact mutation-ID/request retry returns the persisted original outcome,
  including after a later revision or a lost ACK. Reusing an ID with another
  request refuses. Keep the original expected revision when retrying an ID.
- `refresh(publicKey, lastSeen, context?)` validates current membership, then
  best-effort records display-only metadata in `trusted-peers.last-seen.json`.
  It refuses a missing/revoked key. Advisory I/O failure never fails the
  handshake. Handshake completion uses this check for existing peers, including
  `trustOnComplete:false` paths. A reconnect never changes the digest-covered
  projection or creates a generation. `lastSeen` is never an admission input
  or proof of current presence.
- `revokePrefix` resolves either the existing 16-character display prefix or a
  full 64-character key against the current snapshot. The persisted operation
  and outcome always name the full key.

**API behavior change:** `DELETE /api/pairing/peers/:fingerprint` returns **409**
for an ambiguous prefix instead of deleting all matching keys. Use the full
public key to select one peer. A missing peer remains 404. An unavailable store,
including a CAS/publication failure, returns 503 rather than a false success.

`trusted-peers.json` retains the `TrustedPeer[]` JSON shape. Successful publication
updates this file atomically; it is not a stale compatibility mirror. Existing
valid stores are adopted lazily on their first mutation, without an opt-in lock.
A read of a missing root is empty and creates nothing. Explicit mutation creates
an owner-controlled root if needed. New directories have mode 0700 and their
parent creation is synchronized. New files have mode 0600. Legacy peer files can
be readable by group/others, but must be owner-controlled, non-writable by them,
regular, single-link and non-symlink. Owner metadata and marker files require
0600 discipline. Invalid or unsupported state refuses instead of granting trust.

## Advisory last-seen file

`trusted-peers.last-seen.json` is separate from the authority chain and projection
digest. Its shape is `{schema: "scout.pairing-last-seen/v1", entries: [...]}`,
where each entry has a full `publicKey` and a parseable timestamp `lastSeen`.
It affects display and sorting only. The owner never uses this file for
admission, membership, grant or revoke, and never copies merged metadata into
an authority publication.

Reads merge entries only for current authoritative members. The later timestamp
wins between the projection and advisory file, with `pairedAt` as the grant-time
floor. Thus an old binary's newer projection timestamp still counts. A missing,
malformed, oversized or unsafe advisory file is ignored, never quarantined.
Non-member entries cannot restore a revoked key and are pruned on the next
successful refresh write. Writes contain at most one entry per authoritative
peer (4096 maximum), within the existing 1 MiB per-file limit.

The owner stages a new owned mode-0600 regular file, synchronizes the file and
replaces the advisory path by rename without following a destination symlink.
Reads reject symlinks, hard links, wrong ownership or group/other permissions;
they use nonblocking, no-follow opens. Broken or unsafe files can be replaced by
the next successful refresh. If staging, synchronization or rename fails, the
owner ignores that failure and cleans up its temporary file. No directory sync
is required for this file. A non-file obstruction can prevent replacement but
cannot make authority unavailable or fail a handshake.

Updates need no managed gate and remain **outside managed guarantees**. The
membership check still obeys the authority contract. Concurrent refreshes in
two processes can lose one advisory update. Crash or I/O failure can also lose
an update, so `lastSeen` can lag; the projection/grant timestamp remains the
floor. A concurrent revocation can leave a stale advisory entry, but reads
ignore it because it is no longer an authoritative member.

## Named on-disk delta: `scout.pairing-trust-owner/v1`

The same root gains immutable `trusted-peers.owner.<revision>.json` generations.
Each is an envelope containing a `generation` and its SHA-256 checksum. A
generation contains:

- schema, root identity (device and inode), and contiguous revision;
- hash of the previous generation's bytes (the legacy seed hash for revision 1);
- the complete peer array and the digest of its exact JSON projection;
- the managed marker value, or null;
- that revision's mutation-ID/request/outcome record, including full-key revokes;
- optional `adoption` hashes (`fromProjectionHash`, `toProjectionHash`) recording
  an unmanaged outside baseline used by this mutation, or null;
- `projectionStage`, the basename of the already-synchronized projection stage,
  in new envelopes. Completed older envelopes remain valid without this field.

The owner reconstructs deduplication from every immutable generation. It does not
copy the entire historical outcome map into each successive file.

Mutation outcomes are not pruned. The owner refuses at 65,536 generations, 1 MiB per
file, 128 MiB of generation bytes, or 4096 peers. There is no automatic compaction,
reset or age-based loss of deduplication. Capacity/recovery/migration must be an
explicit reviewed operation; deleting owner metadata is not a supported reset.
Only real trust mutations (grant, revoke, managed adoption) grow this chain.
**Named follow-up: authority-chain checkpoint/compaction**, with a separately
reviewed root/revision/dedup preservation protocol. It is not a merge gate.

There is no mutable head pointer and no new unmanaged cross-process lock.
A writer stages and synchronizes the peer projection and complete generation,
revalidates its baseline, then hard-links the generation to the unique next
revision name. `EEXIST` is a CAS refusal. Only that winner can replace the peer
projection by rename. The staging hard link remains until that rename, so a
reserved generation has two links and cannot be mistaken for a completed
unmanaged baseline. Generation reads tolerate two links, but require exactly
one matching protected staging alias; projections still require a single link.
After rename, the owner removes its staging link, synchronizes the parent
directory, verifies the committed chain and only then ACKs. An ID retry also
synchronizes the directory before returning its recorded outcome, so a prior
failed directory sync is not mistaken for a durable ACK.

### Pending publications and roll-forward

A pending generation retains its protected staging hard link and its
synchronized projection source, even if projection rename fails. The next
owner read, refresh or mutation helps finish this publication. Unmanaged
completion needs no new lock; managed completion runs under the operation's
already-held adapter gate. The owner validates the whole chain, root identity,
marker and gate context before attempting completion. Missing generations,
gaps, corrupt checksums, marker mismatch and ambiguous staging aliases still
refuse. Completion cannot bypass those checks or create a missing marker.

The owner encodes the head generation's peers and checks their hash against
`peersHash`. It also verifies the shared projection source's bytes against that
hash before rename. Original writer and helpers consume the **same** named
source by atomic rename. They never recreate a consumed source. Thus only one
rename can succeed, even if the original writer was merely slow, not dead.
A late writer treats `ENOENT` from that rename as another helper's completion,
verifies the current chain/outcome, synchronizes the directory and returns its
original outcome. It does not replay a mutation or overwrite a later revoke.
If another owner already advanced the head, the original writer verifies its
recorded outcome without rewriting the projection.

Older envelopes without `projectionStage` can recover from a unique retained
projection temp with the verified head hash. Absence or ambiguity with a
mismatched projection refuses; the owner does not guess or create an
uncoordinated replacement source. A new generation always binds its source
before reserving the revision and retains it on publication failure.

A pending stage is classified as `publication_incomplete`, not `unsafe_path`
or an outside-write diagnosis. Ordinary operations complete valid pending
work transparently. If completion cannot finish, or a reentrant observer runs
inside the rename, they refuse `publication_incomplete` without exposing an
old projection. A managed store with a changed projection **and no pending
stage** still refuses `external_change_or_incomplete` strictly. No ACK does
not imply rollback; no age-based takeover or process-liveness guess occurs.

An old binary can write the projection while unmanaged publication is pending.
Roll-forward overwrites that outside write with the reserved head's peers.
This is consistent with unmanaged mode's lack of outside-writer protection.

#### Manual completion

Retry an owner `read()` with the same pairing root to request completion; the
original mutation ID is not needed. A managed host must supply its existing
trusted adapter and hold the normal gate. An exact-ID/request retry also
finishes pending work and returns the original recorded outcome, without a
new generation. Do not remove a generation, marker or staging witness to reset
the store, and do not retry a relative mutation with a fresh expected revision
as a substitute for recorded-ID retry.

If `publication_incomplete` persists, preserve the files and stop all writers,
including old binaries, before manual repair. Under that proven quiescence
(and the managed gate where applicable), reviewed maintenance can validate the
root/chain/marker, reconstruct the exact projection from the head's peers,
verify its `peersHash`, stage/synchronize it, atomically replace the projection,
quarantine unusable projection-source temps if necessary (never the generation
witness), and invoke owner completion to synchronize the directory and remove
the witness. Never reconstruct a consumed source while a paused writer could
resume. Missing/corrupt authority evidence or marker mismatch needs separate
reviewed repair, not this projection-completion procedure.

Readers verify checksums, sequence, root identity and managed state. They refuse
a concurrent changed generation listing instead of combining snapshots. In
managed mode, projection-digest mismatch refuses strictly, without a watcher.
In unmanaged mode, a validated changed projection is the current baseline, as
specified below; it does not rewrite the existing owner ledger.

The file and directory barriers are actual synchronous filesystem `fsync`
operations. This is a specified filesystem publication model, not hardware
power-loss certification. Native bounded cancellation/durability qualification
for a host's combined authority-and-journal hold is a separate prerequisite;
this additive seam does not certify it. A JavaScript timeout cannot release a
host gate while an uninterruptible native operation continues.

## Root identity and external writers

All default call sites use `resolveOpenScoutPairingHome`: the supported
`OPENSCOUT_PAIRING_HOME`, `SCOUT_PAIRING_HOME`, `OPENSCOUT_PAIRING_DIR`, explicit
`OPENSCOUT_SCOUT_HOME/pairing`, and instance defaults have one path resolver.
The owner normalizes lexical/ancestor aliases, binds the root's device/inode,
and checks that identity around I/O. A final symlink root, symlink data file,
hard-linked data file, wrong owner, writable-by-others root/file or replaced
bound root refuses. Different roots have separate owners. Aliasing an ancestor
does not create a second owner; final symlink roots remain unsupported.

**Unmanaged mode offers no protection against outside writers**, as before.
During a mixed-version rollout, an older installed binary can normally rewrite
`trusted-peers.json` directly. Reads adopt that validated array as current peers,
without changing owner revisions or mutation-ID outcomes. The next owner trust
mutation derives from that array and records its baseline adoption hashes.
Deletion adopts an empty baseline; malformed or unsafe files still refuse.
The chain remains the owner's own CAS/deduplication ledger, not a quarantine
instrument for legacy projection writes. Owner callers get lost-update refusal
among themselves and full-key revocation. An outside writer can still lose an
update or resurrect a revoked key; unmanaged mode does not claim otherwise.

**Strict external-change refusal starts at managed adoption.** An out-of-band
active-file grant, revocation or deletion then makes the store unavailable;
it is not imported. Registration alone does not turn a root into managed mode.
The marker/generation pairing remains mandatory, so missing a marker cannot
downgrade an already managed generation into unmanaged adoption. Generation
checksums detect accidental metadata edits, not a hostile same-user editor
that forges the entire store and its checksums. This is not same-user sandboxing.
Detection cannot cancel an operation admitted before an external write.

**A managed marker cannot constrain an old binary that does not check it.**
Old binaries and raw editors are unsupported writers after managed adoption.
Detection is not exclusion. A consuming host must separately prove old-writer
exclusion before relying on gated admission. Do not copy an owner store to a new
root/inode as if its revision were valid there; root migration needs review.

## Dormant managed-store seam

The factory installs no adapter. Imports perform no filesystem or process work.
Unmanaged standalone operation uses CAS and needs no host package. Only trusted
bootstrap code can call `owner.register(adapter)` with typed function references.
There is no environment, request JSON, CLI flag, module-path loader or remote
provider registration route. Registration is not an untrusted-plugin sandbox.

An adapter identifies its supported protocol by a stable ID and implements
`withGate(root, body)` plus `currentHolder(root)`. It must acquire the native
cross-process gate for that canonical root and hold it until the callback
settles, including Promise results, with release on every exit. Synchronous
legacy writers require synchronous adapter acquisition; an adapter must not
pretend an async lock was acquired. The callback's holder object is checked by
identity against `currentHolder` at operation boundaries. The generic mechanism
cannot establish a dishonest adapter's native ownership; native qualification
belongs to the trusted host's separate evidence.

Managed adoption requires a registered adapter, an invocation context, expected
revision and mutation ID. It publishes the protected root-bound
`trusted-peers.managed.json` marker (`scout.pairing-trust-managed/v1`) and its
matching generation. It creates no operator entitlement. Adoption is explicit
migration; startup never performs it. Missing adapter, wrong adapter ID, unknown
marker protocol, missing marker/generation, mismatched root or partial adoption
refuses. No unmanaged fallback is permitted once the managed generation/marker
exists. Removing a registration does not remove the marker.

`withInvocation(body)` supplies an opaque context. It is non-serializable,
root/owner-bound, valid only inside that live invocation and its current gate
holder, and permits at most one new publication. An exact already-recorded ID
retry is not another publication. Captured contexts fail after return, in a
different concurrent invocation and in another process. Internal reads can
repeat; nested gate acquisition is unnecessary when a valid context is passed.
The adapter must preserve the host's authority-before-journal lock order.
Human approval and editor waits must occur outside both locks.

The full-key live-session transport registry and any cross-owner commit manifest
are not implemented here. A host's stronger multi-record transaction cannot be
inferred from this single-owner publication protocol.

## Verification

Run on a non-root account with adequate disk space:

```sh
bun test packages/runtime/src/pairing-security/trust-owner.test.ts \
  scripts/pairing-trust-owner-process.test.ts \
  scripts/pairing-trust-owner-census.test.ts
bun scripts/pairing-trust-owner-controls.ts /tmp/pairing-owner-evidence
bun scripts/pairing-trust-owner-census.ts
bun run sync-exec:fence
bun run check:presentation
```

The process suite coordinates two real processes without sleeps as an ordering
proof, tests reconnect storms (zero generations and unchanged projections),
current advisory timestamps, unsafe-file replacement, old-binary timestamp
merging, unmanaged adoption and managed refusal, ACK loss and publication
interruption. Crash tests recover both unmanaged and managed publications;
a two-process live-writer race proves a helper and later revoke survive the
original writer resuming. Real runtime and desktop Noise handshakes also complete through
injected advisory sync/rename failures. The suite instruments actual
file/directory barrier calls. Its instrumentation must observe operations; no-op
instrumentation fails. The negative controls use disposable mutated source
copies, not production switches or edits to the checkout. The source census
also tests a planted direct sink/default registration/adoption. It is an audit
of the known persistence routes, not confinement of arbitrary filesystem code.

## Explicit relay pairing

New relay grants use a single-use, root/room/baseline-bound local opportunity.
See [relay pairing opportunities](./relay-pairing-opportunities.md) for opening,
expiry, cancellation, reconnect behavior and the limits of pairing revocation.

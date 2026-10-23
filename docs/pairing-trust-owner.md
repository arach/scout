# Pairing trust owner contract v1

The public runtime owns pairing trust persistence for one resolved pairing root.
Runtime pairing, retained desktop pairing, reconnect metadata updates and the web
peer-delete route use this owner. A desktop identity module delegates to runtime;
it has no independent trust writer. Phone pairing is not operator-decision
entitlement. This mechanism introduces no host policy, input actuator, session
registry, authorization endpoint or automatic adapter installation.

## Public interface and compatibility

`@openscout/runtime/pairing-security/trust-owner` exports `pairingTrustOwner`,
`PairingTrustOwner`, `PairingTrustError` and the transaction types.

- `read(context?)` returns an owned snapshot of peers and the owner revision.
- `mutate(expectedRevision, mutationId, mutation, context?)` publishes one grant,
  refresh, full-key revoke, or explicit managed adoption. A conflicting revision
  refuses. There is no automatic retry of a relative change.
- An exact mutation-ID/request retry returns the persisted original outcome,
  including after a later revision or a lost ACK. Reusing an ID with another
  request refuses. Keep the original expected revision when retrying an ID.
- `refresh` updates only an existing peer's `lastSeen`. It cannot recreate a
  revoked key. Handshake completion uses refresh when the key was already
  trusted, including `trustOnComplete:false` paths.
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

## Named on-disk delta: `scout.pairing-trust-owner/v1`

The same root gains immutable `trusted-peers.owner.<revision>.json` generations.
Each is an envelope containing a `generation` and its SHA-256 checksum. A
generation contains:

- schema, root identity (device and inode), and contiguous revision;
- hash of the previous generation's bytes (the legacy seed hash for revision 1);
- the complete peer array and the digest of its exact JSON projection;
- the managed marker value, or null;
- that revision's mutation-ID/request/outcome record, including full-key revokes.

The owner reconstructs deduplication from every immutable generation. It does not
copy the entire historical outcome map into each successive file.

Mutation outcomes are not pruned. The owner refuses at 65,536 generations, 1 MiB per
file, 128 MiB of generation bytes, or 4096 peers. There is no automatic compaction,
reset or age-based loss of deduplication. Capacity/recovery/migration must be an
explicit reviewed operation; deleting owner metadata is not a supported reset.

There is no mutable head pointer and no new unmanaged cross-process lock.
A writer stages and synchronizes the peer projection and complete generation,
revalidates its baseline, then hard-links the generation to the unique next
revision name. `EEXIST` is a CAS refusal. Only that winner can replace the peer
projection by rename. It synchronizes the parent directory, verifies the
committed generation and projection again, and only then ACKs. An ID retry also
synchronizes the directory before returning its recorded outcome, so a prior
failed directory sync is not mistaken for a durable ACK.

A generation reservation without its matching peer projection is **unavailable**,
not an older permissive snapshot. Other writers cannot pass baseline verification
while publication is incomplete. If a process dies at that boundary, the owner
keeps the evidence and refuses; it does not steal a reservation or repair it from
an old file. After projection rename, a lost ACK can leave a committed mutation.
No ACK does not imply rollback. Readers verify checksums, sequence, root identity,
managed state and projection digest, and refuse a concurrent changed generation
listing rather than combine snapshots. No watcher is needed.

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

External edits/replacements of an adopted active file are unsupported. Digest
verification makes a grant or revocation edit unavailable; it does not import
that edit. Generation checksums detect accidental metadata edits, not a hostile
same-user editor that forges the entire store and its checksums. This is not
same-user sandboxing. There is no claim that detection cancels an operation that
was admitted before an external write.

**A managed marker cannot constrain an old binary that does not check it.**
Old binaries and raw editors are unsupported writers after adoption. Detection
is not exclusion. A consuming host must separately prove exclusion of old
writers before relying on gated admission. Do not copy an owner store to a new
root/inode as if its revision were valid there; root migration needs explicit
review.

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
proof, tests ACK loss and publication interruption, and instruments the actual
file/directory barrier calls. Its instrumentation must observe operations; no-op
instrumentation fails. The negative controls use disposable mutated source
copies, not production switches or edits to the checkout. The source census
also tests a planted direct sink/default registration/adoption. It is an audit
of the known persistence routes, not confinement of arbitrary filesystem code.

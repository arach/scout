# Pairing capsule cutover

`PairingTrustOwner.migrateToCapsule(migrationId, context?)` explicitly converts
one verified v1 store to v2. It is trusted local maintenance, not a phone/RPC
permission. Imports and normal startup do not initiate migration. A read can
help an already committed transition, as it can help an ordinary publication.

The result is `{migrationId, revision, logicalHead}` for the original cut.
An exact migration-ID retry verifies the durable receipt and current capsule,
then returns that original result without a trust mutation. Another ID refuses
after the root has migrated. This ID is separate from trust-mutation IDs.

## Before activation

1. Ship the v2-aware owner in **every first-party store opener in the same
   release train**: desktop app, CLI and web runtime. Do not ship the completed
   engine alone. Do not activate while an installed opener still needs v1.
2. Verify release provenance. Build the runtime with
   `bun run --cwd packages/runtime build`; its compiled output must contain
   `trust-owner.js`, `trust-capsule.js` and `trust-cutover.js`. Run the source
   census and `bun run test:pairing-capsule`. Test the emitted owner under the
   supported Node 24 runtime, not only Bun source imports:
   `node scripts/pairing-cutover-compiled-smoke.mjs`. The root unit chain builds
   the runtime and runs this version-checked witness too.
3. Check each consuming artifact's dependency lock/build manifest against that
   exact runtime release and package integrity. For a bundled desktop/web
   artifact, inspect its bundler resolution metadata: all pairing owner/identity
   imports must resolve to that runtime, not a copied owner. Verify the installed
   CLI uses the same package. The source census is supporting evidence, not
   proof that an old installed binary was updated. A consuming private build
   needs its own artifact evidence; public source tests do not certify it.
4. **Drain and stop all processes that open this pairing root**, including
   desktop, CLI and web runtime. Use each program's normal stop mechanism.
   Prevent old binaries, raw editors and pre-owner projection writers from
   resuming. This is a one-time drain/restart, not zero-interruption migration.
5. Keep at least 3 GiB free for pilot qualification. This observation is separate
   from the migration's real 320 MiB reservation. Preserve a diagnostic backup
   under quiescence if historical peer snapshots are needed. Backups are not
   live authority and cannot simply be loaded at another device/inode.

Managed deployments must also provide their existing trusted adapter and native
gate. The owner rejects a different observable live invocation or a holder that
does not match actual `currentHolder`. It cannot enumerate versions or detect
every foreign process. Native old-writer exclusion remains the consuming host's
obligation. A dishonest acquisition cannot override a truthful older holder.

## Perform the one-time cut

Run trusted bootstrap code **before any listener starts**:

```ts
import {pairingTrustOwner} from "@openscout/runtime/pairing-security/trust-owner";

const owner = pairingTrustOwner(configuredPairingRoot);
// Managed hosts register their existing typed adapter here. No module loader,
// environment adapter selector or phone-supplied callback is accepted.
owner.pairingAuthorityStamp(); // Explicitly initializes an empty root if needed.
const receipt = owner.migrateToCapsule(stableMigrationId);
// Persist the operation's ID/result in trusted maintenance records, then start
// only the verified v2-aware desktop, CLI and web runtime.
```

The caller must retain the original migration ID for ACK-loss retry. The method
requires an existing root; an ordinary read of a missing root remains empty and
creates nothing. Explicit stamp initialization above creates no grant.

Migration helps any pending v1 publication using its original consumable
projection source, then captures one coherent verified state. Advisory last-seen
data is not checkpointed as authority. The cut preserves every exact saved
request/outcome/full key, original revision, lifetime byte charge, permanent
managed policy, raw projection bytes and pending standalone adoption baseline.
The #117 authority stamp is byte-identical when authority did not otherwise
change. Migration does not canonicalize the projection or rewrite missing bytes
as `[]`.

## Reservation and publication

An exclusive `.pairing-cutover` directory claims the single migration budget.
Before bulk staging, the owner writes and fsyncs **320 one-MiB files** with
non-sparse, incompressible payloads and checks their allocated blocks. Staged
sources reuse those allocated files, truncate excess bytes and rename within
the claim. The claim, plan, inventory and authority sources all use this pool;
they do not allocate a second bulk copy beside a reservation. Payload storage
stays within 320 MiB, separate from existing authority and filesystem metadata.
Storage that cannot provide the required allocated extents refuses. Thin or
overcommitted storage is not a physical durability guarantee.

Private stages do not put v1 into capsule mode. After complete validation and
fresh baseline/holder checks, the exclusive hard link reserves **the exact next
v1 generation name** with an unsupported-v1 barrier. It competes with the real
v1 writer's CAS. A losing migration publishes no stale capsule and does not
retire the winner. A new attempt needs a fresh verified view.

The barrier authenticates the immutable plan and exact retirement inventory.
Its protected alias must be the same two-link inode. Helpers freshly validate
every outcome chunk, charge record, managed policy and inventory before any
retirement. They consume the single prewritten source for each capsule file by
atomic rename and never recreate it after `ENOENT`. Root synchronization makes
the barrier and capsule durable before retirement. Only inventory-named v1
files with matching inode, byte length and digest may be removed.

After retirement and another directory barrier, a helper consumes the
prewritten cutover receipt, synchronizes it, then deletes transition evidence
and releases the reservation. The permanent barrier and receipt remain.
Cleanup failure refuses readiness and further writes; a current membership
snapshot is not permission to bypass unfinished maintenance.

## Recovery and refusal

| Interruption | Action and invariant |
| --- | --- |
| Before migration CAS | V1 remains authority. Stages grant nothing. The abandoned claim is not reclaimed by age, PID or timeout. |
| Old writer wins the next name | Migration refuses and removes only its proven-owned uncommitted claim. Preserve the old winner; obtain a fresh view before another cut. |
| Barrier reserved, sync/verification incomplete | V1 reader/writer refuse. A v2 read completes from the exact retained sources or refuses. It never serves the old projection as fallback. |
| Barrier durable, retirement partial | V2 validates the complete capsule and inventory, then resumes exact authorized retirement. It never merges the remaining v1 prefix with v2 rows. Listeners remain stopped until ready. |
| Capsule, witness or inventory absent/corrupt | Refuse and preserve evidence. Do not reconstruct missing evidence from current peers, watcher state or process disappearance. |
| Retirement complete, ACK lost | Retry the same migration ID. Verify receipt, root, current capsule and directory barriers. Do not create another logical generation. |
| Paused v1 writer resumes | Its CAS loses or its old verifier refuses the barrier/gap. It cannot recreate a consumed projection source to overwrite a later revoke. |

After a committed barrier, retry a normal owner read or the exact migration ID
with the same managed adapter. If evidence is missing or corrupt, preserve it
for reviewed repair; do not delete the barrier, reset counters or start old
binaries. A receipt does not allow skipping failed resource cleanup.

For an **uncommitted** abandoned claim, prove all writers stopped first and
preserve the complete file inventory. Confirm the real v1 reader still verifies
the contiguous store and no committed barrier exists. Only then may reviewed
quiescent maintenance move the entire private staging directory outside the
active root, retain it as evidence and retry from a fresh view. Do not do this
after a barrier has won. The runtime provides no automatic takeover or
uncoordinated discard API.

## Inherited limits and qualification

Pre-owner raw-projection writers are **not excluded** by the cut. Standalone
adoption remains unchanged and can import an outside grant or revocation.
Managed mode detects projection changes but still needs real old-writer
exclusion. Checksums do not prevent a same-user editor from forging the whole
root, and neither format supplies a durable anti-rollback anchor.

Historical peer snapshots are retired, not freshly replayed on admission.
External archives are diagnostics; their hashes do not prove unread bytes.
All retained outcomes and current authority are freshly read and verified.

The process suite pins the byte-exact v1 owner, interrupts every table row,
tests both CAS outcomes and paused old writers, measures actual reservation
extents/barriers, and checks source mutations against healthy fixtures. The
read gate must run on **real migrated stores** at both tiers/Buns, three fresh
processes each, with every 100 warmup and 1000 timed sample retained. This does
not certify native deadlines/power loss, registry admissions/idle CPU, transport
close codes, credentials or physical phones.

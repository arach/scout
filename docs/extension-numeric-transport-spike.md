# Numeric extension transport candidate

This is measurement apparatus, not an enabled extension backend. The context
backend still refuses everywhere; API 1 is unchanged. No credential capability
is added. Qualification belongs to review of an exact transport, Bun revision
and platform, never a semver range.

## Candidate ownership

`scripts/extension-numeric-spike/pair.ts` creates a POSIX pipe for the simplex
context (child target 5), and an AF_UNIX/SOCK_STREAM socketpair for duplex
credentials (child target 6). It uses the shared inherited-descriptor registry.
Both endpoints are marked CLOEXEC and duplicated to marked copies above
`MAX_INHERITED_DESCRIPTOR_SLOT`. Raw endpoints and temporary low copies close
synchronously before return. Allocation and marking are not atomic: as with
the existing carrier, a trusted host must exclude foreign native fork/exec
through that preparation interval. This is not an untrusted-host guarantee.

The parent owns two raw numbers, with idempotent close functions. Spawn borrows
the child source by number; the parent checks that spawn did not consume it,
then closes its copy immediately, before any await. No parent endpoint is
wrapped in a Node socket, FileHandle or Bun file object. The child owns only its
mapped endpoint. Parent I/O uses raw descriptors; its explicit close is the
only intended parent-side close. The pipe provides only context delivery; the
socketpair additionally carries the child's request back to the parent. Both
forms test actual EOF after closing the parent endpoint, not just successful
frame delivery.

Why native allocation: Bun's extra `"pipe"` allocation is the rejected shared
owner; wrapping another Bun-owned descriptor does not remove that owner.
Runtime-created raw descriptors let us test numeric pass-through without adding
a competing JS stream owner. These are platform-specific libc FFI calls, not a
new claim that numeric descriptors work on every Bun version. Numeric 1.3.13
remains ruled out. Linux here means a glibc candidate, not musl qualification.

## Instrument

`witness.ts` shares the corrected in-tree fresh-file reclaim instrument. Each
form performs eight sequential EOF exchanges, requires the second spawn to
reuse an earlier number, and challenges that active replacement channel with
GC. It also performs a ninth, reap-first exchange: the parent endpoint stays
open through reaping and native subprocess collection, then closes explicitly.

A temporary Bun.spawn observer stores only WeakRefs to the actual native
subprocesses, restoring Bun.spawn immediately after each synchronous call.
Collection must be observed for all nine objects. The last numeric source is
reclaimed by fresh regular files BEFORE requiring that collection, while the
parent endpoint remains open. Thus neither an uncollected native object nor a
close occurring before a victim exists can silently qualify the candidate.
The parent and source numbers are reclaimed again after explicit parent close.
File kind, device and inode are checked after every GC round, and cleanup closes
only identities that remain owned.

The optional collection observer extends the existing instrument from its
unchanged default eight rounds to a bounded 8–64 rounds, keeping the SAME fresh
victims open throughout. GC count alone is not evidence of object collection.
An intentionally retained native object must fail this observation. This
retention exists only in an isolated negative control, never the candidate.

The permanent `extension-numeric-spike.test.ts` runs both forms on exact Bun
revision `0d9b296af33f2b851fcbf4df3e9ec89751734ba4`, on candidate Darwin/Linux
hosts. Other revisions skip these measurements, not the product refusal.
`extension-context.test.ts` repeats both forms after the real context tests in
the same process and retains the final fresh-descriptor sentinel.

Each form has isolated negative controls: close a reclaimed number twice;
close the replacement spawn's active endpoint; close the still-owned endpoint
after reaping; map the wrong child target; keep the parent writer open instead
of delivering EOF; actually clear CLOEXEC; and retain the native subprocess so
collection cannot be observed. Each must fail its named assertion.

## Reproduce serially

From an installed Bun workspace, using the exact candidate revision:

```sh
bun scripts/extension-numeric-spike/witness.ts context
bun scripts/extension-numeric-spike/witness.ts credential
bun test packages/cli/src/cli/extension-numeric-spike.test.ts
bun test packages/cli/src/cli/extension-context.test.ts
bun test packages/cli/src/cli/extension-descriptor-witness.test.ts
```

Run one file set at a time. Every generated home is small, synthetic, and removed
in `finally`. No broker, services, grants or real credentials are used. No hosted
workflow is dispatched by these commands.

## Proposed production change, after review

Move the reviewed pair/owner preparation into a dormant transport module, not
into the pure registry or role-custody's Darwin gate. Keep the context and
credential gates distinct and closed until each slice is separately reviewed.
A bounded asynchronous raw-descriptor I/O layer is still required before runner
integration: this spike's tiny synchronous read/write exchanges are NOT a
production implementation of timeout, cancellation or 64-KiB backpressure.
That layer must not introduce a second closing stream owner; any native helper
or adapter it adds must be remeasured by the same witness. Provider-side close
before descendant launch remains part of the invocation contract.

Do not qualify a different Bun revision or Linux from the Darwin measurement.
The Linux operator should run the same product-free commands from the evidence
branch and route the resulting exact revision/platform record for review. No
pin change, registry release or gate edit follows automatically from green tests.

The later [dormant asynchronous candidate](./extension-channel-async-io.md)
implements bounded raw I/O and describes its separate evidence and deployment
gates. The old apparatus's Linux record does not qualify that new adapter.

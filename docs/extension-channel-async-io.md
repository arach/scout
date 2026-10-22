# Qualified extension channel I/O

Context-only delivery uses the [qualified host facade](./extension-channel-host.md)
on its exact runtime coordinates. The facade adds fixed artifact verification.
The adapter and C shim remain byte-identical to their qualified tuple. API 1 is
unchanged; credential delivery remains disabled. Transport qualification does
not authorize credential policy or a new runtime coordinate.

## Ownership and native boundary

`packages/runtime/src/extension-channel-io.ts` owns raw numbers. The companion
C source contains stateless fixed-ABI syscall wrappers: no descriptor globals,
heap owners, asynchronous callbacks or FD finalizers. The C compiler/library
wrapper owns executable code, not channel descriptors. A separate reclaim test
drops that cache after all endpoints close, observes wrapper collection while
fresh files occupy the old numbers, and checks those identities. Its negative
control retains the wrapper and must refuse collection evidence.

The helper is lazily compiled from one reviewed module-relative C asset using
[Bun's embedded C compiler](https://bun.sh/docs/runtime/c-compiler). This avoids
misdeclaring variadic `fcntl` calls as fixed-arity FFI on Darwin arm64. The native
compile fence admits only that source URL, with no flags/library/include/define
or dynamic-source overrides; existing `dlopen` policy remains enforced.
Compilation/header/asset availability is a deployment requirement, not assumed
from a successful source test. Failure occurs before channel allocation and is
reported as `native_unavailable`.

The factory creates a pipe for context target 5, and an AF_UNIX stream socketpair
for credential target 6. Linux uses `pipe2(O_CLOEXEC)` and
`socketpair(SOCK_CLOEXEC)`, not create-then-mark. Both platforms duplicate with
`F_DUPFD_CLOEXEC` above the shared registry ceiling, so even copy creation is
atomic with respect to CLOEXEC. See [pipe2](https://man7.org/linux/man-pages/man2/pipe2.2.html)
and [F_DUPFD_CLOEXEC](https://man7.org/linux/man-pages/man2/F_DUPFD.2const.html).
The parent endpoint alone receives O_NONBLOCK; the child's source stays blocking.
Raw originals close synchronously, and the caller closes its borrowed child
source immediately after numeric spawn. No Node socket, FileHandle, Bun.file,
stream adapter or worker receives ownership of the parent endpoint.

Darwin still has a create/mark interval. The trusted host must exclude foreign
native fork/exec during preparation; this is not an untrusted-host guarantee.
The helper also checks that SIGPIPE is ignored before allocation, as in the
measured Bun host. It changes no signal disposition. A trusted host must not
reset that disposition while channels are active. A different signal policy
refuses instead of risking process death on a broken pipe.

## Bounded operations

- A descriptor permits one reader and one writer concurrently, never an
  unbounded operation queue. A second reader/writer refuses and terminates it.
- Each write snapshots at most 65,536 bytes. A reader has one fixed 65,536-byte
  frame buffer. At most 128 KiB is held by simultaneous I/O, excluding buffers
  retained independently by callers. Returned frames do not reference an FD.
- Each turn performs at most four nonblocking syscalls of at most 4,096 bytes.
  Partial results and EINTR preserve progress; EAGAIN waits two milliseconds.
  Exhausting the syscall budget yields to the event loop even with continuous
  progress. There is no blocking poll or worker blocked in read/write.
- Default operation timeout is 2 seconds; permitted explicit deadlines are
  1–60,000 milliseconds. Timer scheduling is not a hard real-time guarantee.
- The reader accepts one LF-terminated frame including LF. Empty EOF closes and
  returns null; truncated EOF, oversize frames and bytes after LF in a read
  refuse. There is no hidden trailing-frame queue.
- A completed write leaves the endpoint open. The lifecycle owner explicitly
  closes after the context frame to produce EOF, or keeps a credential endpoint
  open for the next framed exchange. This is not a half-close API.

Timeout, AbortSignal cancellation, syscall failure, malformed input and parent
close all converge on one terminal close. State becomes closed BEFORE the close
syscall; pending timers are disarmed and waiters rejected. Every resumed turn
checks state before any syscall. Close is idempotent and never retried after
EINTR, because the number may already have been recycled. Child cleanup remains
the future runner's responsibility; this module owns descriptors, not processes.

## Evidence matrix and limits

The earlier transport apparatus at `5f21507d` was cleared by Fable on Darwin
arm64 and Linux glibc x64 at exact Bun revision
`0d9b296af33f2b851fcbf4df3e9ec89751734ba4`. Linux run
[39737198387](https://github.com/arach/scout/actions/runs/39737198387) is that
apparatus's record, NOT execution of this new C helper or asynchronous adapter.
The new factory refuses other revisions/platforms before native loading.
Bun 1.3.13 remains refused; pure injected-driver tests still run there.

`scripts/extension-numeric-spike/witness.ts` accepts `none async [mode]` after
the form. The async candidate replaces the blocking parent exchange body with
the actual module's reader/writer, preserving all eight exchanges, the required
second-spawn reuse, the ninth reap-first exchange, source/parent fresh-file
victims, native collection observation and all seven original negative controls.
It additionally tests timeout, mid-write cancellation, and child crash on both
forms; credential read-timeout/read-cancel modes exercise partial incoming
frames. A cancellation-path stale second close targets the reclaimed PARENT
number, not merely the child's former source number.

Normal/socket modes keep the completed 4-KiB test primer and delayed reader.
Context timeout/cancel modes instead hold the child on a standard-input control
pipe. Before granting any reads, the parent fills the actual numeric context
pipe with <=4-KiB raw writes until EAGAIN (bounded by a 1-MiB test-only primer).
The child then consumes exactly 4096 primer bytes, acknowledges that quota, and
holds again. Only now does the layer start its unchanged 64-KiB timed write.
That write must transfer exactly 4096 bytes and encounter EAGAIN before the
reader is released. Cancellation/timeout must close once; only afterward can
the child drain the remaining primer/partial frame and observe actual EOF.

This is bounded instrument data, not a context protocol or layer frame-limit
change. No application writes are queued, and no new numeric-descriptor wrapper
is created. Capacity is measured rather than assumed: on the measured Linux
pipe, 65,536 bytes fit when empty, but the existing 4096-byte primer leaves only
61,440 bytes for a frame. The old 200-ms reader sleep could expire during parent
GC/setup checks, so a larger pipe alone did not explain the missed aborts. The
causal reader gate removes that elapsed-time assumption. Linux capacity varies;
see the [Linux pipe documentation](https://man7.org/linux/man-pages/man7/pipe.7.html).
Normal completion still requires actual EOF. Reader-abort modes and the cold
no-DFG lane are unchanged: read 8 KiB without LF before closing, then require
all nine wrappers collected and all reclaim checks clean.

The async witness observes native wrapper collection with FinalizationRegistry
notifications, then checks WeakRef disappearance once. It does not repeatedly
dereference targets during GC polling, which can itself keep them alive. Fresh
victims remain open throughout the unchanged bounded 8–64 collection window.
This observes entry into the hazard window; it does not claim that wrapper
collection proves a particular native finalizer ran. A retained-native control
must still fail. Collection failures are diagnostic refusals, never passing
transport evidence; `collection-incomplete` reports missing observations.

The after-context test repeats both normal full async forms after context work,
and the existing final fresh-FD sentinel follows it. Separate pure tests cover
partial writes, input snapshots, reader limits, malformed/empty EOF, operation
queue refusal, timeout/cancel on both directions, and no syscalls after close.

## Serial commands and remaining integration gates

```sh
bun test ./packages/runtime/src/extension-channel-io.test.ts
bun test ./packages/cli/src/cli/extension-async-io.test.ts
bun test ./packages/cli/src/cli/extension-context.test.ts
bun scripts/extension-numeric-spike/witness.ts context none async
bun scripts/extension-numeric-spike/witness.ts credential none async cancel
bun scripts/extension-numeric-spike/witness.ts credential none async read-timeout
bun test ./scripts/check-native-compile-fence.test.ts
```

## Read-timeout completion: two measurement lanes

Darwin retainer diagnostics classify the cold discrepancy as a VM CodeBlock
pin, not a descriptor owner. Disabling only DFG removes the pin. Qualification
still awaits the completion record and execution of this implementation on
Linux; no product gate is changed by this note.

Keep both lanes, with the same witness and unchanged collection/loss bounds:

1. Full-JIT warm matrix: all modes, both forms and every sensitivity control run
   in `extension-async-io.test.ts`. Do not disable DFG for that matrix.
2. Cold read-timeout: a NEW process runs
   `BUN_JSC_useDFGJIT=0 bun scripts/extension-numeric-spike/witness.ts credential none async read-timeout`.
   All eight read-timeout exchanges plus reap-first must complete with all nine
   wrappers observed collected. This flag is instrument configuration only,
   never a product setting or native-retention workaround.

Every mode must pass the whole witness in at least one configuration with
observed collection. A cold full-JIT refusal is acceptable as a CLASSIFIED
record only when every loss check reached is clean and a retainer diagnostic
proves the survivor is held exclusively by VM code-cache roots, not by witness
or adapter objects. Warm green totals alone cannot satisfy that rule.

Independent and restacked cold snapshots show the same shortest path:
`FunctionCodeBlock -> JSLexicalEnvironment (this) -> ChildProcess -> #handle -> Subprocess`.
Disabling only DFG releases all nine wrappers in the same cold witness. The
subprocess has exited; the surviving wrapper's finalizer has no opportunity
while it is pinned. This explains an incomplete hazard window, not a lost FD.

For a refusal-only diagnostic, set `SCOUT_DESCRIPTOR_HEAP_SNAPSHOT` to an owned
local path before the cold full-JIT command. The witness still exits 1; after
refusal it yields a fresh macrotask before taking a snapshot, so the last
WeakRef observation does not supply a job-local pin. Then run
`bun scripts/extension-numeric-spike/walk-retainers.ts <snapshot>`.
The walker validates Inspector-v3's FOUR-field node layout, excludes the
Subprocess prototype and WeakRef's internal non-retaining target edge, and
exhausts the remaining ancestor graph. Custom properties/registry held values
are strong and remain traversable. Unexpected formats or non-VM roots refuse
classification. Synthetic sensitivity cases cover those distinctions. Heap
snapshots can contain private process material: retain locally and inspect
before sharing; no snapshot is committed or uploaded automatically.

The CI checks job has an independent no-DFG cold step, scoped to that step only,
beside the existing full-JIT unit matrix. The operator dispatches the same
`ci.yml` workflow on the exact restacked async branch head. No workflow is
executed by this source change. The cold step runs immediately after dependency
installation so an unrelated later suite failure cannot hide that record.

The two transport lanes have a qualification ruling; the host and activation
remain separately reviewed. Activation evidence must cover compiler/header
behavior, source/ESM/unpacked assets, runner cancellation and cleanup on each
exact supported coordinate. Historical apparatus runs alone are not host
qualification. No package release, merge or hosted dispatch is automatic.

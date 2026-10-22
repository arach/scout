# Dormant extension channel I/O candidate

This is source-level candidate code, not an enabled context or credential
backend. No runner imports it, no public package export is added, and the
existing context gate still refuses everywhere. API 1 is unchanged.

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

The test child deliberately delays draining. A completed 4-KiB pressure primer
precedes the 64-KiB frame, forcing backpressure even on kernels that grow a pipe
to hold an entire frame. This is test-only wire data, not a context protocol
change; no two writes are queued. Normal completion still requires actual EOF.
Timeout/cancel cases must transfer a strict partial frame, close once, and let
the child see EOF. Reader-abort cases must read 8 KiB without LF before closing.

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

The local full matrix passes 28 tests, including read-timeout. However, a cold
standalone credential read-timeout run repeatedly refuses collection evidence:
wrapper 1 is still observable after 64 rounds, although every sampled fresh-file
identity survives. The reason for the warm/cold difference is unresolved. A green
warm run is not a mechanism-level explanation and does not erase the refused
record. This candidate is not qualified for integration.

The current local measurement, including that refused collection observation,
is recorded separately in the lane's review report. Do not infer a green matrix
from this design description. Before integration: obtain Fable's ruling on the
new evidence, resolve any inconclusive mode, measure this exact implementation
on Linux under separate operator authorization, verify compiler/header behavior
on supported installations and frozen source/ESM/bundled artifact paths, and
review runner cancellation/child cleanup. No package release or gate change is
automatic. No CI dispatch, merge or retarget is part of these commands.

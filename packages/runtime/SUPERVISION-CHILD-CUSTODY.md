# Staged current-owner direct-child custody

## Result and release gate

This slice records a direct child's native birth and exact exit. It does **not**
prove the whole role absent after a start. Descendants and current-owner
listeners, registrations, jobs and restart sources still lack complete coverage.
The default remains refusal. No daemon, app supervisor or launcher selects this
adapter. Production readiness and P1 rollout remain closed.

The native adapter supports only the audited Darwin Bun revisions for 1.3.13
(`bf2e2cecf27e800962b1e7f03d66278f9d5d2e79`) and 1.3.14
(`0d9b296af33f2b851fcbf4df3e9ec89751734ba4`), arm64/x64. Node, Linux,
other architectures and other revisions refuse with
`child_custody_backend_unproven`. `directChildCapability()` describes a backend,
not ownership, enrollment, readiness or an approved release floor. The operator
still supplies the floor and rollback window.

## Why this custody is conditional

A direct child that has exited but has not been waited for retains a kernel
process-table entry. Reaping removes that entry and releases its PID for reuse.
The [Darwin exit manual](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/_exit.2.html)
and [wait manual](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/waitpid.2.html)
describe that parent/child relationship. This is not a PID-file lease.

The source audit found this ordering in both supported Bun revisions:

- [`Subprocess.tryKill`](https://github.com/oven-sh/bun/blob/bf2e2cecf27e800962b1e7f03d66278f9d5d2e79/src/bun.js/api/bun/subprocess.zig)
  checks terminal process status before delegating to the native signal call.
- On Darwin, [`Process.waitPosix`, `onWaitPid` and `onExit`](https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/src/runtime/api/bun/process.zig)
  reap and publish terminal status on the event-loop thread, before JS exit
  notification. Our handle supplies no user exit callback, pipes or IPC that
  can re-enter JS in that interval. `RetainedChild.signal` also checks terminal
  status synchronously before the handle call. It never waits between them.
- Therefore, under the sole-reaper condition below, JS either signals an
  unreaped direct child or sees terminal status and sends no signal. A late
  `exited` promise does not reopen that interval.

This is a source-based safety argument, backed by an owned-child Darwin test,
not a claim that every Bun backend is safe. The Linux waiter-thread fallback
reaps on a background thread and queues main-thread status publication. The
native signal implementation uses `kill(pid)`, not `pidfd_send_signal`. We infer
an unprotected interval on that backend; we did not force or observe an actual
wrong-PID signal. This slice consequently refuses **all** Linux backends until
a separately reviewed protected implementation exists. See the corresponding
[1.3.13 process implementation](https://github.com/oven-sh/bun/blob/bf2e2cecf27e800962b1e7f03d66278f9d5d2e79/src/bun.js/api/bun/process.zig).

**Adapter obligation:** this process must be the sole reaper of these children.
Do not install a foreign native wait loop, SIGCHLD auto-reaping disposition or
other native code that reaps them outside Bun's audited event loop. Construction
does not prove that deployment property. An integrated release must review and
pin the actual custody host before enabling this adapter. A generic Bun handle
or the numeric PID of an adopted process does not meet the contract.

## Effect, birth and exit ordering

The existing custody lock, owner, generation, request and effect nonce remain
canonical. The SDK adds an optional fourth constructor argument,
`{ enableAuditedDirectChildren: true }`. Without that explicit opt-in,
`spawnChild` refuses. Imports and construction perform no native or lifecycle IO.

Inside a start `perform` callback, use `permit.spawnChild(command)` **instead of**
wrapping a separate spawn in `atEffect`. This consumes the same single synchronous
effect admission:

1. The SDK has already fsynced the start intent and random effect ID.
2. The SDK spawns its own direct child with an explicit absolute executable,
   cwd and environment. It supplies ignored stdin/stdout/stderr, no shell and
   no IPC. This is a narrow custody primitive, not a general worker runner.
3. Before yielding to the event-loop reaper, it samples native UID, boot,
   start-time and executable evidence. An already-reaped or unsampleable child
   refuses birth proof. Its retained handle is not discarded.
4. It fsyncs `effect.directChild` (`bun-darwin-direct-child/1`), binding that
   sample to the exact instance, role, generation and effect. Only then does it
   return a detached `ExactChild`. Subsequent owned observations must match it
   field for field, including during recovery.

A crash after the syscall and before the birth append leaves the original
intent uncertain. No later reader can synthesize the missing native record.
A crash after the birth append and before observation leaves a recorded birth
but no exit. Neither case authorizes replay or adoption.

Inside a stop `perform` callback, `permit.signalChild("SIGTERM" | "SIGKILL")`
signals only the process-local handle retained for the previously confirmed
child. No raw handle escapes and there is no `kill(pid)` fallback. The SDK
checks the current owner/effect scope at the actual signal boundary. A reused
PID cannot be adopted by changing a sample, birth string or effect ID. Calls
with lost handles refuse `child_custody_lost`. Terminal handles are inert.

`await lease.recordChildExit(startEffectId)` waits on that same retained handle,
requires a real terminal exit/signal status, then fsyncs the exit into the birth
record under the existing custody lock. Wait errors are not exits. Repeating a
persisted exit is inert, including after a store reopen. A lost exit append is
not durable proof. The custody scope can remain busy while the wait is pending;
this does not authorize another owner to steal it. There is no deadline-based
release, detached handle or PID adoption.

Owner-process death loses the in-memory handles. A restarted owner can read a
previously persisted exit but cannot signal or reap through a serialized birth
record. It returns unknown unless independent, separately reviewed recovery
coverage discharges that obligation. This slice provides no such adoption API.

## How the absence gate changes

`lease.childCoverage()` accounts for **every** current-generation start effect,
including starts recovered without a child. It returns counts and one reason:

| Evidence | Result |
| --- | --- |
| No start attempts | `no_starts`; legacy bootstrap inspection can continue |
| Any start lacks a bound native birth | `unknown`, `current_owner_birth_unproven` |
| All births recorded, any direct exit missing | `unknown`, `current_owner_exit_unproven` |
| Every direct exit recorded | `unknown`, `current_owner_descendants_unproven` |

The legacy inspector uses this accounting instead of an unexamined start-count
boolean. It still cannot lift the P1-birth gate in this slice. Direct-child exit
is necessary, not sufficient. No new source callback can assert a boolean
"descendants gone". A complete current-owner resource inventory, retained source
barriers and descendant proof must be reviewed before any row can become absent.
Old legacy resources and advertisements still require their own discharge.

On macOS, a process group does not cover escaped/reparented descendants and there
is no subreaper contract here. A primary process exit, SIGKILL acknowledgment,
closed listener or empty process scan cannot stand in for that missing proof.
Reverse handoff and production replacement starts remain gated.

## Consumer changes and verification

A future owner adapter must use `spawnChild` at birth, retain the same SDK host
for signals/waits, call `recordChildExit` with the **start** effect ID at exit,
and use `childCoverage` only as diagnostics. It must still return the existing
worker `absent | occupied | unknown` result based on full role evidence. No
request ID, role generation, pending-receipt API, authorization or worker enum
changes. Do not use this primitive for detached apps, LaunchServices, daemons or
processes started by another parent. A launcher port and a real worker-stdio
integration remain separate work; nothing requires a running consumer to adopt
this API in this slice.

The new tests pin signal-before-reap, terminal status before promise settlement,
wait failures, exact birth/exit persistence, stale-handle refusal, and a crash
between the effect and its observation. The native Darwin test blocks only its
own test event loop, observes its own unreaped zombie with `PROC_PIDTBSDINFO`
(arg=1 includes zombies), signals the retained child and waits for its exact
exit. [XNU's query implementation](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/proc_info.c)
explains that diagnostic argument. The deterministic reap-window test reuses a
**modeled** PID with a new handle; it does not claim forced kernel PID reuse.
The reconstruction test models parent-state loss without orphaning a fixture.
All spawned fixtures exit on a bounded timer and no installed service runs.

The execution fence now inventories spawn and the scoped custody signal sites,
including pre-existing fixture cleanup. No new native library is loaded; the
queued general `dlopen`/fixed-library-path fence remains separate. There is no
native build, lifecycle discovery, automatic enrollment or production selection.

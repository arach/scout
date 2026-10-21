# Staged native process evidence

## Scope and order

This is the first read-only native evidence slice for the
[R0/P1 custody contract](SUPERVISION-HANDOFF.md). It samples one explicitly
selected PID on macOS. It does not complete the native absence/custody gate.

Build evidence before legacy effect wiring. The existing runtime's
`readProcessIdentity` uses a shell `ps` result, and its recorded-PID lookup
is specific to the mesh bridge. Neither is a protected native custody handle.
Routing app effects through the durable ledger cannot supply missing process,
job or exit evidence. Storage retention is independent and remains open.
This slice does not replace either existing helper or wire a real app effect.

The new `createProcessEvidenceReader(instance)` export is additive to
`@openscout/runtime/supervision-handoff`. Construction validates an explicit
selected instance. It creates no files, loads no system library and reads no
process. No daemon, host, route or launcher constructs it automatically.
`productionHandoffReadiness()` and the SDK handshake remain closed.

## Read-only API

```
reader.sample(pid)
  -> { state: "sampled", sample: ProcessSample }
   | { state: "pid_absent", pid }
   | { state: "unavailable", reason }

reader.compare(recordedSample)
  -> { state: "same_sample" | "different_sample" }
   | { state: "pid_absent", pid }
   | { state: "unavailable", reason }
```

A sample includes format `darwin-bsd-process/1`, selected instance, PID,
effective UID, boot-session UUID, kernel start seconds/microseconds as decimal
strings, and the kernel-reported executable path. It does not include argv,
environment, executable content hashes, code-signing identity or a process
handle. Keep samples private to the local adapter; executable paths can identify
local installations. This library does not log or persist them.

A same-sample comparison is a read result, **not ownership or proof of life**.
A zombie can still have a kernel process record. PID reuse, a new boot, changed
birth metadata or a different executable produces different/unavailable
evidence. None of these results grants permission to signal a PID.

`pid_absent` means only that the initial native lookup returned `ESRCH` for
this PID. It is not the custody SDK's full-role `Absence`, an owned-child exit
receipt, or proof that a job or descendant cannot restart. Disappearance after
partial sampling stays unavailable. A caller must not translate these results
directly into the SDK's `owned` or `absent` observations.

Samples are serializable diagnostics, not authenticated attestations. Do not
accept a client-supplied sample as trusted native evidence. No conversion to
`ExactChild`, `EffectPermit` or `HandoffInspector` is supplied. In particular,
there is no mapping to the opaque existing receipt `birth`/`executable` fields.
The stopped-child custody/exit proof must use a protected native process/job
handle at its actual effect boundary, not a sample followed by `kill(pid)`.

## Native boundary and refusals

The implementation supports the public 64-bit Darwin BSD process-info layout
on arm64 and x64. It lazily reads existing system-library functions; there is
no native build, shell command, process enumeration, signal or job mutation.
Other platforms and architectures return `unsupported_platform`. Linux process
proofs remain unimplemented, not silently approximated by `ps` or `kill(pid, 0)`.
Runtime-only Linux imports and construction do not attempt an app start.

The native sampler:

1. Reads the kernel boot-session UUID. Missing/invalid data refuses.
2. Reads a complete BSD-info record and checks its PID, UID and birth fields.
3. Reads the executable path, then repeats metadata and path reads.
4. Returns a sample only if the observations agree. Partial buffers, invalid
   encodings, identity changes, foreign UID or native errors stay unavailable.

Only an initial `ESRCH` becomes `pid_absent`. Permission errors are
`permission_denied`; system-library loading is `native_binding_unavailable`.
Other native failures and short reads retain distinct unavailable reasons.
There is no fallback or repair. Effective-UID drift, root, a wrong instance
and invalid PID input refuse before lookup. Subsequent samples revalidate the
selected instance; reads do not borrow a previous UID check.

The compiled SDK index can also load under Node. Both the sampler and the
custody store resolve `bun:ffi` only when their native operation is requested.
On supported macOS, a Node sample returns `native_binding_unavailable`; other
platforms keep the `unsupported_platform` result. A Node lock attempt refuses
with `ownership_lock_unsupported`. Import success does not make Node a native
custody host or change production readiness.

The repeated reads detect changes but do not form an atomic snapshot. An exec
that changes and changes back between reads can go unobserved. Start timestamps
are not kernel-held process references. These limits are why the result is
only diagnostic evidence and cannot release custody or authorize a signal.

The ABI is based on Apple's [public process-info definitions](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/proc_info.h)
and [libproc wrapper implementation](https://github.com/apple-oss-distributions/xnu/blob/main/libsyscall/wrappers/libproc/libproc.c).
The installed SDK headers and native self-probe validate the current macOS
layout; no supported-release floor or running-artifact certification is chosen.

## Launcher gate compatibility

This slice changes no handoff protocol, floor, receipt encoding, request ID,
`pendingReceipts` accessor, authorization, inspector input or production gate.
Existing launcher gates must continue to consume those contracts unchanged.
The reader is optional evidence groundwork, not a requirement for the staged
fake launcher gates and not permission to open the production adapter.

Full native inspectors remain open: complete role/process coverage, job and
relaunch-source fences, in-flight native requests, exact protected child exit,
and the old runtime's Caddy/mDNS occupancy for `app-edge`. The current reader
looks up one PID only and cannot establish any of those coverage claims.
Legacy effect wiring, operator-authorized rollout, repair and production
storage retention remain separate open items.

## Validation boundary

Tests exercise the binary layout and all refusal paths through an internal
source seam. The public factory accepts no replaceable native source, request
proof or environment override. The native smoke samples only the test process
itself. Tests do not launch, stop, restart or enumerate installed apps/services.
No test result here certifies launchd, LaunchServices, Caddy/mDNS absence or
protected native signaling. Both Bun versions must pass the affected suites
and runtime package check before this draft advances.

# Live-session cost gate

This instrument qualifies the declared A1 transport workload. It does not
qualify arbitrary streaming capacity, private journal ordering, physical phone
builds or credential removal. The staged limits in
[relay-pairing-opportunities.md](./relay-pairing-opportunities.md) remain binding.

## Declaration and preparation

The public policy is `scripts/live-session-gate/manifest.air.policy.json`.
It fixes the macOS arm64 host class, both Bun executable hashes, both tiers,
all ceilings, the option (B) memory envelope and the workload. It contains no
machine name, user path or network address. A policy is not an executable gate
declaration. After the instrument is committed, `seal.py` produces a separate,
immutable declared manifest with the exact instrument head and complete tracked
source hashes. This avoids a self-referential commit hash in a tracked manifest.

Keep manifests, artifacts and results outside both checkouts; every phase
requires clean source trees.

Before the quiet window:

1. Provision clean public checkouts at the declared instrument head and baseline
   `6c19d6c1`. Install their frozen dependencies before the window. Register the
   checkouts under the local work-copy lifecycle procedure. Keep workspace
   package resolution within each checkout; do not reuse another checkout's
   workspace symlinks.
2. Provision Bun 1.3.14 and 1.3.13 with executable SHA256 values from the policy.
   Version strings alone are insufficient. No command uses a Bun from `PATH`.
3. Copy the sealed `live-session-rusage.dylib` artifact whose hash the policy
   pins. Its source is `scripts/live-session-gate/rusage.c`. Native compilation
   is preparation, not part of the gate. A rebuilt library must match the pin
   or receive a new reviewed declaration; do not edit a pin on the gate host.
4. Declare the manifest on the clean instrument checkout:

   ```sh
   python3 scripts/live-session-gate/seal.py \
     --clone <instrument-checkout> --baseline-clone <baseline-checkout> \
     --output <evidence>/manifest.air.declared.json
   ```

5. Check the host without launching a workload, using `--inspect` with the
   controller arguments below and a separate inspection result directory.
   The real run requires its own fresh, empty result directory. Leave agents, builds, browsers and dev servers
   off the gate host. The resident idle login session is part of the declared
   environment. Do not start an agent session there to run this gate.

The declared workload term is:

> no agent harness, build, browser, dev server, or any workload started for or
> during the gate; the host's resident idle login session is part of the
> environment; enforced by the quantitative envelope terms and recorded by
> full process snapshot before and after every phase.

## Execution

The operator starts one detached controller under `caffeinate -i -s`:

```sh
caffeinate -i -s python3 scripts/live-session-gate/controller.py \
  --manifest <evidence>/manifest.air.declared.json \
  --clone <instrument-checkout> --baseline-clone <baseline-checkout> \
  --library <bundle>/live-session-rusage.dylib \
  --bun-1-3-14 <pinned-1.3.14> --bun-1-3-13 <pinned-1.3.13> \
  --results <fresh-empty-results> --run
```

Request a **six-hour quiet window** for all twelve fresh runs: Bun 1.3.14,
realistic runs 1–3, large runs 1–3; then Bun 1.3.13 in the same tier order.
This is a scheduling estimate, not a measured duration or acceptance bound.
Thermal/envelope holds can require another window on the same hardware and
identical declaration. Preparation and artifact transfer occur outside the
quiet window. Allow evidence storage headroom above the 3 GiB hard floor;
25 GiB free is recommended for the clones and unfiltered traces.

Each run uses these phases, serially:

1. An independent generator prepares a real migrated, managed store: 100
   committed generations / four keys, or 10,000 / 32 keys. Serving processes
   never build the store. Preparation CPU, wall time, migration plan and file
   sizes are recorded separately.
2. Two actual bridge processes, one web and one desktop, serve each endpoint
   profile with one peer and then the tier's full local peer count. Profiles
   are direct legacy, direct tRPC, tRPC's real legacy fallback, reconnect relay,
   QR relay, request-bound relay, retired QR and retired request. The generator offers first/warmup/timed RPC groups. Analysis counts actual
   decisions, not RPC labels: each lower-decision and full resolver-admission
   path has one first observation, exactly 100 warmups, then exactly 1,000
   qualifying observations per family/profile. Every remaining observation is
   retained and separately checked against the same ceilings, never pooled to
   dilute the first 1,000. Setup/first-touch records remain separate; they are
   not OS-cold-cache measurements.
3. Matched pre-registry baseline and guarded-head steady/idle phases run
   against the same history, before mutation trials grow it. Steady load offers
   an aggregate ten RPCs/s, ten event batches/s and **12 awaited frames/s**
   across two live direct-tRPC subscriptions for 60 seconds. Actual arrivals
   must include at least ten awaited frames/s over that measured window; all
   720 offered frames must drain. Each event targets every local peer. Idle
   measures 60 seconds after a 2.1-second priming interval, so the real
   60-second full-read backstop must appear inside the idle trace.
4. A burst offers 100 RPCs and 100 event batches. Queue delay, per-operation
   RPC reply / producer-acknowledgement cost, complete physical delivery counts
   and drain time are evidence, not an
   extra throughput ceiling.
5. A third process performs 100 real revoke trials with varied sweep phase.
   There is no cross-process publication hint and no RPC/event to the idle
   target after the ACK. A common native `CLOCK_MONOTONIC` clock supplies all ACK, invalidation and
   client-close timestamps. Each child proves its clock is inside its parent
   launch/receipt bracket; Bun process-relative clocks are not used for these
   cross-process intervals. Both bridge processes report synchronous local
   invalidation separately from physical close and scheduled sweep delay.
   Fresh handles reconnect after each regrant. Raw signed timestamps remain;
   a handle already invalid before the ACK has zero subsequent ACK latency.
6. Separate active-revoke and suspended revoke/regrant traces exercise fresh
   dispatch and never-revive behavior. The suspended trace promises no
   wall-clock closure bound. Real publication/fsync and committed-pending
   recovery traces follow; only the fixture's completion seam is interrupted,
   after a real writer has published, then the unchanged reader completes it.

The application router is a trivial instrumented body. Actual endpoint code,
Noise, resolver proxy, subscription await loop, send checks, domain and owner
remain unchanged. Broker/Tail event sources are bounded fixture sources, not
live services. The baseline uses actual pre-registry source, never a bypass in
A1's verifier. Raw guarded server CPU determines acceptance. The CPU denominator is the fixed
60-second declared window, never the longer drain time. Counters requested at
the deadline may include extra CPU if a worker is late, which is conservative. Baseline CPU and
its delta are separately reported; the delta includes changed transport and
instrument costs and is not an isolated native-registry microbenchmark.
Generator/client and third-mutator CPU have separate receipts. The trusted test
adapter uses a shared native `flock` across the two serving processes and third
mutator; measured wait and hold are distinct. This is public invocation-contract
instrumentation, not the private native journal adapter or its acceptance proof.

## Evidence and validity

Every prepare/workload phase has before/after host snapshots and source,
executable, library and running-instrument hash checks. Snapshots include full
process listings, disk, load, hardware identity, OS, swap, kernel pressure,
system swap counters, thermal, AC power and Low Power Mode. One gate uses one
hardware UUID. The public manifest names the class, not the host.

The envelope requires at least 3 GiB disk free; one- and five-minute load no
higher than 0.5 per logical CPU; swap used at most 2 GiB; kernel pressure level
1 before and after every phase; zero system swap-ins and swap-outs across
**each** phase; nominal thermal state; AC power; Low Power Mode off. Missing
or unknown probes refuse. The envelope never widens to fit the host.

Per-sample records include native user/system CPU, faults/context switches,
owner-method counts and timings, actual invocation gate wait/hold, memory and
heap observations. Native JSC GC logs have matching sample boundaries. Output,
probes and instrumentation perturb this measurement; no forced GC or sample
exclusion is permitted. p99 is reported evidence, not a ceiling. Sweep
verification percentiles exclude stat-only ticks by measurement class, not by
latency; every tick remains in the raw log.

The controller retains every attempt. A phase bracket outside the envelope
invalidates the whole attempt, never produces a pass, and can repeat only on
the same host and identical manifest. A failure inside the envelope is final
at that head, even on a slower eligible host. There is no host shopping or
rerun-to-green. A per-head journal under the gate operator's local state
prevents a new result directory or new declaration from resetting a recorded
failure. An interrupted controller stays `running` and requires reviewed
recovery; it never retries automatically. Locks, manifests and journals must
not be deleted to force a retry. All raw samples and failed attempts travel
with the result bundle.

`--smoke` explicitly labels short local checks **NOT THE GATE**, bypasses only
host-envelope qualification, and writes no qualification journal. It does not
weaken the production verifier, alter policy, run the full timing gate, or
qualify the Air. Its reduced sample counts and durations cannot count as gate
passes. Use both pinned Buns; a policy/manifest change requires re-sealing.

## Synchronous-spawn recorder and the #34069 exception

Before a product import, every traffic and worker process installs
`spawn-recorder.ts`. It wraps `node:child_process` `execSync`, `execFileSync`
and `spawnSync`, and `Bun.spawnSync`. Both bare and `node:` imports, named
exports, default exports and `require` receive the same wrappers. Bun's pinned
`syncBuiltinESMExports` does not update named bindings; the gate publishes the
wrappers through its existing test-module mechanism instead. No product file
changes. Async spawn functions remain unchanged.

Each process writes a separate `*.sync-spawn.jsonl` file with a ready record,
API counts, arguments, call site, start time and duration. A wrapper returns the
original result or throws the original exception. It does not change options
or stdio. A worker writes its final counts before its existing stop ACK; a
traffic process writes them on exit. A clean phase requires every process's
recorder and reconciled final counts, including zero. API counts count wrapper
invocations, not distinct OS children; one API can delegate to another.

The controller retains OS process witnesses while a recorded synchronous call
is in flight, including immediately before timeout cleanup. These witnesses
are outside the measured serving processes. The manifest declares this
instrument overhead. A process snapshot produced by cleanup itself is not
proof of the defect. A worker killed by the existing generator cleanup also
needs a timeout cause, a missing stop ACK and a matching actual signal receipt.
An unrelated generator failure does not receive the exception.

Fable's ruling 3(ii) applies mechanically:

- A phase that fails **only** by whole-phase timeout or worker kill, with a
  synchronous spawn still in flight, an attributable exited/zombie child still
  unreaped, and no ceiling exceeded before the stall, is **invalid**, not a pass
  or final product failure.
- The controller requires a live OS witness within one second before the stall,
  a direct-child relationship, the owned process group, matching kernel command
  name (`ps ucomm`, which survives zombie argument loss),
  and child birth time consistent with the call. Missing, stale or ambiguous
  evidence refuses the exception. Completed samples retain their native GC and
  counter checks. Prefix quantiles are conservative and never qualify a run.
  Without a completed CPU/delivery receipt, a load-phase stall cannot receive
  the exception. A preceding ceiling violation or independent error also
  refuses the exception.
- The per-head journal counts these invalids across all tiers, Buns and runs,
  including attempts that also breach the envelope. At most two are repeatable,
  only as whole runs on the same hardware with the identical manifest. The
  third permanently stops this campaign. It requires a freshly declared gate
  once at a separately reviewed post-bump pin. The controller never changes a
  pin or starts that campaign automatically.
- An inside-envelope stall or failure without the verified signature remains
  final at this head. All twelve qualifying runs must be clean. The controller
  reports aggregate recorder counts; zero across all measured phases must be
  observed, not inferred from source inspection or these short local profiles.

The six-hour window may be split between whole runs on the same hardware and
manifest. Preserve the declared run order, never pause a run, and retain 30 s
pacing between runs within a session. A later Bun bump needs its own reviewed
PR and full gate; it does not invalidate A1's qualification at its two pins.

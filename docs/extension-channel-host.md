# Dormant extension channel host

The production context gate remains literal `false`. A qualified transport does
not enable API 2 context or credential delivery. Activation requires a separate
host review, exact-head two-platform evidence and an operator checkpoint.

The `extension-channel-host` runtime subpath exposes allocation through the
single-owner adapter and fixed asset verification, not a raw close function,
injected driver or compiler-release witness hook. See its module documentation
for the SIGPIPE lifetime and Darwin fork/exec constraints.

Scout requires Bun 1.4.3 or newer. The native facade is **unavailable** on that
supported range until a separate exact-revision review qualifies it. CI checks
refusal on 1.4.3 and 1.4.4 on both platforms; this is not positive qualification.
The historical positive checkpoint runner remains unchanged and cannot pass on
the new floor. Do not broaden its allowlist just to make CI green.

The historical facade qualification required Bun 1.3.14 and full revision
`0d9b296af33f2b851fcbf4df3e9ec89751734ba4`, Darwin arm64 or Linux glibc x64.
Linux requires a positive `glibcVersionRuntime` from an in-memory process report.
Missing, malformed or unavailable reports refuse. No report is logged or
written. Unsupported hosts refuse before native loading and allocation.

The candidate adapter adds a compile-only witness seam. Its source tuple is at
`895291e4356268172367fae036eb516f747a92fa`. Build staging rejects any other input
hash. Runtime ESM and the CLI sidecar carry a fixed-file artifact manifest.
Missing, altered or unexpected assets refuse. This is trusted-build integrity,
not isolation against same-user mutation of the program and its verifier.
The build does not approve a host or new transport source bytes.

The runtime build copies the C asset beside its emitted adapter. The CLI build
stages an independent sidecar and its C asset. The CLI resolver loads a fixed
installed sibling; it never falls back to a checkout on an installed run. No
environment variable or CLI argument can select an alternate module or asset.
Compiler/header availability remains a deployment prerequisite. There is no
compiler download or alternate-library fallback.

Run `bun run test:extension-channel:qualification` at an explicit checkpoint.
The independent macOS/Linux jobs retain the cold no-DFG read-timeout process.
For the candidate `fable-a-reuse-compile-isolation/v1` tuple, compilation stays
in that cold process but is separated from the allocation window. A post-prepare
prefix audit precedes the single genuine allocation; no throwaway pair is made.
The seam creates no endpoint and is not part of the host facade or a CLI/env path.
This candidate requires a fresh two-platform qualification ruling, not an old
receipt. The jobs also retain
the warm full-JIT matrix, pure/pressure tests, context companion/sentinel,
artifact tests and fences. Positive skips refuse qualification. The existing
manual/callable CI model is unchanged. The per-key cc allowance must keep its
exact fixed-source restriction. The fence must pass over the full source inventory,
and every per-key policy must match the expected inventory in
`scripts/extension-channel-fence-inventory.json`. The b90c69fd baseline has 174
named symbol/file pairs and a fixed digest. Later changes must append accounting
records that name each retired/added pair, its policy digest, the reason and
the exact before/after counts. Recounting disk does not grant approval. A missing
pair, an unrelated same-count replacement or an unaccounted policy widening
refuses, as does a missing/partial/vacuous fence report. The fixed-source native
compile checks remain mandatory independently of this ledger.

PR #100 adds `packages/cli/src/cli/core-readiness.test.ts / Bun.spawnSync` for
bounded isolated core setup/doctor fixtures. Its named record identifies reviewed
input `66b524514cab1bfacd251bbde728f5b8175e315c` and merge
`6092bf44004abe29a862d0f6974279e4795cf6c5`, taking the expected inventory from
174 to 175. The pinned baseline and its digest remain unchanged.

PR #95's rebase must append the named 175-to-174 transition: retire `spawnSync`
in `packages/cli/src/cli/commands/web.ts` (async tar extraction) and
`packages/cli/src/cli/commands/web.test.ts` (async tar fixture helpers); add
`Bun.spawnSync` in `packages/cli/src/cli/commands/fixtures/web-stdio.ts`
(child-only legacy synchronous-call regression control). Its unaccounted
174-entry tree must refuse against the accounted 175-entry inventory.
Do not edit or regenerate the pinned baseline.

CLI source units run reuse-sensitive suites in separate processes; Bun
JS-realm isolation alone does not isolate the descriptor table. No witness
assertion, bound or sensitivity control is relaxed.

Process separation addresses shared descriptor-table activity, not collection
timing. A positive collection miss still refuses the checkpoint after 64 GC
rounds. The added positive-refusal diagnostic logs collection observations,
reuse and identity losses. It does not retry, take a heap snapshot or turn a
refusal into a pass; the existing opt-in witness snapshot remains separate.

The credential reader still lacks the 4-KiB partial-frame/idle distinction
required by the input protocol. This facade does not implement credential
policy, a live credential server or a delivered-key capability. Those changes
require a separate design and new qualification for any changed adapter bytes.

## Measured libc detector outcomes

On 2026-10-22, exact official Bun 1.3.14 binaries reported the full pinned
revision on both real Linux environments:

| Environment | Runtime libc header | Detector |
| --- | --- | --- |
| Ubuntu 24.04.5, glibc 2.39, official linux-x64 Bun | `glibcVersionRuntime: "2.39"` | `linux-glibc-x64` |
| Alpine 3.22.7 container, musl 1.2.5, official linux-x64-musl Bun | field absent | refusal (`null`) |

The Alpine probe used `libstdc++`, not a glibc compatibility layer. Only the
version, revision, architecture, presence/version of the libc field and detector
result were recorded. The report itself was neither printed nor written.
The minimized measured headers are retained in the runtime test fixture; the
predicate tests also cover malformed reports and report exceptions. The
qualification job observes the real supported host again at each checkpoint.
These measurements qualify the detector distinction, not context activation.

# Dormant extension channel host

The production context gate remains literal `false`. A qualified transport does
not enable API 2 context or credential delivery. Activation requires a separate
host review, exact-head two-platform evidence and an operator checkpoint.

The `extension-channel-host` runtime subpath exposes allocation through the
single-owner adapter and fixed asset verification, not a raw close function,
injected driver or compiler-release witness hook. See its module documentation
for the SIGPIPE lifetime and Darwin fork/exec constraints.

The facade requires Bun 1.3.14 and full revision
`0d9b296af33f2b851fcbf4df3e9ec89751734ba4`, Darwin arm64 or Linux glibc x64.
Linux requires a positive `glibcVersionRuntime` from an in-memory process report.
Missing, malformed or unavailable reports refuse. No report is logged or
written. Unsupported hosts refuse before native loading and allocation.

The source adapter and shim remain byte-identical to the qualified tuple at
`ffd214f22afd10e505d316d57634ef1111d0773b`. Build staging rejects any other input
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
The independent macOS/Linux jobs retain the cold no-DFG read-timeout process,
the warm full-JIT matrix, pure/pressure tests, context companion/sentinel,
artifact tests and fences. Positive skips refuse qualification. The existing
manual/callable CI model is unchanged. The per-key cc allowance must keep its
exact fixed-source restriction and the fence inventory must stay at least 174.

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

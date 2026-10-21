# L1 pinned-mesh reconciliation ledger

The public runtime now has typed transport and timeout outcomes, bounded
verified-card reuse after refresh timeouts, and headers-only response budgets.
Public trust-routing refusals, socket cleanup and response byte caps remain.

## Inputs and boundary

- Public base: `e823cceb2` on the fork's `core-split` branch.
- Selected behavior: private commits `2a5686636` and `2965d97e3`.
- The private repository was fetched and inspected read-only. No private
  checkout file was changed. No private commit is an ancestor of this branch.
- This is a selective edit of two runtime modules and their tests, not a
  whole-file copy or a merge of private history.

## Per-conflict decisions

1. **Outcome taxonomy:** add `PeerTransportError` and
   `PeerTimeoutError("connect" | "response")`. Keep public
   `PeerTlsConnectionError` and `PeerCardUnavailableError` as named subtypes of
   transport error. Keep `isMeshPeerTrustError` and alias ownership checks.
2. **Probe failures:** retain public's refusal to send unsigned traffic when a
   card probe fails, including never-enrolled unreachable candidates. Do not
   restore private's legacy-on-dial-failure branch.
3. **Verified stale cards:** port timeout-only reuse, with a maximum age of
   15 minutes since verification and an unexpired signed card. Require the
   same nonempty enrolled key ID and durable TLS pin at verification, request
   start, after refresh failure and before signing. Never renew the cached
   verification timestamp through reuse. Drop cached cards and pinned sessions
   when their trust binding changes, even inside the ordinary cache TTL.
4. **Trust refusal after a send:** retain public's stronger pin-mismatch
   recovery. If recovery times out or becomes unavailable after an observed
   pin failure, the final result remains `PeerTlsPinError`. Do not port
   private's transport rethrow in this branch; it would permit alias fallback
   after a trust refusal. The failed card cache is removed before recovery.
5. **Certificate failures:** retain public's missing-certificate and unknown
   pinned-anchor TLS failures as trust refusals. Do not port private's broad
   conversion of these failures into transport errors. Actual connection
   failures and internal deadlines remain distinct from trust failures.
6. **Time versus bytes:** add the private defaults of 2.5 seconds for connect,
   10 seconds to response headers, and 12.5 seconds for the card probe. These
   time limits do not replace public's `maxResponseBytes` or the streaming caps
   in ping and peer-agent discovery. Caller deadlines still take precedence.
7. **Body behavior:** Bun returns the original live response and clears its
   response timer at headers. The caller's signal still governs the body.
   Node clears the timer on `response`, not `close`, and retains public's
   existing capped buffered response path. This port does not redesign Node
   buffering or claim that Node now returns an infinite SSE response at headers.
8. **Socket and cancellation fixes:** keep public's early socket assignment,
   late-connect termination and one-shot abort cleanup. Port typed internal
   connect timers and one-shot Node connector completion. Caller cancellation
   now preserves its original reason instead of wrapping it as connection
   failure; it never authorizes stale-card reuse.

The bounded stale-card policy does not remove a public trust check. It extends
only the refresh interval for a previously verified, still-enrolled identity;
every resulting request still uses the same durable TLS pin and signed
request destination. Cases with observed trust failure remain hard refusals.

## Failure ledger and evidence

| Case | Observation or risk | Check |
| --- | --- | --- |
| Public response has no internal header budget | A TLS peer can accept a request and stall headers until a caller deadline. | A focused reproduction uses a 150 ms header delay and a 20 ms response budget. Public base returns success; reconciled code returns typed response timeout. |
| Public expired card on refresh timeout | A still-valid enrolled cached card cannot be reused. | A focused reproduction expires a 100 ms local cache, injects a refresh `TimeoutError`, and attempts a second pinned send. Public base throws `PeerCardUnavailableError`; reconciled code sends using the same enrolled pin. |
| Stale reuse outside its binding | Revocation, changed key/pin, missing enrollment, signed expiry or excessive age must prevent reuse. | Tests cover each change before/during refresh, fresh-cache invalidation, signed expiry, the 15-minute bound and caller cancellation. |
| Private retry downgrade | A pin failure followed by transport failure could be misread as an alias reachability failure. | Keep public code; original route-fallback regression passes. A new typed-timeout recovery regression also stays a pin error. |
| Body-wide response timeout | SSE can outlive any finite header budget. | Bun pinned and unpinned probe streams survive the budget and return all six events. Caller cancellation still aborts either body. A real Node child also consumes a body that outlives its header budget. |
| Response byte cap lost during port | Private lacked public's Node cap. | The real Node child still rejects the original capped response with `PeerResponseTooLargeError`. Ping and peer-agent streaming cap regressions remain green. |
| Certificate error reclassified as reachability | Broad error wrapping could let an alias hide changed trust. | A real Bun cached-anchor test replaces the server certificate; the client raises `PeerTlsPinError` before the impostor receives a request. |
| Socket cleanup regresses | A stalled TLS handshake can outlive a timeout or cancellation. | Both connector timeout and caller deadline tests verify that the server-side socket closes. |

The focused reproduction ran against local copies of the two **public base**
modules, with only relative imports redirected for local execution. It did
not alter the working source or the private checkout. On each Bun version:
**0 pass, 2 fail before; 2 pass, 0 fail after**. The committed suites cover
these behaviors and the additional refusal cases.

## Verification

| Check | Bun 1.3.13 | Bun 1.3.14 |
| --- | --- | --- |
| Four affected test files | 87 pass, 0 fail | 87 pass, 0 fail |
| Runtime typecheck | pass | pass |
| Focused before/after reproduction | 2 fail → 2 pass | 2 fail → 2 pass |

The four test files are `mesh-peer-client.test.ts`,
`mesh-pinned-https-client.test.ts`, `mesh-forwarding.test.ts` and
`mesh-ping.test.ts`, all under `packages/runtime/src`. The pinned-client suite
also builds and executes a real Node child for transport conformance.

```sh
bun test packages/runtime/src/mesh-peer-client.test.ts \
  packages/runtime/src/mesh-pinned-https-client.test.ts \
  packages/runtime/src/mesh-forwarding.test.ts \
  packages/runtime/src/mesh-ping.test.ts
bun run --cwd packages/runtime check
bun run sync-exec:fence
```

For pinned Bun, prefix the commands with
`PATH="$HOME/.scout/work/tools/bun-1.3.13:$PATH"`.
Sync-exec fence passed with 144 allowlisted symbol/file pairs.

Local evidence: `tmp/l1-tests-bun131{3,4}.log`,
`tmp/l1-runtime-check-bun131{3,4}.log`,
`tmp/l1-repro-{before,after}-bun131{3,4}.log`, `tmp/l1-repro.test.ts`,
`tmp/l1-public-baseline/` and `tmp/l1-fence.log`.

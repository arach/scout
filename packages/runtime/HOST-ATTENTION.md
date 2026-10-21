# Machine-local tmux attention

`detectClaudePermissionDialog` reads Claude's permission-dialog grammar in a
backend-neutral module. `detectClaudeTmuxHostAttention` and
`ClaudeTmuxAttentionDialog` remain compatibility aliases of that detector and
`ClaudePermissionDialog`. Both collectors depend on the shared leaf module;
the Herdr collector does not import the tmux entrypoint.

Import `detectClaudeTmuxHostAttention`, `collectTmuxHostAttention` and
`TMUX_HOST_ATTENTION_LIMITS` from `@openscout/runtime/host-attention`.
Importing this subpath does not enumerate hosts, capture panes, spawn processes
or start listeners. Capture is a required injected callback. The web adopter
keeps its existing `captureTmuxPane` default from `system-probes`.

This API is for trusted, same-machine operator code. It adds no HTTP route,
remote read, guest access or scoped access. The
caller must establish operator authority; a DTO's scope field is not an
authorization mechanism.

## Identity and observations

Protocol exports these serializable types:

- `TerminalHostRef`: owning `nodeId`, `backend`, exact `hostSession` and
  optional `paneId`. The tmux target narrows the backend to `"tmux"`.
- `TmuxHostAttentionTarget`: ref, harness, label, optional agent ID and optional
  caller-supplied `ObservedSessionIdentity`. This link must match the node and
  harness. It is not inferred or verified from rendered text.
- `TmuxHostAttentionObservation`: target context, observation time,
  `source: "tmux_pane"`, `provenance: "inferred"`, detector name, availability,
  reason, byte coverage and nullable prompt.
- `HostAttentionPrompt`: title, bounded summary/detail, `promptVersion` and
  `promptIdentity: null`. Tmux text supplies no native permission/tool-use ID.
- `TmuxHostAttentionRead`: schema, machine-local scope, local node, observation
  time, aggregate availability, rows and coverage.

The collector checks local ownership before calling capture. Unknown local
identity, invalid refs/session links and unsupported harnesses are `unknown`;
nonlocal refs are `unavailable`. None of these cases captures a pane. Null,
thrown and rejected captures are `unavailable`, with `capture_failed`;
timeouts use `capture_timeout`. A successful empty capture is `available`
with no prompt. Explicitly truncated or over-limit captures are `partial`
with `capture_truncated` and no prompt/version. Unstarted rows are
`not_scanned` with `capture_capacity`.

`HostReadAvailability` aliases the existing `SessionReadAvailability` plus
`partial`; existing session members do not change. Aggregate `available`
requires all supplied refs to be available with no omitted candidates.
Mixed success or omitted candidates is `partial`; wholly failed captures are
`unavailable`. Unknown identity remains `unknown`. A zero-candidate ceiling
with supplied refs is `not_scanned`.

Coverage describes **provided terminal refs**, not host enumeration or a full
fleet scan. It records requested count, captures started, omitted count and
completeness. Zero supplied refs can be complete for this input set only.

## Versions and limits

The version is SHA-256 over a versioned tuple containing the exact canonical
terminal ref, the supplied native harness session identity when present,
null native prompt identity, and the complete recognized dialog span plus normalized fields: command header,
**full command block**, permission rule, question, options and footer.
Whitespace, ANSI escapes and option cursor decoration are normalized. Display
labels, agent IDs, observation times and trailing task noise are excluded.

The hash binds content, including text beyond the display preview. It does
**not** identify a unique prompt incarnation: identical content at the same ref
can recur (ABA). It is not freshness, liveness or answer authority. An
answer operation must re-read and establish its own authority and replay contract.

Hard ceilings are 24 candidates, 6 concurrent captures, 2 seconds per capture,
48 KiB per capture, 200 summary characters and 500 detail characters. Caller
limits can only lower candidate, concurrency and timeout ceilings. Capture
receives an AbortSignal and max-byte budget. It must bound its own I/O before
returning; checking a returned string cannot prevent an injected callback from
allocating too much memory. A timed-out worker slot retires, so a callback
that ignores abort cannot cause more than six outstanding captures in one
collection. Other rows remain explicitly unscanned.

Across collections, a capture implementation must either honor abort or bound its own in-flight captures globally, and a timer-driven caller must not start a new collection while a previous collection's captures are still pending.

## Adoption boundary

The web keeps state-based candidate ranking and presentation IDs/actions.
Its operator attention snapshot also exposes `tmuxHostAttention` read metadata,
so capture failures are not rendered as evidence of no prompt. If local node
identity is unavailable, it returns an unknown read without capturing.

The private Herdr detector currently uses the thin web compatibility wrapper
over the public parser; its probe/collector, continuation type and private
phone bridge remain unchanged until the Herdr read half. The phone consumer is
`packages/web/server/core/pairing/runtime/bridge/router.ts` →
`collectHerdrHostAttention`. Herdr routing and permission answering are separate
work, after read-contract review.

## Answering a tmux prompt

Import `createTmuxHostAttentionAnswerer`, `TMUX_HOST_ATTENTION_ANSWER_LIMITS`,
`TmuxHostAttentionAnswerInput`, `TmuxHostAttentionAnswer` and
`TmuxHostAttentionSendKeys` from the same subpath. The factory returns the
async `answerTmuxHostAttention` function. It requires injected capture and
key-sending callbacks and performs no I/O until called. There is no default
tmux process invocation, new route, broker mutation or private web dependency.
The protocol DTOs and existing read-version tuple are unchanged. This PR
moves no web or phone caller.

Retain one answerer per trusted, same-machine operator/transport owner. Supply
the exact previously observed target, its `promptVersion`, and `option:
"approve" | "deny"`. The answerer requires an explicit tmux pane ID such as
`%42`, not a session's movable active pane. It checks local node ownership,
Claude harness, ref validity and any supplied native-session link before I/O.
It snapshots these fields before awaiting a callback. Captures receive exact
copied refs, the same context as collection, an AbortSignal and a 48 KiB budget.

The answerer:

1. Serializes this pane in-process, including aliases with the same pane ID.
2. Captures again. A missing recognized dialog returns `gone`; a different
   content version returns `stale`. Neither sends keys. Failed, timed-out or
   incomplete captures cannot authorize a send.
3. Requires sequential, unambiguous single-digit numbered options and exactly
   one plain `Yes`. Approval sends that numeric option alone. Denial sends
   the plain `No` number, or `Escape` when there is no plain `No`. It never
   selects persistent approval, follows the cursor with Enter, or appends
   Enter. Wrapped/unknown option layouts fail closed. Numeric selection avoids
   relying on cursor position, which is excluded from the content version.
4. Consumes the ref/content-version attempt before invoking the transport.
   A thrown or timed-out transport may already have acted. It must not retry.
5. Captures again after a resolved transport. It returns `answered` only after
   a successful, complete capture has no recognized dialog. An unchanged
   dialog is polled within the verification budget without another send.
   Another recognized dialog returns `unverified`, not permission to answer it.

The key callback must enforce actual local operator authority and the exact
live host/pane binding, and perform any required audit before sending. The
factory's node/ref checks are not authentication. Capture adapters must return
null/throw on a missing or unreadable target, not fabricate an empty capture.
An actual successful empty capture means no recognized dialog is visible.

### Typed outcomes and uncertain effects

Every result contains `outcome`, `reason` and `effect`:

| Outcome | Meaning |
| --- | --- |
| `answered` | Transport resolved and a complete post-send capture observed no recognized dialog. |
| `stale` | Fresh preflight recognized different dialog content. No keys were sent. |
| `gone` | Fresh preflight found no recognized dialog. No keys were sent. |
| `unverified` | A send may have acted, but disappearance was not established, or cancellation/timeout interrupted it. |
| `failed` | Capture failed before sending, or the transport rejected. Inspect effect. |
| `refused` | Invalid/nonlocal request, unsupported options, busy capacity, replay latch or exhausted attempt capacity. No keys were sent. |

`effect: "not_sent"` means the send callback was not entered. `"sent"` means
the injected transport resolved. `"unknown"` means a send was attempted but
did not resolve normally, including rejection, abort and timeout. It is never
safe to turn an unknown effect into an automatic retry. An abort just before
callback entry is conservatively unknown once the send stage is entered.
Callback exception details are not returned as error text.

`answered` is observed disappearance, not a native permission/tool-use
acknowledgement or proof of which external actor removed the dialog. The
capture/check/send sequence is not atomic. An external writer, a pane/server
restart, or an identical-content ABA between capture and send cannot be
excluded by a content hash. Callers must coordinate other writers and verify
the live terminal incarnation. A native compare-and-answer facility would be
needed for a stronger guarantee. This API does not claim exactly-once actuation.

### Bounds, serialization and replay

Hard ceilings are two seconds each for preflight capture, send, and the whole
verification phase; at most eight verification captures with 50 ms spacing;
six concurrent answers; and 256 unresolved content-version attempts per answerer.
Each verification capture is also limited by the remaining phase budget.
Caller limits can only lower these ceilings. No polling send or transport
retry occurs. A dialog that remains after the capture-count or time budget
returns `unverified` with `dialog_still_present`. Unreadable/truncated/timeout
verification returns `unverified` with the corresponding capture reason.

Timeout and caller abort signal the outstanding callback and return a bounded
result. They do not pretend the underlying operation stopped. Its pane and
global slot remain occupied until all callbacks actually settle. There is no
late continuation that can send after a timed-out preflight. A permanently
abort-ignoring callback can permanently retire a slot. The callbacks must honor
abort or bound their I/O globally. A `refused` / `busy` / `not_sent` result
includes `heldForMs: number`, a finite, nonnegative elapsed age in milliseconds
measured with a monotonic clock. It measures this pane's hold, including a
host-session alias; if only the global ceiling blocks a new pane, it measures
the oldest occupied slot. The age includes pending callbacks after timeout.
It is diagnostic, not an expiry or permission to overlap I/O. The caller can
use it to decide whether to reconstruct the answerer deliberately, after
inspecting unresolved effects and coordinating any outstanding callbacks.
Do not manufacture new answerers to bypass these bounds.

A ref/content version is latched before a send stage starts. The entry leaves
the latch only on `answered` / `sent`, when a complete capture observed the
dialog gone. A later identical prompt at the same ref can then be answered as
a new occurrence. `failed` / `unknown`, `unverified` / `unknown`, and
`unverified` / `sent` retain the entry for the answerer's lifetime. Entries
never expire by age and are not evicted to make room. The 256-entry cap fills
only with unresolved incidents; `attempt_capacity` refuses new attempts when
it is full. Stale/gone/preflight refusals and failures do not add an entry.
Do not clear an unresolved latch or recreate the answerer merely to make a
second tap succeed.
Cross-process/restart durability and coordination with autonomous continuation
are caller responsibilities; this in-memory guard is not a shared claim.

## Existing answer paths and deferred Herdr work

Source inspection at parent `609a3a22` found no version-guarded tmux permission
answer function in the web. Tmux host-attention rows offer an open-terminal
action, not an answer endpoint. Generic tmux interrupt/quit controls send
`C-c`/`C-d`; they do not identify or verify a permission dialog. The current
web permission/approval decision routes concern broker-managed requests and
pairing approvals, not this rendered tmux observation. This PR does not wire
the new function into any of them.

The existing `packages/web/server/core/attention/herdr-permission-answer.ts`
reads blocked panes, captures again and compares its older numeric dialog
fingerprint. It sends the first ordinary allow/deny option: `enter` only when
that option is uniquely selected, otherwise its numeric index; missing denial
uses `esc`. It claims a continuation actuation and records audit `attempt`
before sending. A changed/gone dialog refuses before the send; a successful
send returns success **without a post-send capture**. Capture/check/send still
has an external-writer/ABA race. Existing keys and semantics are not changed.

Its production callers are `mobile.answerTerminalPermission` in both
`packages/web/server/core/pairing/runtime/bridge/router.ts` and
`apps/desktop/src/core/pairing/runtime/bridge/router.ts`. No direct web HTTP
caller of `answerHerdrPermission` was found. Separate autonomous Herdr
continuation has a second decision capture, topology/grant recheck and audit;
it also reports a send rather than verified dialog disappearance.

Herdr can be implemented over injected callbacks without depending on #64's
HTTP route, but its public target/topology and native-terminal binding contract
is not supplied by the tmux-only DTOs. #64 is a cached read route, not permission
answer authority. Keep Herdr extraction/adoption after that read-contract line
and a separately reviewed answer/claim/audit adapter. Do not silently map its
numeric version to this SHA-256 observation or route phone input through tmux.

Protocol now exports `HostAttentionAnswerResult`. `TmuxHostAttentionAnswer` and
`HerdrHostAttentionAnswer` are field-for-field aliases, including busy-only
`heldForMs`. The shared reason union adds `authority_refused`,
`claimed_elsewhere`, `claim_unavailable`, `audit_failed` and `target_changed`;
no existing reason is renamed. These names do not implement admission or
actuation. Herdr's answer factory, exact-terminal transport and shared durable
claim/audit integration remain separate, inactive work.

## Strict injected Herdr observations

Import `collectHerdrHostAttention`, `HERDR_HOST_ATTENTION_LIMITS`,
`HerdrHostAttentionCapture` and `HerdrHostAttentionCaptureEvidence` from the
same runtime subpath. Protocol exports `HerdrHostAttentionBinding`,
`HerdrHostAttentionTarget`, `HerdrHostAttentionObservation` and
`HerdrHostAttentionRead`. This collector has no default capture, enumeration,
process execution, send callback or answer function. It does not call #64's
cached workspace route. It observes only supplied refs on the known local node.

A target requires an exact Herdr session/pane, native terminal ID, workspace,
tab and harness. Its optional native session reference preserves Herdr's
agent/kind/source/value, not a verified Scout identity. The injected capture
must return an explicit `herdr_visible`, `live` envelope: complete visible
`body`, boolean `truncated`, and uncached live `before`/`after` bindings.
Both bindings must match the snapshotted target, including any supplied native
session. Plain strings, missing/error envelopes, saved/cached reads and unknown
metadata fail closed. Changed bindings return `target_changed` without a prompt.
These fields are trusted adapter evidence, not proof against a lying adapter.
Do not manufacture them by copying the input target around a cached read.

The collector checks local identity, backend, all binding fields and native
session consistency before capture. Missing or malformed bindings are unknown;
nonlocal targets are unavailable. Only Claude's reviewed detector is supported.
Null/throw/malformed reads are unavailable, never evidence of no prompt.
Truncation/overflow is partial and produces no version. A complete successful
empty capture is available with no recognized prompt. Timeout/abort is explicit;
a worker whose callback is still pending retires instead of starting more I/O.
Across collections, callbacks must honor abort or globally bound their own I/O;
callers must not overlap pending abort-ignoring collections.

Hard limits are 24 provided targets, six captures, two seconds per whole injected
binding/capture operation, and 48 KiB per capture. Caller limits only lower the
candidate, concurrency and timeout bounds. Coverage describes provided refs,
not a complete host scan; omitted/unstarted refs remain explicit.

Herdr prompt versions use SHA-256 over the separate
`claude-herdr-permission-v1` domain, the full exact binding/native session tuple,
null native prompt identity and the complete normalized dialog content. The
legacy numeric fingerprint is never converted. Presentation labels, agent IDs,
cursor decoration and observation time do not enter the hash. Full commands
beyond preview limits do. Identical content can recur with the same version;
the version is neither an incarnation ID nor answer authority.

The inspected Herdr v0.9.5 agent resolver accepts a public pane or agent name,
not the opaque terminal ID that another resolver understands. A topology read
followed by a movable-pane send is not exact-terminal dispatch. No permissive
production answer adapter is supplied: exact-terminal dispatch (or an expected
terminal check atomic with dispatch) must be measured and reviewed first.
Native input acceptance is not permission acknowledgement; a future answerer
also needs complete post-send verification and the shared durable claim/audit
protocol, including legacy writers. None is enabled by this read-only slice.

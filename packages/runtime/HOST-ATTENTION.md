# Machine-local tmux attention reads

Import `detectClaudeTmuxHostAttention`, `collectTmuxHostAttention` and
`TMUX_HOST_ATTENTION_LIMITS` from `@openscout/runtime/host-attention`.
Importing this subpath does not enumerate hosts, capture panes, spawn processes
or start listeners. Capture is a required injected callback. The web adopter
keeps its existing `captureTmuxPane` default from `system-probes`.

This API is for trusted, same-machine operator code. It adds no HTTP route,
remote read, guest access, scoped access or permission-answer operation. The
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
can recur (ABA). It is not freshness, liveness or answer authority. A later
answer API must re-read and establish its own authority and replay contract.

Hard ceilings are 24 candidates, 6 concurrent captures, 2 seconds per capture,
48 KiB per capture, 200 summary characters and 500 detail characters. Caller
limits can only lower candidate, concurrency and timeout ceilings. Capture
receives an AbortSignal and max-byte budget. It must bound its own I/O before
returning; checking a returned string cannot prevent an injected callback from
allocating too much memory. A timed-out worker slot retires, so a callback
that ignores abort cannot cause more than six outstanding captures in one
collection. Other rows remain explicitly unscanned.

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

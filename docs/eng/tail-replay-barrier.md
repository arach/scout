# Tail replay and live barrier

`tail.events` attaches its live capture before taking its retained replay image.
A publication during replay is covered by that image, queued for live delivery,
or terminates the subscription with `StreamResyncRequired`. It cannot disappear
between snapshot and listener attachment.

## Publication positions

The runtime assigns an increasing private ordinal at the public aggregate
commit, after quiet-event coalescing. Internal pre-coalescing observations do not
advance that position. The aggregate holds at most 10,000 `{ ordinal, event }`
entries. Existing recent and session readers still return only `TailEvent`.

Each subscription captures at most the last 500 entries and a watermark from
that same image. Its single live queue is already registered. Queue entries at
or below the watermark are overlap; later entries are delivered in publication
order. Suppression uses the ordinal, not an event ID, timestamp or sort order.
Distinct publications with equal IDs remain distinct. Ordinals never wrap:
exhaustion closes captures and refuses new ones. Buffer reset invalidates active
captures and does not reuse positions.

Cursor lookup uses the captured unfiltered window and its existing first-ID
match. Source selection follows lookup. Missing/empty `since` and unknown or
expired cursors retain the existing replay behavior. An empty sources list still
means all sources. This slice adds no epoch or verified-history claim.

## Bounds and lifetime

The live queue keeps the existing limits throughout replay: 256 selected events,
1 MiB of serialized event bytes, and 30 seconds for the oldest queued event.
Source selection precedes accounting. Synchronous pre-watermark work is bounded
too; overlap removal cannot erase an overflow. Accounting/filter failure becomes
a sticky terminal failure instead of an exception swallowed by the publisher.
Failure is checked before each further replay yield.

The procedure sets its outer cursor immediately before each replay or live
yield. Resync refusal uses that cursor, never an initial `since`, a discarded
entry or a live-only iterator's cursor. It is a server yield position, not proof
of client receipt. Return closes the capture before joining the generator's
return, so a pending live read wakes. Abort, overflow, reset, snapshot/start
failure, formatting failure and transport disconnect release the listener,
queue, age timer and shared watcher demand. Registration/capture precede shared
watcher startup; no second watcher system is created.

## Compatibility and limits

Inputs and tracked event frames are unchanged. There is no status frame, new
error-format field, grant, route or consumer migration. Resume uses explicit
`since`; tRPC `lastEventId` is not automatically translated into it. Retention is
in-memory and limited. This is not durable or exactly-once history.

The replay holds at most 500 retained event references; the live queue has the
limits above. Neither claim bounds aggregate bytes, all subscribers together or
the WebSocket adapter's send buffers. The barrier is not a network drain or
acknowledgment mechanism.

## Verification

The actual procedure and installed tRPC WebSocket adapter have a deterministic
handoff regression. The base delivers A, B, D after C is published during replay;
the barrier delivers A, B, C, D. Separate broken variants are rejected for a
watermark read from a later ring image, ID-based overlap suppression, and a
cursor assigned only after generator resumption. Tests also cover legacy frame
shape and cursor/source behavior, duplicate IDs, bounded replay capture,
terminal failures and cleanup. Publishers run in owned Worker isolates, without
transcript discovery or a live broker. Successful WebSocket tests stop or close
their subscription, close both endpoints and observe normal Worker exit; they
do not use `process.exit` or forced termination as cleanup proof.

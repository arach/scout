# Negotiated tail wire contract

`tail.events` keeps legacy mode as its default. Legacy callers receive only the
existing tracked TailEvents. This slice adds no authorization, consumer adoption,
new watcher or durable history.

## Negotiate v1

Send `tailProtocol: 1` with the existing optional `since` and `sources` input.
Optional `sinceEpoch` must be a UUID, require v1, and accompany a nonempty `since`.
Invalid combinations and unknown versions fail before a listener attaches.
tRPC's `lastEventId` is not an alias for `since`.

V1 sends one **untracked** first application data frame after tRPC's `started`:

```json
{
  "type": "tail.subscription",
  "schema": "scout.tail-subscription/v1",
  "epoch": "<opaque UUID>",
  "cursorFound": true,
  "cursorStatus": "found",
  "epochBinding": "matched",
  "replayLimit": 500,
  "replayCount": 12,
  "barrier": "bounded-replay-live/v1"
}
```

There is no `result.id` or tracked envelope on this frame. It is valid only as
the first data frame of a v1-negotiated generation. It never advances a delivered
cursor. An empty selected replay still gets status. Cancellation or failure
before a successful subscription can terminate without status. Every subsequent
data frame has the unchanged tracked TailEvent shape.

The process-owned aggregate creates one random epoch at initialization. Every
subscription and transport listener uses that epoch. It is not persisted or used
as authority. Destroying/resetting the buffer invalidates active captures and
rotates the epoch. An old subscription's error retains its captured epoch.

Cursor lookup examines the unfiltered last-500 image; source selection follows
lookup. Undefined/empty sources select all sources. `replayCount` counts selected
events after cursor resolution, not aggregate size.

| Cursor observation | cursorFound | cursorStatus | Replay |
| --- | --- | --- | --- |
| Omitted/empty since | null | not_requested | Selected retained window |
| Unique retained ID, no epoch mismatch | true | found | Selected suffix after ID |
| Unknown or outside last 500 | false | not_retained | Selected retained window |
| Different supplied epoch, even if ID matches | false | epoch_mismatch | Selected retained window |
| Multiple retained occurrences | false | ambiguous | Selected retained window |

`epochBinding` is `matched`, `mismatch` or `not_supplied`. Legacy duplicate-ID
resume keeps its first-match suffix behavior. None of these observations means
verified history, global ID uniqueness, durable completeness or client receipt.
An old server may strip the new input: absence of status is not v1 support.

## Structured resync

V1 normalizes capture refusal to the class-branded `TailResyncRequired`. The
router's formatter follows trusted tRPC cause wrappers and adds `error.data.tail`
on **`tail.events` only**:

```json
{
  "schema": "scout.tail-error/v1",
  "code": "resync_required",
  "lastDeliveredId": "<server-yielded ID or null>",
  "resyncRequired": true,
  "epoch": "<subscription epoch>"
}
```

Standard tRPC codes and fields remain unchanged. Text and arbitrary code/epoch
properties do not establish this brand. Generic/auth errors and other procedures
get no `data.tail`. Legacy resync errors keep their existing shape too; only v1
produces the branded error. The new field contains no raw cursor input, source,
path, cause, stack or credential.

The server cursor covers replay and live yields. Status, filtered events,
overlap and initial `since` do not advance it. A client must retain its own
last-yielded ID and that event's epoch, not copy a server-ahead cursor or rebind
an old ID merely because a new status arrived. Local attempt generation is not
the runtime epoch. Malformed metadata must never advance a consumer cursor.

C's unchanged legacy codec remains supported. Its later opt-in uses this mapping:

| Runtime observation | C reason | resyncRequired |
| --- | --- | --- |
| Valid `data.tail.code = resync_required` | server_error | true |
| Generic old-server subscription error | server_error | true, conservative |
| Standard UNAUTHORIZED/FORBIDDEN | auth_denied | false |
| Invalid negotiated metadata/framing | protocol_error | true |
| Unknown/restarted status | Not automatically terminal | Remain unverified; caller decides recovery |

## Evidence boundary

Owned Worker fixtures exercise the actual router, capture buffer, installed WS
adapter and JS client. Only publisher bindings are substituted, so no live
broker, transcript watcher or credential starts. The production service's shared
epoch and destructive-reset behavior have a separate test. Fixtures require
normal Worker exit, closed sockets/listeners and an explicit clean result. A
watchdog is failure, never evidence of cleanup.

The existing service's `devin-source` imports `bun:sqlite`; full service import
under Node remains outside its supported boundary at this base. The pure capture
and wire helpers, plus the compiled router with owned publisher bindings, can be
tested under Node without claiming full-service portability. Queue bounds are not
bounds on the WS adapter's send buffers and are not client acknowledgments.

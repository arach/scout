# Delivery commands and native-session replies

The broker owns durable command receipts. A client can prepare and submit a
retry-safe command without a web server or pairing bridge:

```ts
import { prepareScoutSessionReply, deliverScoutRequest } from "@openscout/runtime/delivery-client";

const prepared = prepareScoutSessionReply({
  clientMessageId: retainedDraftId,
  requesterId: "operator",
  requesterNodeId: nodeId,
  sessionId: nativeSessionId,
  harness: "codex", // or "claude"
  body: "Continue with the revised plan.",
  source: "my-client",
});
// Retain this command with the draft before submitting it.
const result = await deliverScoutRequest({ baseUrl, expectedNodeId: nodeId }, prepared);
```

`prepareScoutDelivery` also prepares ordinary tell/consult commands. Its input
contains a resolved `command`, an optional `clientMessageId`, and an optional
retained `createdAtMs`. It normalizes attachment fields and derives missing
attachment ids from the retained key. Explicit attachment ids survive.

## Identity and acceptance

A durable retry uses the same requester, request id and command content. The
broker fingerprints the whole normalized command. A same-key change to body,
target, attachment, metadata, execution settings or an explicit timestamp
conflicts. Do not regenerate those values during a retry.

The preparation helper preserves the existing `deliver-client-<SHA-256-prefix>`
key mapping. Keyed commands omit a newly sampled timestamp. If the caller
retains an explicit timestamp, it becomes part of the command. Unkeyed ordinary
sends get a generated id and time, but no `requestId` and no durable retry
promise. Native-session replies require a non-empty retained key.

**Keyed durable acceptance requires the daemon's configured receipt owner.**
The standard broker configures `BrokerRequestReceipts` and the acceptance
service together. An embedded acceptance service that omits that receipt owner
does not provide durable idempotency for ordinary keyed commands. Native input
refuses when receipts or input hooks are unavailable. Never construct a second
client-side receipt writer for broker-owned records.

Concurrent retries share the same acceptance operation. Completed receipts
replay after a restart. The broker can recover a lost receipt acknowledgement
from canonical acceptance evidence. The existing observation endpoint is:

```text
GET /v1/request-receipts/<requestId>?requesterId=<requesterId>&operation=deliver
```

Absence of acceptance evidence does not authorize a replacement instruction.
The guarantee is bounded idempotent acceptance, not global exactly-once mesh
execution or consensus.

## Native-session input

Native replies accept plain text and an exact local Claude or Codex session.
Attachments, remote targets, work items, project launches and execution
overrides are unsupported. `prepareScoutSessionReply` sets existing-session
execution and Codex's concurrent-writer guard. It does not prepend an address
to the prompt. `deliverScoutRequest` validates the submitted native session/harness receipt
or a resume flight before returning native acceptance. The exported
`validateScoutSessionReplyResult` applies that same check to protocol responses
or existing flattened adapter results; it rejects unconfirmed acceptance.

Before each submission, the public client freshly reads `/v1/node`, verifies
the expected node id, and requires `session-input-receipts/1`. It sends
`intent: "session_input"` with `sessionDelivery: "in_place_or_resume"` to
`POST /v1/deliver`. The broker boundary normalizes that wire intent to internal
`consult`. Internal service callers use the normalized command, not the HTTP
encoding. The public client uses HTTP or the selected Unix socket; it does not
send the wire encoding through an unchecked in-process shortcut.

The required wire intent is a compatibility fence. Old brokers use a required
`tell | consult` enum even though their schemas allow extra fields. They reject
`session_input`; they cannot ignore the option and execute ordinary consult
work if a broker replacement races the capability read.

For native replies, the broker also enforces the Codex concurrent-writer guard
when a raw client omits or disables `forkIfLive`. It applies that guard to an
internal execution copy after fingerprinting the original command. It never
adds the flag to the retained command or the fingerprint used for replay.
Previously stored receipts with the flag absent still replay without conflict.
Ordinary exact-session asks keep their existing park-until-released behavior.

A concurrent-writer refusal is a completed, replayable rejection. The same key
keeps returning that refusal after the writer leaves. Sending again after the
writer leaves is a new instruction and requires a new key.

The broker reserves `unknown` durably before live input. Only a definite
`not_live` result can fall through to exact-session resume within that same
reservation. A live refusal is replayable. `receipt.inputSubmitted` records
submission, not completed work; it has no execution flight. The canonical
message uses `audience.delivery: "none"` so recording it cannot type it again.

A throw, uncertain input result, timeout or caller abort after submission is
not proof that nothing ran. If input might have happened before its canonical
witness was saved, the request remains `request_outcome_unknown`. Retain the
original key and draft; do not automatically type, resume, fall back to an
ordinary ask, or submit a new key. The public client has no implicit retry loop.
Caller abort stops waiting, not the broker-owned command after reservation.

## Pairing adapters and client responsibility

The private bridge and phone wire keep `mobile.askSessionDurable` as a
versioned method. A legacy bridge must refuse that method without input; a
still older bridge returns method not found. Clients must not retry those
responses through legacy `mobile.askSession` or a direct input adapter.
A new field on an old method is insufficient because the old method can drop
unknown fields. The versioned method and the versioned broker intent protect
different hops. The runtime API does not replace bridge authentication or UI.

Each originating client must retain its key and command with its draft. A
fresh send with the same words is a new instruction, not an inferred retry.
Client-specific success text, draft persistence, authentication and pending UI
remain outside the broker. The open TUI still needs a separate migration from
its direct-input-first/web fallback path to this core command contract.

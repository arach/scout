# Scout Hub

Status: draft, decisions settled 2026-11-26. Nothing in this spec is built.
Layer: Platform (hosted). Wire types and clients: `openscout-app/scout`.
Hosted service: private platform repo.

Scout Hub is the hosted interchange for traffic that crosses machines. It
accepts events from any source, appends them to one log per workspace, routes
addressed work to a machine, agent or person, and delivers matching events to
subscribers. Hub serves the address `https://hub.oscout.net`.

Hub does not replace the per-machine broker. Work on one machine never waits on
Hub. Peers that can dial each other directly keep using the mesh.

## Scope

In scope:

- one append-only event log per workspace;
- ingress for brokers, Scout Cloud machines, remote MCP clients, vendor-cloud
  sessions and tool webhooks;
- routing to online, offline and sleeping targets;
- subscriptions with a search-style query and four delivery kinds;
- one outbound link from each broker to Hub;
- the `scout hub` CLI and the `hub_*` MCP tools.

Out of scope:

- routing same-machine or direct-mesh traffic through Hub;
- storing harness transcripts in plaintext;
- a self-hosted Hub server (the Hub URL stays configurable, see Decisions);
- compound or windowed triggers (`3 errors in 10m`);
- general automation that is not Scout coordination (Zapier-style flows);
- enterprise compliance claims.

## Current system

These facts are verified at `536ff537`. They must remain true unless a
requirement below changes them.

- **Broker.** `packages/runtime/src/broker.ts` (`InMemoryControlRuntime`) is the
  per-machine bus. It exposes `subscribe(listener)` for `ControlEvent`
  (`packages/protocol/src/events.ts`) and handles `stream.subscribe`.
  `broker-daemon.ts` is the composition root.
- **Journal.** `FileBackedBrokerJournal` (`broker-journal*.ts`) appends to
  `<control home>/broker-journal.jsonl` with fsync. Each broker is the only
  writer of its journal and SQLite projections.
- **Delivery.** `broker-delivery-store.ts` persists `DeliveryIntent` and
  `DeliveryAttempt` with fenced leases. Transports are listed in
  `DeliveryTransport` (`packages/protocol/src/common.ts`).
- **MCP events.** `broker-mcp-events.ts` implements SEP-3415 events for
  `flight.completed`, `work.waiting` and `message.created` on one machine only.
- **Ephemeral events.** `EPHEMERAL_CONTROL_EVENT_KINDS` (for example
  `presence.updated`) fan out live and never enter the journal.
- **Mesh.** `packages/protocol/src/mesh.ts` defines the hosted addresses
  `https://mcp.oscout.net` (MCP relay), `https://mesh.oscout.net` (presence
  rendezvous) and `wss://mesh.oscout.net/v1/relay` (phone pairing relay).
  `scout mesh bridge` (`packages/cli/src/cli/commands/mesh-bridge.ts`,
  `packages/runtime/src/mesh-bridge-supervisor.ts`) tunnels the local MCP server
  to `mcp.oscout.net`. If that Mac is offline, callers get `node_unreachable`.
- **Today's `scout hub`.** `packages/cli/src/cli/commands/hub.ts` and
  `packages/runtime/src/hub/` collect vendor-cloud sessions into
  `<OPENSCOUT_HOME>/hub/`:
  - `claude-code`: a repo hook seals transcript chunks (`seal.ts`, X25519 +
    HKDF-SHA256 + AES-256-GCM) and posts them to a user-deployed Cloudflare
    Worker (`integrations/hub-inbox`). `HubCollectorService` polls it every 15 s.
  - `managed-agents`: `ManagedAgentsPuller` polls Anthropic's API every 15 s
    with `$ANTHROPIC_API_KEY`.
- **Integrations.** Slack (`integration-slack-events.ts`,
  `slack-worker-supervisor.ts`) and Vercel Board (`vercel-board/service.ts`) run
  as workers inside one local broker.
- **Push.** `mobile-push.ts` sends through a separate push relay.
  `mobile-push-seal.ts` seals payloads per paired phone.

## Terms

- **Workspace**: the account or crew that owns one Hub log.
- **Source**: a producer of Hub events. Kinds: `broker`, `scout-cloud`, `mcp`,
  `claude-code`, `managed-agents`, `github`, `vercel`, `slack`, `webhook`.
- **Event**: one `HubEvent` record on the log.
- **Route**: the delivery of one addressed event (an ask, a reply, a forward) to
  one target node, agent or person.
- **Subscription**: a stored `HubFilter` plus one delivery action.
- **Subscriber**: the principal that receives a subscription's deliveries.
- **Hub link**: the one outbound WSS connection from a broker to Hub.
- **Facets**: the unsealed fields of an event that Hub can filter and route on.

## Wire types

Add `packages/protocol/src/hub.ts` and export it from
`packages/protocol/src/index.ts`.

```ts
export type HubSourceKind =
  | "broker" | "scout-cloud" | "mcp" | "claude-code" | "managed-agents"
  | "github" | "vercel" | "slack" | "webhook";

export interface HubEvent {
  v: 1;
  id: ScoutId;              // UUIDv7, minted by the producer
  seq: number;              // assigned by Hub on commit, per workspace, starts at 1
  idempotencyKey: string;   // e.g. "github:delivery:<guid>", "node:<nodeId>:evt:<id>"
  source: HubSourceKind;
  sourceId: string;         // configured source id or origin nodeId
  kind: string;             // e.g. "flight.updated", "deploy.failed", "session.chunk_ready"
  ts: number;               // Hub commit time, epoch ms
  originTs?: number;        // producer time, not used for ordering
  facets: {
    actorId?: ScoutId; nodeId?: ScoutId; targetNodeId?: ScoutId;
    project?: string; repo?: string; branch?: string;
    conversationId?: ScoutId; invocationId?: ScoutId; flightId?: ScoutId;
    sessionHandle?: string; labels?: string[];
    severity?: "info" | "warn" | "error";
  };
  body:
    | { encoding: "json"; summary: string; data: Record<string, unknown> }
    | { encoding: "sealed"; alg: "x25519-aes-256-gcm-v1"; recipientKeyId: string;
        ciphertextRef: string; byteLength: number };
  untrustedExternalContent?: true;
}

export interface HubSubscription {
  id: string;                          // "sub_<ulid>"
  workspaceId: string;
  owner: ScoutId;                      // principal that created it
  query: string;                       // source text, see "Subscription query"
  filter: HubFilter;                   // parsed form of `query`
  deliver:
    | { kind: "notify"; devices: "phone" | "mac" | "all"; urgency: "interrupt" | "badge" | "silent" }
    | { kind: "fyi"; target: string }
    | { kind: "ask"; target: string; harness?: string; on?: string; prompt: string }
    | { kind: "webhook"; url: string };
  state: "active" | "degraded" | "paused";
  cursor: number;                      // last delivered seq
  createdAt: number;
}

export type HubFilter =
  | { op: "and" | "or"; args: HubFilter[] }
  | { op: "not"; arg: HubFilter }
  | { op: "eq"; field: HubFilterField; value: string }
  | { op: "text"; value: string };

export type HubFilterField =
  | "source" | "kind" | "project" | "repo" | "branch" | "actor" | "node"
  | "label" | "severity";
```

Also:

- In `packages/protocol/src/common.ts`, add `"hub"` to `DeliveryTransport` and
  `"subscription"` to `DeliveryReason`.
- In `packages/protocol/src/mesh.ts`, add
  `DEFAULT_OPENSCOUT_HUB_URL = "https://hub.oscout.net"`. Keep the existing
  `mcp.oscout.net` and `mesh.oscout.net` constants.

## Modes of interconnection

Hub has one contract: the Hub HTTP API. Every other mode is a client of that
API or a fixed-purpose channel beside it. A capability must exist in the API
before the CLI or MCP exposes it.

### Current state

These facts are verified at `536ff537`:

- On one machine, the CLI and both local MCP servers (`scout mcp` over stdio,
  `scout mcp serve` over shared HTTP) are clients of the broker HTTP API. The
  paths are in `scoutBrokerPaths` (`packages/protocol/src/broker-routes.ts`).
  Local MCP tool selection is set by profile (`docs/mcp-api-posture.md`).
- Remote MCP clients use the hosted gateway at `mcp.oscout.net`. The gateway
  has its own tool catalog, `mcp:core` (`packages/protocol/src/mcp-core-tools.ts`).
  Local profiles do not change that catalog.
- Agents in a cloud VM with a shell use the remote client and `scout login
  --as <client>` (OAuth with PKCE), or a static `SCOUT_TOKEN`
  (`docs/integrations.md`).

### The modes

| Mode | Who uses it | Transport | Auth |
| --- | --- | --- | --- |
| Hub API | apps, services, the CLI, the gateway | HTTPS `/v1/hub/*`, SSE for streams | OAuth access token or scoped `agent_token` |
| Hub link | brokers and Scout Cloud machines only | one WSS at `/v1/hub/link` | node credential bound to the Ed25519 key |
| Remote MCP | agents in MCP hosts (Claude, ChatGPT, Cursor) | MCP HTTP at `/mcp` | MCP OAuth 2.1 + PKCE |
| CLI | people, scripts, agents with a shell | the local broker, or the Hub API when there is no broker | the machine's sign-in, or `scout login` |
| Webhook ingress | GitHub, Vercel, Slack, generic senders | HTTPS `POST /v1/ingest/<sourceId>` | provider signature |
| Chunk ingress | `claude-code` reporters in vendor sandboxes | HTTPS `POST /v1/sources/claude-code/chunks` | per-repo `shw_` token |
| Outbound | subscribers | APNs/FCM push, signed webhook `POST`, MCP events | per subscriber |

### Choose a mode

- If the agent runs in an MCP host, use remote MCP.
- If the agent runs in a VM with a shell and no MCP, use the CLI with
  `scout login`.
- If the agent or person is on a machine with a Scout broker, use the local CLI
  or local MCP. The broker carries the call to Hub over its Hub link. Local
  clients must not open their own connection to Hub.
- If the caller is an app, a service or an integration that is not an agent,
  use the Hub API.
- If the sender is a third-party tool, use webhook ingress.
- Only brokers use the Hub link. No other client may use it.

### Parity

One operation has one name and one argument shape in every mode. The API is
the source of truth.

| Operation | Hub API | MCP tool | CLI |
| --- | --- | --- | --- |
| Read the log | `GET /v1/hub/events?query=&since=&limit=` | `hub_log` | `scout hub log` |
| Stream the log | `GET /v1/hub/stream?query=&since=` (SSE) | MCP events (`events/subscribe`) | `scout hub tail` |
| Create a subscription | `POST /v1/hub/subscriptions` | `hub_subscribe` | `scout hub subscribe` |
| List subscriptions | `GET /v1/hub/subscriptions` | `hub_subscriptions` | `scout hub subscriptions` |
| Delete a subscription | `DELETE /v1/hub/subscriptions/<id>` | `hub_unsubscribe` | `scout hub unsubscribe` |
| Start or continue a task | `POST /v1/hub/asks` | `ask` | `scout ask` |
| List sources | `GET /v1/hub/sources` | not exposed in `mcp:core` | `scout hub sources` |
| Connect a source | `POST /v1/hub/sources` | not exposed in `mcp:core` | `scout hub connect` |

Rules:

1. `POST /v1/hub/asks` must accept the same body as the MCP `ask` tool,
   including `requestId`, and must return the same receipt.
2. The CLI and MCP must return the same error codes as the API, for example
   `host_offline_queued`, `wake_failed`, `query_parse_error`, `forbidden` and
   `rate_limited`. The CLI prints the code and exits nonzero.
3. Source connection uses a browser OAuth step, so it stays in the CLI and the
   apps. It is not in `mcp:core`.
4. Add the `hub_*` tools to `mcp:core`. Locally, add them as a new MCP profile
   group `hub`, not to the 14 default tools.
5. Every mode must resolve to one principal. A gateway-authenticated identity
   overrides any sender field in the request.

## Requirements

### Log

1. Hub must assign `seq` on commit. `seq` must increase by one for each
   committed event in a workspace.
2. Hub must deduplicate on `(workspaceId, idempotencyKey)` for 8 days. A
   duplicate must return the existing `seq` and must not create a second
   delivery.
3. Hub must order events by commit. Hub must not order by `originTs`.
4. Hub must keep events for 7 days in the MVP. Longer retention is a later,
   per-tier setting.
5. Hub must not store `EPHEMERAL_CONTROL_EVENT_KINDS` on the log. Hub keeps only
   the latest presence for each node and agent, in memory.
6. Hub must not store harness transcripts in plaintext. Transcript bytes arrive
   only as sealed chunks, which Hub keeps for 7 days.

### Ingress and auth

1. A broker or Scout Cloud machine must authenticate with an account-issued
   credential bound to its Ed25519 node key (`packages/runtime/src/node-identity.ts`).
   The CLI stores it in the macOS Keychain, or in a mode-`0600` file on Linux.
   The CLI must not print it.
2. Hub must verify each webhook signature before it commits the event:
   `X-Hub-Signature-256` (GitHub), `x-vercel-signature` (Vercel) and
   `X-Slack-Signature` with a 5-minute replay window (Slack). If verification
   fails, Hub returns `401` and commits nothing.
3. Hub must set `untrustedExternalContent: true` on every event that carries
   third-party text. Agents must receive that text as quoted source material,
   not as operator instructions. Follow `vercel-board/service.ts`.
4. Remote MCP clients must authenticate with OAuth 2.1 + PKCE or a scoped
   `agent_token`. The authenticated identity overrides any sender field in a
   tool call.
5. `claude-code` reporters must use per-repo, revocable, write-only tokens
   (`shw_<id>_<secret>`). One token must not write for another repo.

### Routing

1. Hub must resolve targets with Scout's existing address forms: project plus
   capability, `@agent`, `target:<name>`, `session:<handle>` and
   `--on <host>`.
2. If the target node has an open Hub link, Hub must forward the event over that
   link.
3. If the target is a sleeping Scout Cloud machine, Hub must wake it, hold the
   delivery lease until its Hub link opens, and then forward the event.
4. If the target is an offline Mac, Hub must queue the delivery and return a
   receipt with `state: "queued"` and `reason: "host_offline_queued"`. Hub must
   not return `node_unreachable` for a known, enrolled node.
5. If direct mesh delivery fails, `peer-delivery.ts` should fall back to the
   `"hub"` transport.

### Hub link (broker side)

1. Each signed-in broker must hold one outbound WSS connection to Hub. It
   replaces the `scout mesh bridge` child process and the HTTP presence loop in
   `mesh-rendezvous.ts`.
2. On connect, the broker must send its last acknowledged `seq`. Hub must then
   send every queued delivery after that `seq`, in order.
3. The broker must commit each inbound delivery to `BrokerDeliveryStore` and
   `BrokerRequestReceipts` before it acknowledges the `seq`. A delivery must
   run at most once.
4. `HubOutboxService` must tail the journal through `BrokerJournalReplayBarrier`
   and publish only cross-system facts: agent and node cards, workspace channel
   messages, cross-node flights, operator questions, Feed posts and shows.
5. If the Hub link is down, local work must continue unchanged. The outbox must
   flush in journal order when the link returns.
6. If the user is not signed in, the broker must make no calls to `oscout.net`.

### Subscriptions

1. The CLI, MCP tools and apps must all write the same `HubSubscription` record
   through one Hub API.
2. Hub must check that the owner can read an event both when the subscription
   is created and before each delivery.
3. `ask` deliveries must carry a `triggerDepth`. Hub must reject a delivery
   with a depth above 3.
4. Each subscription with an `ask` delivery must wake an agent at most 5 times in
   10 minutes. When the budget runs out, Hub must pause the subscription and
   notify the owner once.
5. After 7 failed retries with exponential backoff, Hub must set the
   subscription to `degraded`. A degraded subscriber must not slow the log.
6. `webhook` deliveries must use a URL verified by challenge-response
   (`mcp-event-webhook.ts`), and Hub must sign each payload.
7. If the owner loses access, Hub must send a `terminated` frame with no event
   data and stop delivering.

### Subscription query

The query is a search-style string. The CLI parses it into `HubFilter` and sends
both the string and the parsed form.

```
query  := term (("OR" | "AND" | " ") term)*      ; a space means AND
term   := "-"? (field ":" value | quoted | word)  ; "-" means NOT
field  := source | kind | project | repo | branch | actor | node | label | severity
quoted := '"' text '"'                            ; text match
word   := text                                    ; text match
```

- A field term matches the event facet exactly. `kind:` also matches a prefix
  when the value ends in `.*` (`kind:deploy.*`).
- A text term matches case-insensitively in `body.summary` and in the string
  values of `body.data`. A text term never matches a sealed body.
- A sealed event can still match on its facets.
- An unknown field must be a parse error. The CLI must show the field and the
  accepted list.

Examples:

```
source:vercel kind:deploy.failed project:talkie
source:github kind:check_suite.failed branch:main repo:my-org/talkie
project:talkie OR "auth-migration"
"ENOSPC" -source:slack
```

### Privacy

1. These bodies must be sealed, so that Hub cannot read them: transcript chunks,
   paired phone streams, push payloads, and DMs or attachments that the user
   marks `sealed`.
2. These bodies are readable by Hub, are encrypted at rest and are sent over
   TLS: webhook payloads, workspace channel messages, Feed posts, flight
   summaries, and MCP tool calls that pass through Hub.
3. Hub must not hold any key that opens a sealed body.
4. Full-text search over transcripts stays local (`scout search`).

### Limits

- Ingress: 60 requests per minute burst and 300 per minute sustained, per source
  token. Over the limit, Hub returns `429` with `Retry-After`.
- Maximum JSON event: 256 KiB. Maximum sealed chunk: 32 MiB
  (`DEFAULT_MAX_CHUNK_BYTES` in `integrations/hub-inbox/src/worker.ts`).
- Subscriptions: 100 active per principal, 500 per workspace.
- Pending deliveries: 1,000 per subscription.

## CLI

All commands live under `scout hub` in `packages/cli/src/cli/commands/hub.ts`
and `registry.ts`. Existing subcommands (`status`, `connect`, `disconnect`,
`collect`, `init`) keep their behavior.

```bash
scout hub status
scout hub connect github --repo <owner/repo>
scout hub connect vercel --project <name>
scout hub connect slack
scout hub connect claude-code <repo path>      # existing; points at Hub when signed in
scout hub connect managed-agents [--pull-on hub|local]
scout hub sources
scout hub subscribe '<query>' --notify phone|mac|all [--urgency interrupt|badge|silent]
scout hub subscribe '<query>' --fyi <target>
scout hub subscribe '<query>' --ask --project <name> [--on <host>] [--harness <h>] --prompt '<text>'
scout hub subscribe '<query>' --webhook <url>
scout hub subscriptions
scout hub unsubscribe <sub_id>
scout hub tail '<query>'
scout hub log [--since <seq>]
```

`scout mesh bridge` must keep working as an alias that starts the Hub link.

## MCP tools

Add to `packages/protocol/src/mcp-core-tools.ts` and register in
`packages/cli/src/mcp/scout-mcp.ts`:

- `hub_log` (`query?`, `since?`, `limit?`): read events.
- `hub_subscribe` (`query`, `deliver`): create a subscription for the caller,
  or for the operator if the caller has that grant.
- `hub_unsubscribe` (`id`).
- `hub_subscriptions`.

Hub must answer `who`, `hosts`, `messages_inbox`, `broker_feed` and `hub_log`
from its own data when the owning Mac is offline. Hub must forward host-specific
tool calls over that host's Hub link.

## Failure behavior

| Condition | Required behavior |
| --- | --- |
| Hub unreachable from a broker | Local work continues. Outbox holds and flushes in order on reconnect. |
| Target Mac offline | Receipt `queued` / `host_offline_queued`; delivered on reconnect. |
| Scout Cloud wake fails | Delivery fails with `wake_failed` and the Fly error; the asker sees it on the receipt. |
| Webhook signature invalid | `401`; nothing committed. |
| Duplicate idempotency key | Existing `seq` returned; no new delivery. |
| Subscriber endpoint failing | 7 retries, then `degraded`; log unaffected. |
| Ask loop | Depth above 3 rejected; wake budget pauses the subscription and notifies the owner once. |
| Owner loses read access | `terminated` frame, no data; delivery stops. |
| Query has an unknown field | Parse error naming the field; nothing stored. |

## Files to change

Protocol: `packages/protocol/src/hub.ts` (new), `index.ts`, `common.ts`,
`mesh.ts`, `events.ts` (`ControlEvent` to `HubEvent` projection),
`mcp-events.ts`, `mcp-core-tools.ts`.

Runtime: `packages/runtime/src/hub/link.ts` (new), `hub/outbox.ts` (new),
`hub/index.ts`, `hub/state.ts`, `hub/collector.ts`, `hub/connect.ts`,
`hub/managed-agents.ts`, `broker-daemon.ts`, `peer-delivery.ts`,
`mesh-bridge-supervisor.ts`, `mesh-bridge-config.ts`, `mesh-rendezvous.ts`,
`broker-mcp-events.ts` (keep for loopback and offline use).

CLI and MCP: `packages/cli/src/cli/commands/hub.ts`, `cli/registry.ts`,
`mcp/scout-mcp.ts`, `mcp/mesh-bridge.ts`, `mcp/mcp-events.ts`,
`packages/mesh-extension/src/main.ts`.

Keep `integrations/hub-inbox` as the self-hosted reference inbox.

The hosted service (ingress, log, router, matcher, push, Fly wake) lives in the
private platform repo. The public core must not import from it.

## MVP slices

Build in this order. Each slice must pass its checks before the next starts.

1. **Wire types.** `hub.ts`, the `common.ts` and `mesh.ts` additions, and the
   query parser.
   - Unit tests parse every example in "Subscription query" to the expected
     `HubFilter`, and reject an unknown field.
2. **Log and ingress.** Hosted log with `seq`, idempotency and 7-day retention.
   GitHub and Vercel webhooks with signature checks.
   - Sending the same GitHub delivery twice gives one event and the same `seq`.
   - A bad signature gives `401` and no event.
3. **Hub link.** `link.ts` and `outbox.ts` in the broker, replacing the bridge
   and presence loop. `scout mesh bridge` becomes an alias.
   - Kill the network for 5 minutes during a flight. Local work completes. On
     reconnect, every cross-system event appears on Hub once, in journal order.
   - With the user signed out, a packet capture shows no traffic to
     `oscout.net`.
4. **Routing and remote MCP.** Queue for offline Macs, wake for Scout Cloud.
   Hub answers reads when the Mac is offline.
   - From a remote MCP client, `ask` a sleeping Mac. The receipt is `queued`.
     Wake the Mac. The ask runs exactly once.
   - `hub_log` returns results with every Mac offline.
5. **Subscriptions.** `HubSubscription`, the matcher, `notify` and `ask`
   deliveries, the CLI commands and the MCP tools. Loop guard and wake budget.
   - `scout hub subscribe 'source:vercel kind:deploy.failed project:talkie' --notify phone`,
     then post a failed-deploy webhook. The phone gets one push.
   - An `ask` subscription that matches its own output stops after 5 wakes in
     10 minutes, and the owner gets one notice.
   - Create the same subscription through the API, `hub_subscribe` and
     `scout hub subscribe`. The three stored records are equal apart from `id`
     and `createdAt`. A bad query gives `query_parse_error` in all three.
6. **Vendor-cloud sessions.** Point `claude-code` chunk ingress at Hub when the
   user is signed in, with per-repo `shw_` tokens. `session.chunk_ready`
   triggers `collectOnce()` instead of 15-second polling.
   - A Claude Code on the web session appears in `<OPENSCOUT_HOME>/hub/` with
     no Wrangler deploy. Hub storage holds ciphertext only.

Later phases: Slack, Linear and Sentry webhook sources through Hub; Managed
Agents, Codex Cloud and Devin pullers running in Hub; a subscription builder in
the apps, digests and quiet hours; crew workspaces.

## Decisions

Settled by Art on 2026-11-26.

1. **Privacy is tiered.** Sealed: transcripts, phone streams, push, sealed DMs.
   Readable: coordination events. Reason: keyword subscriptions and remote MCP
   must work while every Mac is asleep.
2. **Subscriptions use a search-style query** parsed to a typed filter. Matching
   is deterministic. When a match needs judgment, the subscription wakes an
   agent.
3. **One CLI command, `scout hub`,** covers sources, subscriptions and the log.
   `scout mesh bridge` becomes an alias.
4. **Hub is hosted only for now.** The protocol is open. `OPENSCOUT_HUB_URL`
   must override the default address, so that a self-hosted Hub stays possible
   later.
5. **Slack and Vercel go through Hub when the user is signed in.** Local-only
   setups keep the broker-supervised workers.

Proposed, not yet confirmed by Art:

6. **Local clients reach Hub through their broker.** A CLI or MCP call on a
   machine with a broker goes over the broker's Hub link, never directly to
   Hub. Reason: one credential per machine, and calls queue while offline.
7. **The Hub API is the only contract.** The CLI and MCP are clients of the
   API, with the same names and errors.

## Not verified

- The 3–4 week MVP estimate is the drafting model's estimate. Nobody has checked it.
- The Fly wake time (about 2 s) comes from the Scout Cloud spec draft. Nobody has
  measured it.
- Pricing tiers and retention beyond 7 days are not decided.
- `scout auth login` today issues an `osdist_*` key for distribution access. Using
  it to issue node credentials for Hub is an assumption. Confirm it in
  `packages/cli/src/cli/commands/auth.ts` before building slice 3.

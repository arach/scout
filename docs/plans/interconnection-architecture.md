# Interconnection architecture and the native work record

Status: **draft for operator review.** The types in `packages/protocol` are
drafts. Nothing in the runtime reads or writes them yet.

This spec gives the data model for two things:

- the work record Scout owns, with claim and lease built in;
- the layer that connects that record to Slack, Linear, GitHub and later
  systems.

It folds in the parked claim work (pull request 165) instead of shipping it on
its own. It builds on the private integration-layer design and its review. It
keeps findings M4 to M9 from that review. It also keeps the Linear direction:
lean into Linear's agent surface. All five items in the Linear direction's
"verify" table (§3.2) hold, and section 6 maps each one.

## 1. Principles

1. **Own by default (M8).** Native mode is the default. A work item with no
   ticket link owns every field. A link to Linear or Slack is turned on per
   project or per channel. Turning one on never moves the claim, attempts,
   plan, waiting state, acceptance or receipts out of Scout.
2. **The runtime is the only writer.** Adapters return normalized data and
   carry out the writes the runtime asks for. They never write Scout records:
   not links, not ledgers, not work items.
3. **Declarative where possible.** An adapter is a descriptor plus a small
   module. Deduplication, cursors, change detection, deletion tracking, echo
   suppression and retries belong to the runtime normalizer.
4. **Addressed means delivery. Ambient means observation.** Only an addressed
   event can start or continue work. Ambient content is source material. It
   never routes and never instructs.
5. **Security only at the intersection (M9).** Scout bounds what it supplied
   to a flight or recorded for it. When a harness reads through its own tools,
   for example a Slack MCP server, the harness fences that read, not Scout.
6. **Records first, rules with P1 (M4).** The records below land in P0. The
   rules that read them are enforced with P1. P1 already writes back to Slack
   and Linear: replies in the thread, decision messages, backlinks, agent
   activities (M5). Write-back is not deferred to P3.

## 2. The data model on one screen

| Record | Module | Owns |
| --- | --- | --- |
| `WorkItemRecord` (extended) | `collaboration.ts` | The item: title, state, owner, next mover, priority, relations. New: `key`, `revision`, `claim`, `claimGeneration`, `responsiblePrincipalId`, `deferUntil`, `audience` |
| `WorkClaim` | `work-claims.ts` | Who holds the next move now: holder, session, flight, generation, lease (active or parked) |
| `WorkLink` = `TicketWorkLink` \| `ThreadWorkLink` \| `ArtifactWorkLink` | `work-links.ts` | One edge from a work item to one external object. Its role, status, audience and how it was made |
| `TicketSyncState` | `work-links.ts` | The link's field policy, merge base, last external values, delegate, agent session, tracker automation |
| `WorkLinkDivergence` | `work-links.ts` | A proposal or conflict on a link, routed to the owner of the field |
| `ExternalConnection` | `interconnect-ledgers.ts` | One installed workspace, organization or installation: the pinned descriptor, a reference to the credential, scope, health |
| `ExternalActor` | `external-identity.ts` | One external user, and whether that user is linked to a Scout principal |
| `SourceAudience`, `AudienceStamp` | `external-identity.ts` | Who could read the source, and the narrowest audience of everything an item or summary was built from |
| `ExternalEventRecord` | `interconnect-ledgers.ts` | Inbound ledger: one row per provider event, written before the ack |
| `ExternalRecordState` | `interconnect-ledgers.ts` | Records cache: the latest normalized copy of each external object, with its hash, last action and tombstone |
| `ExternalStreamCursor`, `ExternalSyncRun` | `interconnect-ledgers.ts` | Cursors saved in the same write as their effects. Full runs, sweeps, the mass-delete hold |
| `ExternalDelivery` | `interconnect-ledgers.ts` | Outbound ledger: each write Scout makes, with an idempotency key, an echo marker, a revision and attribution |
| `ArtifactReceipt` | `interconnect-ledgers.ts` | Why an artifact exists: work, flight, claim generation, requester, responsible person, and the identity that authored it |
| `AdapterDescriptor` | `adapter-descriptors.ts` | What a system's records are: streams, keys, cursors, deletion, field maps, identity, addressing, capabilities |
| `PolicyRecord` = grant \| ceiling \| audience \| disclosure | `interconnect-policy.ts` | Who may request which class of action, where, and how a refusal reads |
| `InvocationRequest.responsiblePrincipalId` | `invocations.ts` | The person at the root of the chain. Continuations and retries inherit it. It is never an agent |

## 3. The native work record

### 3.1 New fields

All are optional, so existing records stay valid. A test asserts this.

| Field | Purpose |
| --- | --- |
| `key` | A human-readable key such as `SCO-142`. In tracker-leaning mode it shows the linked ticket's key. |
| `revision` | Goes up on every write. Commands that carry `expectedRevision` fail with `work_revision_mismatch` instead of overwriting. |
| `claim` | The current `WorkClaim`, or nothing. |
| `claimGeneration` | A counter that survives release, so a later claim never reuses a generation. |
| `responsiblePrincipalId` | The person accountable for the work. The owner falls back to this field, never to the agent. |
| `deferUntil` | The item is not ready before this time. Retry backoff uses it. |
| `audience` | The `AudienceStamp` of every source the item was built from. |

`externalContext` is deprecated. The active ticket link's `observed` field now
holds the same `ExternalWorkContext`, and the runtime keeps projecting it onto
the item for existing readers.

### 3.2 Claim: the holder is the delegate, not the owner

A claim makes its holder `nextMoveOwnerId`. The owner does not change. When an
item has no owner, the owner falls back in this order: the existing owner, the
responsible person, the requester, then the actor. This matches Linear's split
between delegate and assignee: an agent works the issue, and a person stays
accountable for it. Pull request 165 made the claimant the owner. This spec
reverses that (question Q1).

| Action | Who | Effect | Event |
| --- | --- | --- | --- |
| `claim`, open item or lapsed lease | anyone | State becomes `working`. Generation goes up by one. A lease starts. | `claimed`, or `reclaimed` if a lease lapsed |
| `claim`, own active claim | holder | Renews the lease | none |
| `claim`, held by another | anyone | Conflict `work_claim_held`, with the holder and `retryAfterMs` | none |
| `claim`, parked by another | anyone | Conflict `work_claim_parked` | none |
| `renew` | holder, same generation | Extends an active lease | none |
| `release` | holder with the same generation, anyone once the lease lapsed, or `force` | State becomes `open`. The claim is cleared and the generation kept. | `released` |
| `handoff` | holder or `force` | New holder. Generation goes up by one. Parked stays parked. | `handoff` |
| `expire` | the runtime, after the lease lapses | State becomes `open`. The claim is cleared. | `lease_expired` |

Generation is the fence. A renewal, release or write that carries an old
generation fails with `work_claim_stale_generation`. A receipt records the
generation that produced it.

### 3.3 The lease parks during waiting and review

| Move to | Claim |
| --- | --- |
| `working` | Re-arms the lease. Holder only; anyone else gets `work_claim_held`. |
| `waiting`, `review` | Parks the lease. It has no expiry, and the holder keeps the item. |
| `open`, `done`, `cancelled` | Clears the claim. |

An item waiting hours for a person's answer is not reclaimable. When the person
answers, the holder resumes and the lease re-arms. `validateWorkClaimPlacement`
enforces this table (question Q2).

### 3.4 Retries and readiness

Each retry is a new claim on the same item. The runtime sets `deferUntil` for
backoff, and the old flight keeps its own attempt record. The issue runner's
`attempt`, `nextRetryAt` and `lastError` fields move to the flight and to
`deferUntil`.

`workReadiness` computes the ready queue. An item is ready when all of these
are true:

- it is `open`, or `working` with a lapsed lease (reported as `reclaimable`);
- it has no active or parked claim;
- it is not deferred;
- no `blocks` or `depends_on` relation points at an unsettled item;
- no foreign agent holds it as the tracker's delegate (Linear direction §3.3).

## 4. Links

### 4.1 One link record

`WorkLink` merges two records. `ExternalWorkContext` was one read-only
observation on the item. The issue runner's `IssueBinding` was a binding with
no field policy. Neither one knew about the other. The new record is a
discriminated union on `kind`:

- `ticket`: a Linear issue, later Jira or Asana. It carries `TicketSyncState`.
- `thread`: a Slack thread, which points at the `ConversationBinding` that
  routes replies.
- `pull_request`, `commit`, `branch`, `document`: artifacts. Each carries an
  observation and, when Scout made the artifact, a receipt.

A link has a `role`:

- `origin`: the request started there;
- `tracker`: the ticket tracks the item;
- `artifact`: Scout produced it;
- `reference`: it mentions the item.

The runtime checks how a link was made in this order:

1. `created_by_scout`
2. `delegation`
3. `mention`
4. `thread_reply`
5. `backlink_marker`
6. `key_reference`
7. `manual`
8. `inferred`

An inferred link has status `suggested`. It never wakes an agent, changes
state or widens visibility, and it does not count toward the invariants.
`validateWorkLinks` enforces three invariants:

- An external object has at most one active link.
- A work item has at most one active ticket link.
- A link's audience comes from the linked object's connection.

### 4.2 Field ownership

| Field | Native | Tracker-leaning |
| --- | --- | --- |
| title, summary, priority, labels, owner, relations, parent | Scout | external |
| state | Scout | shared: the tracker owns the category, and Scout owns the sub-state |
| claim, attempts, plan, waiting, acceptance, receipts | Scout | Scout |

Only `state` can be shared. Linear's state types (`triage`, `backlog`,
`unstarted`, `started`, `completed`, `canceled`) set a floor:

- `started` means at least `working`. Scout still decides between `working`,
  `waiting` and `review`.
- `completed` means `done`.
- `canceled` means `cancelled`.

An unmapped custom state becomes a connection warning. It is never dropped
silently.

### 4.3 Three-way merge and proposals

`ticket.base` holds the last value both sides agreed on for each field. On
each inbound observation or outbound change, the runtime compares base,
external and Scout, field by field:

- If only the owner changed the field, apply the change and update the base.
- If the non-owner wrote the field, open a `proposal` divergence. The field's
  owner gets it as a decision.
- If both sides changed the field since the base, open a `field_conflict`.

A divergence goes to the field's owner, then the work owner, then the next
mover. It does not go to the operator by default. A structural divergence
(`deletion`, `closure`, `reopen`, `routing`, `policy`) never deletes or
closes Scout work. A deleted ticket leaves the item open, with a divergence.

### 4.4 Sync and run modes

`syncMode` controls which way data flows: `import_only`, `export_only`,
`bidirectional`, `observer` or `disabled`.

`runMode` controls who starts work:

- `scout_controlled`: Scout's own claims.
- `tracker_driven`: the tracker's delegation starts flights.
- `observer`: Scout watches and never claims.

## 5. Identity and audience

### 5.1 External actors

An `ExternalActor` is one user in one system: a Slack user in a team, or a
Linear user in an organization. `actorType` is one of `human`, `scout_app`,
`foreign_agent`, `integration` or `unknown`. `membership` is `member`, `guest`
or `unknown`.

An actor's link state moves from `unlinked` to `candidate` to `linked`, and
can end as `revoked`.

- **An email match only makes a candidate, never a link.** A link needs a
  confirmation: `self_confirm` through a slash command, a tracker's auth
  signal or the front door, or `admin_confirm`.
- Scout's own app actor can never be linked. Every event it authored is an
  echo.

### 5.2 Source audience (M9)

Every link, cached record and derived item carries a `SourceAudience`: the
adapter, the instance, the container, and a visibility of `org_public`,
`private`, `external_shared` or `unknown`.

`narrowAudience` unions the sources and keeps the narrowest visibility for
each source. The stamp's `basis` is always `supplied_or_recorded`. It bounds
only what Scout supplied or recorded for a flight.

`canReadAudience` requires the reader to pass every source:

- `org_public`: a linked member actor, or a fresh membership observation.
- `private`, `external_shared` and `unknown`: a membership observation newer
  than `membershipMaxAgeMs`. The default is one hour (question Q11).

The check fails closed. A missing observation is a denial.

## 6. Linear: leaning into the agent surface

All five verify items hold. Each maps onto these records:

| Linear surface | Scout record | Rule |
| --- | --- | --- |
| Delegation of an issue to the Scout app | `TicketWorkLink` with `linkedBy.method = "delegation"`, `runMode = "tracker_driven"`; the claim holder is the routed agent | The delegate is the next mover. The assignee stays the owner. |
| Delegation to another agent | `ticket.delegate.kind = "foreign_agent"` | Readiness excludes the item. Scout observes and does not claim. |
| Agent session, `created` | One flight. `ticket.agentSession` records the session id and flight id | The first activity goes out within 10 s: an ephemeral `thought` ("routing…") is sent before routing finishes. |
| Agent session, `prompted` | The same work item. A new ask continues the latest session (Linear reuses sessions since 2026-09-24) | A follow-up mention is a continuation, not a new item. |
| 30-minute stale window | Lease renewal | Renewing a lease on a tracker-driven item also emits an activity. A parked lease emits a `response` before it parks. |
| Activities `thought`, `action`, `response`, `error` | `ExternalDelivery` with `effect = "activity"` | Each one is a ledger row with an idempotency key. |
| Plan | `effect = "set_plan"`, built from the flight plan | Scout owns the plan; Linear shows it. |
| `stop` signal | Cancel the flight. The claim is released with `released` | It is a signed, addressed event. |
| `select` elicitation | `ask --operator --option` | The answer comes back as `prompted` and resolves the decision. |
| `auth` elicitation | Account linking: `ExternalActorLink.via = "tracker_auth_signal"` | It moves a candidate to linked. |
| `summary` and `externalLinks` | The session title, the Scout flight URL and the pull request URL | Projected from the flight and its receipts. |
| `createAsUser` and `displayIconUrl` (actor `app`) | `ExternalDelivery.attribution.presentAs` | Renders as "<agent> (via Scout)". It is a free-text name, so "for <person>" goes in the body. |
| `Team.gitAutomationStates` | `ticket.trackerAutomation.prDrivenStateMoves`, read when the link is bound | When true, Scout observes pull-request-driven state moves and does not project them. That prevents double moves. |
| `Comment.syncedWith` (Slack channel id and ts) | The descriptor's `sameAs`, then `ExternalRecordState.sameAs` | The synced comment and the Slack message are one object. The normalizer keeps one copy and links both. |

Linear can merge pull requests itself, so a "merged" observation can come
from Linear and not GitHub. The receipt still names the artifact, and the
state floor applies either way.

## 7. Slack: addressed and ambient

The descriptor's `addressing` rules decide which events are addressed:

- a mention of the app;
- a direct message;
- a slash command;
- a reply in a thread that a `ThreadWorkLink` binds.

Everything else in a bound channel is ambient. It is recorded in the records
cache with its audience, and it never routes. An unbound channel produces no
events at all (question Q8).

Each outbound post, update or decision card is an `ExternalDelivery`:

- It carries a `scout_delivery` marker in Slack message metadata. The echo
  rule matches that marker, so Scout ignores its own posts.
- Edits to one card are revisions of one delivery. Only the latest queued
  revision is sent. Older ones become `superseded`.
- A send that times out becomes `uncertain`. The runtime looks for the
  marker before it resends.

When Slack deletes a thread root, the link gets `rootDeleted`. Whether Scout
keeps its captured copy of the request text is question Q6.

## 8. GitHub: receipts

A pull request Scout opens gets an `ArtifactReceipt`:

- `producedBy`: the work item, invocation, flight, agent, claim generation,
  harness and node.
- `requestedBy`, and the responsible person.
- `authoredAs`: the login and credential mode (`app`, `host` or
  `personal`). Today's default is `host`. When that differs from the
  responsible person, the receipt shows it (question Q5).
- An idempotency key of the work item, the flight and the effect, so a retry
  cannot open a second pull request.

GitHub owns the pull request's state. An `ArtifactWorkLink` observes it:
state, head sha, checks, review decision and merge time.

## 9. Adapter descriptors

### 9.1 Shape

There is one module per external system. One module can serve several kinds:
each stream declares its own `channel`, `ticket` or `repo` kind. The
descriptor (`openscout.adapter-descriptor.v1`) declares:

- `version` (`YYYYMMDD_NN`). A connection pins it, and upgrades are
  explicit.
- `transport`: `native`, `nango` or `composio`. A hosted transport is only a
  way to fetch. The records model stays the same.
- `auth`: the mode, the acting identity, and scopes.
- `events`: how events are delivered and verified, the paths of the event id,
  type and timestamp, and the ack deadline.
- `identity`: how to make an `ExternalActor`. This covers the key path, the
  actor type map and the membership map.
- `streams`: for each record type, its primary key (single or composite),
  container path, cursor, sync modes, deletion mode, `hashExclude`, field
  maps, state categories, audience mapping, `sameAs` and addressing rules.
- `capabilities`: the fields the system can own, the writes it supports, its
  agent-native surfaces, its routing rule kinds and its tracker automation.
- `echo`: the marker kind and the author path. `errors`: classifiers.
  `rateLimit`.

A field map is a path, or `{ from, enum, typecast, identity, default }`. Ticket
streams use `TicketField` names. Fields specific to one system use an `x_`
prefix.

`validateAdapterDescriptor` rejects declarations the normalizer cannot honor:

- a `full_sweep` deletion without a full sync mode, or without a
  mass-delete hold;
- an identity kind that no identity entry declares;
- an ownable field that has no mapping;
- a ticket stream without state categories;
- a message stream without addressing rules.

The test file has complete Linear, Slack and GitHub fixtures.

### 9.2 Example: the Linear issues stream

```ts
{
  name: "issues", kind: "ticket", objectKind: "ticket", primaryKey: "$.id",
  cursor: { mode: "updated_at", field: "$.updatedAt" }, syncModes: ["incremental", "webhook"],
  deletion: { mode: "flag_field", flagPath: "$.archivedAt" },
  fields: {
    title: "$.title",
    priority: { from: "$.priority", enum: { "1": "urgent", "2": "high", "3": "normal", "4": "low" } },
    ownerId: { from: "$.assignee.id", identity: "linear_user" },
    state: "$.state.type",
    x_delegate: { from: "$.delegate.id", identity: "linear_user" },
  },
  stateCategories: { path: "$.state.type", map: { started: "started", completed: "completed" /* … */ } },
  audience: { containerPath: "$.team.id", visibility: { path: "$.team.private", map: { true: "private", false: "org_public" } } },
  addressing: [{ kind: "delegation", path: "$.delegate.id" }],
}
```

### 9.3 The module contract

A module implements three things:

- reading a page, which returns `AdapterReadPage` of `NormalizedRecordInput`
  and the next cursor;
- verifying and parsing an event;
- writing an `AdapterWriteRequest`, which returns `applied`, `uncertain` or
  `rejected`.

It holds no state between calls. Hooks are named in the descriptor for the
few cases a path cannot express.

### 9.4 What the normalizer owns

This follows the Nango records model, plus the mass-delete hold:

1. **Event deduplication.** It inserts the `ExternalEventRecord`, unique on
   the adapter, instance and provider event id, before the transport is
   acknowledged. That insert is the only work done before the ack. A
   duplicate gets disposition `duplicate`.
2. **Echo suppression.** An event authored by the app actor, or one that
   carries a `scout_delivery` marker, becomes `echo`, and its delivery is
   confirmed.
3. **Change detection.** It hashes the normalized payload without the
   `hashExclude` paths, and records `lastAction` as `added`, `updated` or
   `deleted`. An unchanged hash produces no work.
4. **Cursors.** A cursor is saved in the same write as the effects of its
   page.
5. **Deletion.** All deletes are soft. The basis is a tombstone event, a flag
   field, or a sweep. A sweep runs only after a clean full run, and
   `sweepAllowed` holds the sweep for a person if it would delete more than
   the descriptor's ratio.
6. **Cross-adapter identity.** `sameAs` joins duplicates, such as a Linear
   comment synced from Slack.
7. **Outbound.** It keys each write by `(link or destination, effect, source
   record)` with an idempotency key. It reconciles an uncertain send by its
   marker, honors `Retry-After`, and maps provider errors through the
   descriptor's classifiers.

## 10. Policy as records

### 10.1 Request classes (M6)

There are six classes, grouped by effect, from least to most:

- `ask`: answer, read, summarize.
- `review`: comment on or judge an artifact.
- `change`: edit code, open a draft, or move work.
- `publish`: write where others see it, or open a pull request for review.
- `release`: merge, deploy, or ship.
- `govern`: change grants, connections or policy.

A request in the `publish` or `release` class needs a responsible person who
holds that class (question Q10).

### 10.2 Records

Policy is allow-only grants plus ceilings defined in data:

- `RequestGrantPolicy`: subject selector, classes and scope. Its constraints
  are `sourceAudienceOnly`, `originContainerOnly`,
  `underResponsiblePrincipal` and `runMode`. It also records who issued it,
  when it expires and when it was revoked.
- `ClassCeilingPolicy`: the highest class a selector can ever reach, whatever
  the grants say.
- `AudiencePolicy`: the maximum age of a membership observation.
- `DisclosurePolicy`: refusals explain themselves to people and are opaque to
  agents. Agents must not learn to route around denials.

`evaluateRequest` works in four steps:

1. Resolve the requester. A linked external actor acts with its principal's
   grants. An unlinked actor counts as an `unlinked_member` or a `guest`.
2. Apply the ceiling.
3. Find a live grant that matches the class, scope and subject, and check its
   constraints. `underResponsiblePrincipal` evaluates the responsible person,
   one level deep only.
4. Return the accountable principal: the responsible person, else the
   requester's principal, else the grant's issuer.

### 10.3 Defaults

| Subject | Grants | Ceiling |
| --- | --- | --- |
| Linked member | The principal's own grants | none |
| Unlinked member | `ask`, from the source audience only | `publish` |
| Guest | `ask`, from the source audience and the origin container only | `ask` |
| Tracker integration event | `change` and `publish`, in `tracker_driven` mode and under the person who delegated | `publish` |
| Agent, in the project | `ask`, `review`, `change`; `publish` only under a responsible person who holds it | `publish` |

The agent row is a P1 default for decision D3. Agents never get `release` or
`govern` by default (question Q3).

## 11. Migration map

| Today | Becomes |
| --- | --- |
| `WorkItemRecord.externalContext` | `TicketWorkLink.observed` (unchanged type), still projected onto the item for existing readers |
| `IssueBinding` | `TicketWorkLink`, with a field policy and sync state |
| `IssueClaim` lease, generation, session | `WorkClaim` on the work item |
| `IssueClaim` provisioning and run states | The flight and its workspace |
| `IssueClaim` attempt, `nextRetryAt`, `lastError` | One claim per retry, plus `deferUntil` and the flight's error |
| `ExternalIssueSnapshot` | `ExternalRecordState`, plus `link.observed` |
| `IssueRunnerProfile` | Stays as the dispatch configuration |
| Pull request 165's `metadata.workClaim` | The first-class `claim` field. The holder becomes the next mover, not the owner |
| Delivery outbox for external writes | `ExternalDelivery`, which adds the `uncertain`, `suppressed` and `superseded` states |

## 12. Differences from the integration-layer design

1. Claim is a field on the work record, not a separate lease or metadata. Its
   holder is the delegate, not the owner.
2. The lease parks in `waiting` and `review`. The generation survives
   release. Retries are new claims with `deferUntil`.
3. `WorkLink` is a union of ticket, thread and artifact links, not one record
   with an optional sync block. Inferred links are a status (`suggested`), not
   a confidence score.
4. `adapterId` is an open string, and a new `ExternalConnection` record holds
   the descriptor pin, the credential reference, health and scope.
5. One module per system serves several kinds. The kind is declared per
   stream.
6. The inbound ledger row is written before the ack (finding L12).
7. `sameAs` handles objects mirrored across systems.
8. Ticket state uses Linear's categories as the common vocabulary, mapped to
   a Scout state floor. Only `state` can be shared.
9. Readiness excludes items that a foreign agent holds as delegate.
10. Policy is allow-only grants plus ceilings, with no deny rules to order.
11. The audience basis is explicit (`supplied_or_recorded`), per M9.
12. A2A stays at the edge. It is not an adapter kind.

## 13. Left out, and why

- **Runtime wiring and storage.** This change is the contract. The
  persistence and command paths come after review.
- **`ConversationBinding` changes.** A thread link points at a binding. It
  does not change the binding.
- **Gate items** (Beads-style). They can be modeled as relations later and do
  not shape the claim.
- **Migrating the Slack bridge.** That code lives in the apps repository.
- **Jira and Asana.** The ticket model is shaped to fit them, but they get no
  descriptors yet.
- **The conformance suite.** The fixtures here are its seed. The suite comes
  with the first runtime normalizer.

## 14. Questions for the operator

1. **Q1.** Is the claim holder the next mover with the owner unchanged, as in
   this spec? Pull request 165 made the claimant the owner.
2. **Q2.** Should the lease park during `waiting` and `review`, or keep
   running with a long timeout?
3. **Q3 (D3).** Are agents' P1 rights `ask`, `review` and `change`, plus
   `publish` under a responsible person?
4. **Q4.** Are unlinked Slack members limited to `ask`, or may an admin give a
   whole group a wider grant?
5. **Q5.** Which identity should GitHub writes use: (a) the Scout app,
   (b) the host's credential, as today, or (c) the responsible person's
   personal token?
6. **Q6.** After Slack deletes a message, does Scout keep its captured copy of
   the request text?
7. **Q7.** What is the Linear binding unit: one project to one team, one
   project to one Linear project, or a label lane inside a team?
8. **Q8 (D1).** What does "unified" cover? Is it only bound channels and
   delegated issues, or does a person's own mentions and notifications ever
   enter the inbox?
9. **Q9 (D4).** How is the Slack app distributed: as an internal app each
   customer creates, or as a distributed app?
10. **Q10 (D2).** Do you approve the six request classes and the default
    grants?
11. **Q11.** Is one hour the right maximum age for a membership observation?

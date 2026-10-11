# Sessions slots

A screen is the existing side navigation followed by a saved list of slots. A
slot combines a primitive (`board`, `lane`, `session`) and identity (`filter`,
`follow`, `pin`). `chat` and `terminal` are reserved types, not new renderers.

`slot-deck.ts` owns the pure reducer and browser persistence. Selecting a member
changes the source selection, not the source order. Followers resolve that
selection at render time. A pin does not follow it. Tear-out appends a fixed
copy while keeping the original follower. Removing a source freezes its
followers. Desk, Focus, Board + sheet, and Mix are data-only preset lists.

## Compatibility

Sessions uses `openscout:slot-deck:v2:web.sessions`, separate from every v1
Lanes/Ops profile. It reuses lane width bounds and zone ordering instead of
changing the existing `lane-deck.ts` contract. **Import saved Lanes** converts
all v1 slots and retains the original deck, including orphan definitions,
widths and auto-lane policy. It never rewrites the old key. This lets Lanes and
Ops keep their existing rendering and persisted layouts during adoption.

The primary area for the unchanged `terminal` view is now `terminals`.
`sessions` owns the existing `/sessions`, concrete-session and flight routes.
Chats retains its screens with a plural nav label. Basic uses the same Sessions
screen; its changes card omits full-client diff navigation.

## Evidence and delivery

- The board joins conversation backings and discovered native transcripts. It
  does not require operator membership. `conversation-kind.ts` excludes rooms
  whose latest-worker metadata is not an exclusive session backing. Recorded
  requester or parent-session evidence supplies “started by”; unknown origins
  stay unknown.
- Lane slots reuse `AgentLaneCard`, its presentation model and lane facts.
  Session slots reuse the Observe lookup, transcript/tool/diff blocks, context
  rail, bounded `useTurnSteps` ledger and existing Touched read.
- Observed user prompts delimit turn summaries. Agent-to-human questions are
  not user turns. A history source without prompt boundaries is labelled
  **Observed window**, not a fabricated durable turn. Durations require
  timestamped evidence. Generic command prose is not counted as file evidence.
- Inline approvals use the existing versioned attention decision endpoint.
  Declared conversation questions reuse the existing answer path. Native
  questions without a web answer endpoint retain their source action and say
  to answer in the live harness. Runtime/provider approval aliases remain
  exact; remote approvals must match the selected machine namespace.
- **Ask through Scout · traced** uses exactly one existing-session initiation
  with a resolved, unwrapped session id. Unresolved or machine-mismatched
  targets cannot send. Drafts survive slot/preset switches within the browser
  tab and late acknowledgements cannot clear newer drafts.
- **Types into the live session** stays disabled: the current reply endpoint
  may fall back to a traced ask, and the Deck direct transport addresses a
  mutable agent rather than a fixed session. Neither meets this mode's contract.
  No alternate delivery is attempted after an error.
- Interrupt is offered only for a working, exact, local tmux-backed owner.
  The existing interrupt endpoint accepts `expectedSessionId` to reject a
  switched/non-tmux target; old callers retain their existing contract.
- Window tear-out, native app changes, terminal/chat primitives, complete
  historical turn reconstruction and unverified remote-history writes are not
  implemented here.

Tests next to the model cover identities, reducer operations, v1 import,
classification, attention aliases, observed turns, draft continuity and exact
delivery. `server/routes/agents-interrupt.server.test.ts` covers interrupt
preconditions without invoking a real terminal.

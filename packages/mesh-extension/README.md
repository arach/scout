# Open mesh extension: HTTP MCP core

This package owns the open HTTP adapter for the 24 default `mcp:core` tools.
The executable/relay runner is a separate delivery step. No built-in verb is
removed or overridden here.

The adapter receives a selected broker HTTP origin and a relay-authenticated
full principal. Tool arguments cannot replace that principal, mailbox owner or
sender. Unknown tool selections fail at startup with the unsupported names.
Requests have time/size bounds, refuse redirects and never return upstream error
bodies. Protected local ingress supports an explicitly supplied administration
proof callback. It discovers no key file, socket, support directory or active
in-process broker. The administration key is an explicit user credential, not
the runtime's machine/node key.

Custody decides origin. Runtime-owned operations use HTTP. The only runtime
library dependency outside HTTP is its public, store-free webhook transport:
it sends public HTTPS callbacks signed with user-owned subscription secrets,
with existing DNS pinning, private-address refusal and response bounds. It never
loads a node key. Modern MCP Events still use runtime claim/prepare/settle leases;
revocation is checked before sending. Mailbox notifications remain hints over
`/v1/events/stream`, not a replacement for the durable mailbox.

Feedback always uses bridge-specific collection/upload routes, with principal
from constructor state. Remote diagnostics default to note-only unless the
runtime finds explicit matching consent. Failure never switches to the local
operator route. Collect and upload remain separate HTTP requests. An upload
failure retains the saved receipt; a later fresh collection uses current consent.

Tool input wire types are checked against the existing public core catalog.
Unexpected object fields are rejected rather than silently discarded; explicit
arbitrary metadata records remain supported.
Results use JSON text plus structured broker records/projections, not desktop
terminal formatting or private-app links. Agent search reads known runtime
inventory; it does not silently execute desktop host/project discovery.

## Tail filters

`tail_events` uses `GET /v1/tail/recent`, never tRPC. `sources` and `kinds` are
repeated URL query keys; session ID is exact; project/cwd/query use the same
case-insensitive matching predicate as tRPC. Transcript inclusion and limits
remain explicit. Cache identity includes every filter. Named-session reads apply
the other filters too. Arrays are bounded to 64 values of 512 characters; other
filter strings to 2,048 characters. Oversized filters are refused, not truncated.

Run `bun run check` and `bun test src` from this directory. Tests include an
isolated protected runtime, all default tool handlers, discovery/schema parity,
principal pinning, feedback provenance, modern events and mailbox parsing.

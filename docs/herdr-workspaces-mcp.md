# Herdr workspace reads from MCP

`herdr_workspaces` reads the selected local runtime's
`GET /v1/terminal-hosts/herdr/workspaces` projection. The runtime owns the
TTL-cached Herdr probes. The MCP client does not run Herdr, enumerate local
sessions, start services or use the private web server.

The existing `session`, `query` and `limit` tool inputs and ranked digest output
remain. A session is an exact host selector, not a Scout routing address. Pane
names and reported harness sessions remain observations, not verified bindings.
Stopped or saved projections never offer a live read handoff.

## Observation and error metadata

Structured results add `runtimeRead` when a valid broker observation was read.
It preserves the schema, node, scan time, requested session, availability,
reason, count, truncation and coverage limits. Its `sessions` list carries each
returned session's availability; the existing digest or candidate fields carry
the presentation. No duplicate full digest is added to the metadata.

- `available` observations can establish an observed empty bounded inventory.
- `partial` observations remain usable, but the tool marks them truncated and
  does not describe an empty result as proof that no sessions exist.
- `not_scanned` and `unavailable` produce `available: false`. They are not
  available-empty results. Valid unavailable observations can still carry
  per-session failure provenance in `runtimeRead`.
- Transport, HTTP and validation failures produce `readError` with a safe code
  and HTTP status when received. Raw server bodies are not reflected. A 403
  remains a refusal; a 404 is not converted into an available empty session.

This is an additive MCP result change and a read-backend switch. It adds no
runtime route, protocol DTO, package export, host control or answer authority.
The tool remains machine-local and read-only.

## Transport and validation bounds

The client selects `OPENSCOUT_BROKER_URL` or the runtime's control URL. Only
literal `localhost`, `127.0.0.1` and `[::1]` HTTP(S) authorities are accepted.
If `OPENSCOUT_BROKER_SOCKET_PATH` is set, that socket is used; failure never
falls back to HTTP. Socket-only mode without a socket fails before a request.

One eight-second signal covers headers and body. Redirects and ambient
credentials are disabled. The client never sends web bearer tokens, cookies,
browser origins or forwarding headers, and never requests `/api/bootstrap.js`.
It makes no retry or alternate-source read after failure.

The response has a two-MiB byte ceiling, strict UTF-8/JSON validation and the
versioned digest shape. It validates the requested session, count, duplicate
sessions, saved/live consistency, nested arrays and the runtime's declared
limits. Unrecognized or oversized shapes are unavailable, not silently
truncated into a valid observation. The runtime's 40 emitted panes can occupy
up to 256 directory groups, including groups whose panes were all omitted.

The browser-cookie adapter and its temporary private inventory exception are
removed. The named inventory records its source as forbidden to return. Other
private app commands and packaged app artifacts remain separate cutover work;
this reader does not make the whole CLI package app-independent.

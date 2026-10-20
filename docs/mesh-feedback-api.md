# Runtime diagnostic reports

Custody decides origin. Machine/node-key signatures originate in the runtime.
Clients may make user-key-signed, unsigned and public-tier calls directly. SSH
uses the user's SSH policy. These routes are not a general proxy.

All four routes are local tier, including protected-mode local authentication:

| Purpose | Collect | Upload |
| --- | --- | --- |
| Local operator | `POST /v1/diagnostics/reports/collect` | `POST /v1/diagnostics/reports/upload` |
| Trusted relay bridge | `POST /v1/mesh/bridge/feedback/collect` | `POST /v1/mesh/bridge/feedback/upload` |

Collection accepts `{message, diagnostics?: boolean}`. The bridge variant also
requires an authenticated `principal` with the existing MCP Events principal
shape. Upload accepts `{id}` and requires that same principal on the bridge
variant. The trusted bridge must obtain the principal from its authenticated
relay envelope, never from MCP tool arguments. Its remote `feedback_send`
adapter must use the bridge routes, never the local-operator routes. Remote
principals themselves cannot call these local HTTP routes. This API does not
ship or widen the MCP adapter. The existing built-in bridge is not rewired by
this API change. The adapter cutover must route every remote feedback request
through these bridge endpoints; the guarantees here describe this new runtime
API, not legacy direct collector calls.

Remote collection defaults to a note without diagnostics. A diagnostic request
also needs an explicit full-principal `{kind,id,ownerKey,node,agentId,userId?}` entry in `remoteDiagnostics` in the
runtime-owned bridge config. Missing, malformed or nonmatching consent leaves
the report note-only. A disabled bridge also cannot collect diagnostics. Consent is checked again after collection I/O and before
uploading diagnostics. Saved reports are bound to their full principal (stored as a digest); another
principal cannot upload them, and a local report cannot be substituted through
the bridge. Removing consent blocks upload of already collected diagnostics.

The collection manifest is fixed: bounded broker and bridge stderr tails,
probe stderr tails, two allowlisted settings fields and bounded runtime health
summaries. No caller paths, globs, environment dumps, transcript reads or
arbitrary database scans are accepted. Each log tail is at most 16 KiB. Only
allowlisted diagnostic lines with ISO timestamps from the past 24 hours are
included; untimestamped, old and future lines are omitted. Old log files and
symlink leaves are refused. Missing sources produce sanitized availability
metadata, not paths or exception text.

A secret-pattern redaction pass runs over report strings before persistence.
The final JSON envelope, including escaping, is capped at 128 KiB. Reports use
exclusive mode-0600 files under a runtime-owned directory. Requests are capped
at 16 KiB, rate-limited to ten operations per minute and one active operation.
The collect response contains a report ID, saved status and whether diagnostics
were included. Collection never uploads.

Upload is a second explicit request. The destination comes only from runtime
configuration (`OPENSCOUT_FEEDBACK_REPORT_URL`, with the existing public
feedback endpoint as default); it cannot be supplied by a caller. It must be
HTTPS without userinfo or fragments. Uploads do not follow redirects, have a
ten-second timeout and cap acknowledgement bodies at 8 KiB. Failure retains
the local report and returns no upstream error text. The bridge consent format
is usable independently of bridge-management installation; absent config
fails closed to note-only collection.

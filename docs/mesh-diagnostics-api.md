# Mesh diagnostics API

Custody decides origin. Machine/node-key signatures originate in the runtime.
Clients may make user-key-signed, unsigned and public-tier calls directly. SSH
uses the user's SSH policy. These endpoints are not a general proxy.

`GET /v1/mesh/diagnostics` is local tier, including protected-mode local
authentication. It returns the runtime-owned Tailscale probe snapshot and an
allowlisted effective mesh configuration, not the client's environment.

The probe can be unavailable while its first refresh runs. A null `running`
value does not mean Tailscale is stopped or uninstalled. `status`, `at`, `ageMs`,
`stale`, `refreshing`, `backend` and sanitized error metadata describe probe
freshness and failures. Old successful data can coexist with a failed refresh.
No raw command errors, command arguments, fixture paths or environment dump
are returned. Reads use the existing cached, single-flight runtime probe.

The response includes up to 128 peers, eight addresses per peer, 16 health
messages and 32 seed origins. Counts describe the full probe result; truncation
flags describe bounded arrays. Strings are capped and secret-pattern redacted.
Settings URLs disclose origins only, never credentials, paths, query strings or
fragments. Settings reflect the runtime's current binding and configured values.
No dormant-node helper or filtering policy is required for this read model.

# Runtime bridge management

Custody decides origin. Machine/node-key signatures originate in the runtime.
Clients may make user-key-signed, unsigned and public-tier calls directly. SSH
uses the user's SSH policy. These routes are not a general proxy.

All three routes are local tier, including protected-mode local authentication:

- `GET /v1/mesh/bridge`: redacted configuration, credential references and
  timestamped observations from scout-base's existing bridge state file.
- `POST /v1/mesh/bridge/config`: validated configuration replacement.
- `POST /v1/mesh/bridge/control {"action":"enable"}`: `enable`, `disable` or
  `request-restart`. Other control verbs are refused.

Configuration requires `enabled` and an HTTPS `relayUrl` origin without
userinfo, paths, query strings or fragments. Optional fields are `sender`,
`node`, `tools` (`"core"` or a bounded tool-name array), `tokenKeychainService`,
write-only `token`, and `remoteDiagnostics`. Unknown fields and all
caller-supplied filesystem paths are refused. Requests and serialized config
are capped at 64 KiB. Config, token-file reference and observation locations
belong to the runtime.

The existing built-in bridge accepts an inline token in its mode-0600 runtime
config on both supported platforms. This API preserves that representation;
it does not export or migrate credentials. An omitted token retains the old
value; `null` removes it. Responses and lifecycle events contain neither token
values nor prefixes. GET reports the keychain service name, fixed token-file
existence and permission validity, and whether an inline token is configured.
`configured` describes storage, not successful relay authentication; a keychain
reference is `unverified`. Legacy arbitrary config paths require replacement
with a path-free config before control is enabled.

Mutations serialize through the runtime writer and atomically rename config.
They first record a credential-free `mesh.bridge.lifecycle` requested event in
the broker journal and control streams. This is intent, not proof of a running
process. Failed requests can therefore also have intent events.

Scout-base remains the only process owner. It already reconciles `enabled` and
config mtime; a restart request rewrites config with a changed mtime. These
handlers do not spawn, signal, install or supervise a second bridge. Responses
say `reconciliation: "requested"`, never claim the child has restarted.
Observed state includes `updatedAt`, `ageMs` and `stale`; an old `running`
observation is not a liveness assertion. Packaging and extension supervisor
migration are separate work.

`remoteDiagnostics` defaults to `[]`. Each entry is an explicit identity
`{kind:"oauth"|"agent_token", id, ownerKey, node, agentId, userId?}`. The full authenticated principal must match. This is not an account-wide or
blanket remote permission. The feedback collection API uses these identities to gate remote
collection, and rechecks consent before uploading diagnostic reports.

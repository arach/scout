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
process. Configuration validation and write failures, and refused control
requests with a valid action, also emit an event with `phase: "failed"` before
returning failure. Events carry only the action and phase, never credentials,
config values or exception text. If lifecycle persistence itself is unavailable,
the mutation is refused and recording its failed event is best-effort.

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

## Host credential audience

Automatic rendezvous publication uses the bridge's approved host credential.
Each publication revalidates the stored bridge config and binds the credential
to its relay origin. HTTPS is required; HTTP is allowed only for exact-origin
loopback fixtures. Redirects are refused.

The credential audience contains the relay origin itself. Only the default
relay also permits the default rendezvous origin. Both defaults are exported
by `packages/protocol` as `DEFAULT_OPENSCOUT_MESH_RELAY_URL` and
`DEFAULT_OPENSCOUT_MESH_RENDEZVOUS_URL`; the bridge CLI uses the same relay
default. Custom split-host pairs and domain-wide matches are not permitted.
Explicit environment token and session routing is unchanged.

`scout doctor` checks the stored config without resolving its credentials.
It names an unsupported legacy `dir` field and a relay/rendezvous pair outside
the audience in one diagnostic when both are present. Remove `dir` from the
stored config, preserving other fields. The default pair itself is valid;
a default-pair config with legacy `dir` is still refused until that field is
removed. Doctor reports problems but does not migrate the config.

Doctor uses the publisher's selection rules. It checks the host credential's
relay/rendezvous audience only when that credential would be selected. An
environment token/session or explicit anonymous mode does not require that
pair to match. A disabled publisher (including `false` or `0` environment URL sentinels)
is reported as publishing disabled, not an invalid URL. The stored bridge
launch config is still validated in these modes; this does not hide an
unsupported `dir` or relax the bridge's own launch policy. Doctor never
resolves the credential source returned by the publisher's config resolver.

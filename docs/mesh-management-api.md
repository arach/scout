# Mesh management API

## Custody and origin

Custody decides origin. Anything signed with the machine/node key goes through
its runtime. Calls signed with user-owned keys, unsigned calls, and public-tier
calls may originate in the client. SSH uses the user's own SSH policy. These
routes never turn the runtime into a general proxy. Local-tier routes retain
protected-mode local authentication and are never available to remote peers.

## Approvals configuration

`GET /v1/mesh/approvals/config` returns `{share: string[], watch: boolean}`.
`POST /v1/mesh/approvals/config` atomically replaces both fields through the
runtime's own writer. Both routes are local tier. The body accepts only these
two fields, at most 128 share entries and 16 KiB total. Each share entry must
be a full canonical lowercase peer key ID (64 hexadecimal characters), belonging
to an active, unexpired trusted peer. Labels and abbreviated fingerprints are
not accepted. Unknown or inactive peers reject the entire replacement.

Sharing and watching default to off. Replace `share` with `[]` to withdraw all
sharing. Omit a previously shared key to withdraw it individually. This does
not revoke the peer's trust grant. Existing per-frame and pre-decision sharing
checks remain authoritative, so withdrawal takes effect without a restart.

Revoking trust also removes that peer key from the persisted sharing list,
without changing other peers or `watch`. Sharing consent is withdrawn first;
a failed approvals-config write refuses the revocation. If the later trust
write fails, sharing remains withdrawn. Re-enrolling the same key does not
restore earlier consent.

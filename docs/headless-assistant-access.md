# Direct assistant access to the runtime

An external assistant such as Muse connects directly to the Scout runtime over
Tailscale. The macOS app is optional. Owner approval, revocation and verification
must work without a GUI, public profile, hosted gateway or GitHub login.

This path requires a running Scout runtime and an existing Tailscale route on
both sides. It uses a scoped guest grant, not full mesh peer enrollment.

## Start the background runtime

On the destination machine, install the public CLI package and set up the
runtime. For local agent coordination, install Bun 1.3 or newer and a supported,
authenticated coding-agent harness first. The packaged background service
currently targets Apple Silicon macOS; do not infer Linux service support from
the portable guest client or Node-safe approval command.

```sh
npm install -g @openscout/scout
scout setup --source-root /absolute/path/to/projects
scout service status --json
scout guest --help
```

`scout setup` installs and starts the background runtime without installing or
opening the Mac app or menu app. Reuse an already healthy runtime. If the
installed CLI does not list `guest`, it predates these commands; use a release
that includes them before following the approval steps below. A source merge
alone does not update an installed npm package.

Verify `scout mesh card --json` reports the intended node and a reachable HTTPS
endpoint over Tailscale. Keep the owner administration endpoint on loopback;
remote assistants use the signed guest endpoint. A signed card, an approved
grant and a supported agent harness are runtime concerns, independent of the
optional app interfaces.

## Approve on the destination machine

Ask the assistant to read its existing Ed25519 public key from the same client
environment and `SCOUT_TAILSCALE_HOME` used for its saved connection. Compare its
full key fingerprint. Never request its private key, proxy credentials or tokens.
Use `scout guest targets --json` on the destination to select exact registered
agent IDs. General `scout who` also lists observed session IDs and configured
aliases; those may not be valid guest targets. Approval checks this registration
before changing access. Registration still does not prove an agent will reply.

`scout guest list` reads locally managed access. Prepare an approval with an
explicit absolute expiry (at most 30 days) and a stable request ID:

```sh
scout guest approve --public-key '<assistant-public-key>' --label Muse \
  --allow '<exact-agent-id>' --expires-at '<ISO-time-with-timezone>' \
  --request-id '<unique-decision-id>'
```

The command previews the key fingerprint, targets, expiry and local runtime URL.
After owner approval, repeat it with `--yes` and save the JSON response. Reuse
the same request ID and expiry if the response is lost. Do not create another
request merely because the first command timed out.

An existing active grant for this key is never silently replaced. If its scope
is obsolete, compare its key ID with the supplied public key, then preview and
explicitly revoke that immutable grant ID before approving the replacement:

```sh
scout guest revoke '<grant-id>' --key-id '<full-assistant-key-fingerprint>'
# Add --yes only after reviewing the selected grant.
```

Replacement is two separate owner actions and temporarily stops access. Keep
the assistant key and the intended replacement's request ID, targets and expiry.
Revocation does not remove local assistant files or uninstall Tailscale.

## Import and verify in the assistant

Give the approval JSON to the same assistant, together with the node key ID
independently verified on the owner machine using `scout mesh card --json`.
The response carries no private key. In the existing client environment, use
`scout-tailscale connect --bootstrap <response-file> --node-key <verified-node-key-id>`.
Inspect `connect --help` and preserve its existing endpoint, TLS pin, private key,
`SCOUT_TAILSCALE_HOME` and any explicit tailnet proxy. Do not infer a new trusted
node key from a failed connection.

Then verify the signed connection, list permitted agents, and submit one small
ask on the chosen machine. Retain its request ID and retrieve the completed
reply. Approval, a saved pairing, Tailscale reachability and an accepted request
are distinct from successful completion.

## Uninstall

Revoke the assistant's grant on each destination with `scout guest revoke`, then
disconnect and uninstall its client with the original installer. Local removal
does not revoke server access. Preserve Tailscale and shared tools when other
connections use them.

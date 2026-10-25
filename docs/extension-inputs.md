# Declared extension inputs

The API 2 declaration names one future credential source: the caller's
environment `SCOUT_DIST_KEY`. It is optional and opaque; future delivery must
use an explicitly declared, single-request input channel. Installation, updates, receipts and automatic
reconciliation do not issue grants. A manifest cannot request arbitrary
environment names, files, keychain labels, credential helpers or network lookups.

**Credential delivery remains disabled.** Context-only activation uses the
[qualified host](./extension-channel-host.md), not this permission store. A
nonempty credential declaration refuses `input_backend_unproven` before either
channel or provider spawn on supported hosts; unsupported hosts refuse
`context_backend_unproven`. Grants do not open either gate.
Credential slot 6 remains ignored. The independent input gate also remains
closed; the metadata-only parent session's `request` always refuses with
`input_backend_unproven`, even with an exact grant. It retains no raw value in
the returned session and implements no request-time authorization or response
server. Protocol/lifecycle sections below specify the proposed future slice.

The prior Node-extra-pipe qualification is withdrawn on macOS and Linux. The old
pre-opened-FD witness could not detect a second close of a reused number;
hosted run 39717881161 is void as transport qualification. Isolated positive
exchanges and old parent-model successes do not qualify a channel. API 1 stays
unchanged. No verb flip or service authority is enabled.

W5 delivery requires a single-owner transport passing the corrected witness on
its CI's exact pinned revision and platform, as described in
[context](./extension-context.md). No currently installed revision is assumed
qualified; a pin move alone does not meet that gate.

## Declaration

```json
{
  "api": 2,
  "command": "bin/run",
  "invocation": {
    "context": "scout.extension-context/v1",
    "requires": ["selection/v1", "distribution.endpoint/v1"],
    "inputSchema": "scout.extension-inputs/v1",
    "credentialInputs": [{
      "id": "distribution-key",
      "source": {"kind": "environment", "name": "SCOUT_DIST_KEY"},
      "presence": "optional",
      "destination": "distribution",
      "purpose": "Authenticate an explicitly requested download"
    }],
    "destinations": [{
      "id": "distribution",
      "defaultUrl": "https://downloads.example.test/base/",
      "overrideProjection": "distribution.endpoint/v1"
    }]
  }
}
```

The loader accepts exactly this source, input ID and destination projection.
Purpose is a nonempty disclosure of at most 240 characters, without controls.
Unknown fields, schemas, IDs, sources and executable API 2 completion refuse
before provider execution. An empty/omitted credential list retains the
context-only contract and gets no credential channel. Nonempty declarations
require the exact `inputSchema`, one matching destination and the endpoint
projection in `requires`.

The selected destination is the supported endpoint override or the declared
default. The loader normalizes its HTTP(S) origin and base path, removes trailing
path slashes except `/`, and refuses userinfo, queries, fragments and controls.
Both origin and base path bind the grant. Provider code must use that selected
destination, not replace it from another config source. The destination is a
provider claim, not evidence of its publisher or download origin. A grant is
not an OS network restriction. The provider owns TLS and redirect policy; it
must not send the value to another origin without separately reviewed consent.

## Explicit management

Inspect the selected artifact before granting:

```sh
scout --json extensions permissions inspect web
scout --json extensions permissions list
```

Inspection reports the current full-tree and declaration digests, input source,
selected destination, UID/instance/root binding and **unknown/local origin**.
It does not read the key. Use those exact identities for an explicit grant:

```sh
scout extensions permissions grant web \
  --tree-digest <full-tree-digest> \
  --declaration-digest <declaration-digest> \
  --input distribution-key \
  --destination https://downloads.example.test/base \
  --acknowledge-unknown-origin
scout extensions permissions revoke <grant-id>
```

The flags take names and identities, never a key literal. A mismatched digest,
input or destination refuses. There is no unattended prompt, automatic grant,
implicit grant from a receipt or grant transfer from another verb.

Policy is at `<selected Scout home>/extension-permissions/grants-v1.json`,
outside all selected extension roots, artifacts and receipts. The directory is
same-user and owner-only; the regular, non-hard-linked policy file is owner-only
(mode 0600). A symlink, unsafe owner/mode, unknown schema, inconsistent audit,
oversized or corrupt file refuses. Reads and writes take the same exclusive
`.lock` directory. A busy/stale lock refuses; no process-age guess reclaims it.
An operator must inspect an abandoned lock before removing it.

The store schema is `scout.extension-grants/v1`: `revision`, `grants` and `audit`.
Each grant contains `id`, `binding` and `createdAt`. The binding contains UID,
home, canonical instance and instance root, canonical extension-root path and
its device/inode identity, verb, full `treeDigest`, complete normalized
`declarationDigest`, exact input/source, destination origin/base path and
`provenance: {kind: "unknown-local", mode: "exact-tree"}`. Declaration identity
covers requirements, input set, destination and purpose. A declaration change
invalidates consent independently of the tree axis.

Each effective explicit grant/revoke appends a revisioned metadata-only audit
event. Revoking an already absent grant is a no-op.
Replacement uses a same-directory exclusive 0600 staging file, file fsync,
atomic rename and directory fsync, under the policy lock. Failed persistence
refuses. Limits are 512 KiB, 256 active grants and 1024 audit events; records
are not silently discarded or compacted. Issuance reserves one audit position
per active grant, so the capacity limit cannot prevent revoking all active
grants. A policy without that reserve refuses rather than authorizing inputs.
Inspect/recover policy before retrying
when those bounds are reached. There are no credential values in policy.

## Provenance

V1 implements exact-tree grants only. The public loader has no signed-inventory
verifier, so it refuses publisher continuity, including `--continuity`. A
manifest URL, local installer receipt, claimed signer or version is not proof.
Every changed tree needs a new explicit grant, even if its provider claims the
same publisher. A strict digest pin is already the only supported mode.

A future verified-publisher implementation must relax **only** the tree-digest
axis. Before delivering a newly adopted tree, it must atomically recheck the
unchanged declaration, destination, UID/instance/root/verb/source and current
unrevoked grant, verify signed inventory evidence, and persist an audit append
with that evidence and exact adopted digest. Failure to append must refuse.
Adoption cannot issue a grant or revive a revoked one. This v1 store does not
accept a fabricated verified-publisher or adoption record.

## Input protocol (not implemented)

The following is required future behavior, not an enabled channel. Current
metadata sessions refuse every request. Request parsing, authorization at the
channel boundary, delivery, deadlines and the provider adapter remain unimplemented.

Context `credentialInputs` exposes only the declared ID, frozen `present`
boolean, `treeDigest`, `declarationDigest` and selected destination. Unset, empty
and whitespace-only source values count as absent. The raw value remains in a
parent closure. The source must still be unchanged when a later request arrives;
a changed source refuses rather than silently switching accounts.

The target is `INHERITED_DESCRIPTOR_LAYOUTS.extensionApi2.credential` through
the pure runtime registry. It is distinct from context and role capabilities.
No key enters argv, the provider environment or a temporary file. The provider
parses its own arguments first. Help and operations that need no input close
the channel without a request; the loader does not duplicate subcommand parsing.

A credential-dependent operation sends one UTF-8 JSON frame followed by LF:

```json
{"schema":"scout.extension-input-request/v1","id":"distribution-key","treeDigest":"<context treeDigest>"}
```

The parent validates correlation, trusted current selection and declaration,
source stability, and the current policy at request time. A present source
without a matching grant refuses with `input_not_authorized`; the provider
must not then select another saved key/account. A missing source returns
`absent`, not an authorization failure; saved-store behavior remains the
provider's responsibility. The core never opens a credential store.

A response has schema `scout.extension-inputs/v1`, `id`, `treeDigest`,
`declarationDigest`, `destination` and `status`: `absent`, `provided` or `refused`.
Only `provided` contains `value`; `refused` contains a typed `reason`. Every
response ends with LF and EOF. The provider must validate correlation, bounds
and EOF and close both channels before relevant command output, store fallback,
a launcher call or a descendant. It retains any needed value only in its own
foreground memory and must not copy it into a descendant's environment/argv.
These are trusted-provider obligations, not confinement of malicious same-user
code or a promise that a delivered value can be recalled.

Requests are at most 4 KiB, responses at most 16 KiB including LF, and credential
UTF-8 values at most 8 KiB. Invalid UTF-8/control-containing or oversized values
refuse, never truncate. Partial requests and response delivery have five-second
bounds. There is no five-second command or idle-channel lifetime. A repeated or
undeclared request cannot obtain a second delivery. Child exit/cancellation
closes pending work; failure cleanup only terminates and reaps the invocation's
own child under the foreground runner contract.

Policy authorization linearizes at the request-time check under the same lock
as revoke. Revocation while an invocation is idle applies to its next request.
Selection is revalidated at that boundary, but these observations are not an
atomic filesystem snapshot against hostile same-user edits. After an authorized
value is delivered, revocation cannot recall it.

## Refusals

Loader refusals use the existing `scout.cli.command-unavailable/v1` envelope,
exit 69, and one raw bounded JSON stderr object in JSON mode, with empty stdout.
New reasons are `input_not_authorized`, `input_protocol_invalid`,
`input_delivery_failed`, `input_source_changed`, `input_value_invalid`,
`input_policy_invalid`, `input_policy_busy`, `input_provenance_unverified` and
`input_backend_unproven`.
Existing `incompatible`, `context_invalid`, `selection_changed` and
`context_backend_unproven` still apply. Errors never print payloads or values.
A compliant provider receiving `refused` stops without a second error or other
effects. Normal provider failures retain their own output and status.

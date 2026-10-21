# SSH enrollment tiers

`scout mesh enroll ssh://host --tier observe` installs `observe` on both
sides. The remote peer receives that tier here, and our key receives that tier
on the remote. Omitting `--tier` keeps the existing `control` default on both
sides. SSH host-key verification remains the authentication root.

Before sending a grant, Scout verifies the remote's signed node card and
checks that `scout mesh trust install-grant --help` advertises an explicit
`--tier` for that subcommand. It sends `install-grant - --tier <tier> --json`,
then requires a JSON receipt naming our key and the requested tier before
installing the local grant. Success reports `localTier` and `remoteTier` in
JSON, and labels both grants in plain output.

## Compatibility and partial failure

The parser in every public release tag available in this repository supports
`install-grant --tier`: 35 tags, from `v0.2.84` through `v0.3.9`, including the
four `v0.3.6-dev.*` tags. For example, see the
[earliest tagged parser](https://github.com/oscout/scout/blob/v0.2.84/packages/cli/src/cli/commands/mesh-trust.ts)
and [0.3.9 parser](https://github.com/oscout/scout/blob/v0.3.9/packages/cli/src/cli/commands/mesh-trust.ts).
This is a source audit, not proof of the executable installed on a remote.
Scout therefore checks capability at execution time instead of assuming a
version or retrying without the flag.

A separate receipt spot-check at `v0.2.84` (commit
`3c0052604c1b20d4f4c42d7dc7e91d3afa560ea7`) confirms that
`scout mesh trust install-grant - --tier <t> --json` prints a JSON object
containing `peer.keyId` and `peer.tier` on success. For an observe grant, its
shape is `{"peer":{"keyId":"<key-id>","tier":"observe"}}` with additional
peer metadata. The
[global argument parser](https://github.com/oscout/scout/blob/v0.2.84/packages/cli/src/cli/argv.ts#L13-L22)
consumes `--json` before subcommand parsing. The
[grant installer](https://github.com/oscout/scout/blob/v0.2.84/packages/cli/src/lib/core/mesh/trust-service.ts#L136-L165)
returns the runtime's peer record, including its key ID and requested tier;
the [command](https://github.com/oscout/scout/blob/v0.2.84/packages/cli/src/cli/commands/mesh-trust.ts#L545-L560)
wraps it in `{peer}`, and the
[JSON formatter](https://github.com/oscout/scout/blob/v0.2.84/packages/cli/src/cli/output.ts#L18-L23)
serializes that object. This is an additional source check of the earliest
tag, not a receipt audit of all 35 tags or an execution of an old binary.
The execution-time capability and receipt checks remain fail-closed.

An old or unknown remote gets a clear upgrade refusal before a grant is sent
when its help cannot confirm support. If it rejects the explicit flag, Scout
does not fall back to implicit `control`. A zero exit with a missing, malformed,
wrong-key, or wrong-tier receipt is also a failure, not successful enrollment.

An SSH timeout, lost response, or invalid receipt after the install command
can leave a remote grant without a local grant. Inspect the remote peer list
and correct or revoke that grant before retrying. Scout does not claim atomic
cross-machine enrollment and does not automatically revoke a possibly
pre-existing grant. No local grant is returned after an unconfirmed remote
mutation.

# Conditional extension installation and publication receipts

Automatic installers can refuse a change if another installer changed the
selected verb after inspection. These conditions are opt-in. Explicit
`install`, `update`, `remove` and reinstall over a tombstone keep their existing
selection semantics. See [CLI extension installation](./cli-extensions.md) for
artifact trust, bounds and generation retention.
Install requires valid UTF-8 entry names because publication identity is
defined over those names.

## Install only into an absent selection

```bash
scout --json extensions install mesh /trusted/artifacts/mesh \
  --expect-absent --operation-id provision-001
```

`--expect-absent` requires **no directory entry** for the verb in the selected
writable extension home. An installed generation, tombstone, unmanaged folder
or dangling link fails the condition. The installer checks after acquiring its
existing per-verb lock, before staging the candidate or publishing a generation.
`--expect-absent` deliberately treats a tombstone as not absent, because a
person's removal outranks any automatic reinstall.
A tombstone created after the caller's inspection therefore stays removed.
This condition concerns the writable home, not absence from legacy read roots.

## Update only the inspected generation and digest

Recover the current publication receipt first:

```bash
scout --json extensions receipt mesh
```

Use its `publishedGeneration` and `treeDigest` values as separate arguments:

```bash
scout --json extensions update mesh /trusted/artifacts/mesh \
  --expect-generation /absolute/extensions/.installed/mesh/GENERATION \
  --expect-tree-digest VERSIONED_TREE_DIGEST_FROM_RECEIPT --operation-id provision-002
```

The selected entry must resolve to that exact direct managed generation and
its current full-tree digest must match. A different generation fails
even if its bytes are identical. Removed, refused, missing and unmanaged state
cannot satisfy the condition. The lock covers comparison, staging and
publication; callers must not acquire or remove that lock themselves.

`--expect-absent` is valid only for install. The generation/tree-digest pair is valid
only for update. Conditions require `--operation-id`; the two condition forms
cannot be combined. Flags follow the existing positional arguments and cannot
repeat. `--operation-id` alone is also accepted on install, update or remove.
IDs contain 1–128 ASCII letters, digits, `.`, `_`, `:` or `-`, starting with a
letter or digit. Do not put credentials in an ID. A tree digest uses the versioned `sha256:scout-extension-tree-v1:<64 lowercase hex digits>` scheme; a generation is an absolute managed directory path, not a version.

## Success and lost stdout

JSON success keeps `action`, `name`, `home`, `status`, `version`, `digest` and
`previousArtifact`, and adds:

| Field | Meaning |
| --- | --- |
| `publishedGeneration` | Absolute canonical directory selected by publication. A rollback through update creates a new directory too. |
| `operationId` | Exact caller-supplied correlation ID, or `null` when omitted. |
| `treeDigest` | Canonical full-tree identity, or `null` for a removed marker. See [the exact walk](./extension-tree-digest.md). |

Before publishing the selection link, the installer writes a complete
same-user/root-owned, non-group/world-writable record under
`<home>/.receipts/<verb>/<generation-id>.json`. It is installer metadata, not a
file added to the artifact. Candidate validation never executes the candidate.
The public installer remains the only writer of managed generations.

If stdout is discarded or the caller exits before recording success, use
`extensions receipt <verb>`. It reads the record for the **currently selected**
generation and verifies its identity, version, legacy dispatch digest and full-tree digest against the current
selection. It does not stage, install, repair, clear locks or execute code.
Use the returned generation/tree-digest for the next conditional update. If another
operation published afterwards, the command reports that newer current receipt,
not the lost operation; compare `operationId` before claiming that operation
still owns the selection. The next conditional mutation still rechecks under
the lock, so receipt inspection does not reopen the original race.

This is correlation, not an idempotency key or exactly-once protocol. Reusing an
ID does not replay a prior result. A pre-change installation has no receipt;
unknown, mismatched, torn or unsafe metadata, including older records without `treeDigest`, refuses readback. Inspect that
state explicitly instead of guessing ownership or blindly retrying. A hard
crash can leave a lock, staged files or orphan records. Atomic selection does
not promise power-loss durability or a transaction across several verbs.

Remove retains the tombstone's receipt and prunes receipts corresponding to
old generations it deletes. Updates still count toward the eight-generation
limit. Reserve capacity for rollback in an automatic caller's policy; this
change adds no pruning API, automatic retry or remove/reinstall shortcut.

The legacy `digest` remains SHA-256 of manifest bytes, NUL and command bytes.
`treeDigest` includes every accepted entry, its relative path, file executable
classification and bytes. Conditional updates use only that full-tree identity.
Publication receipts prove neither download origin nor a user capability grant
and must not be used as either. The new tree flag supersedes the unreleased
draft `--expect-digest`; legacy hashes and that old flag refuse explicitly.

## Refusals

These commands exit 1 on refusal, produce no success receipt on stdout, and
report one of these stable refusal codes:

| Code | Meaning and recovery |
| --- | --- |
| `EXTENSION_CONDITION_INVALID` | Missing, repeated, incompatible or malformed condition/ID arguments. Correct the arguments before retrying. |
| `EXTENSION_PRECONDITION_FAILED` | Current state differs from the expectation or cannot be verified. Preserve it; inspect the current selection and receipt, then form a new authorized operation. |
| `EXTENSION_RECEIPT_UNAVAILABLE` | Readback cannot verify a receipt for the selected generation. Inspect the selected home and metadata; no mutation was attempted by readback. |

In JSON mode, these three codes produce exactly one UTF-8 JSON object and LF
on stderr, with no ANSI color or textual prefix. The object has `schema` set to
`scout.cli.extension-install-error/v1`, `error` set to the stable code, and a
human-readable `message`. If read-only verification finds the current selected
publication receipt, `lastReceipt` contains its absolute metadata-file path;
otherwise the field is omitted. This pointer is a recovery hint, not proof that
the refused operation published anything. Re-read through `extensions receipt`
and compare its operation ID before forming a new authorized condition.

Human mode keeps the existing `error: CODE: message` format. Both modes exit 1.
This operation-refusal schema is separate from an unavailable-verb refusal.
Existing trust, candidate validation, busy-lock and retention errors keep their
current behavior. A failed comparison leaves the
selection, artifact generations and receipt history unchanged. The installer
can still create/validate its control directories and take/release its lock.
It never overwrites an unmanaged target or treats a tombstone as absence.

These commands do not start services, download artifacts, grant credentials or
change the extension manifest API. Public built-in command selection is
unchanged.

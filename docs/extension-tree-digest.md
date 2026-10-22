# Extension tree identity, version 1

`scoutExtensionTreeDigest(directory)` in
`packages/cli/src/cli/extension-tree-digest.ts` is the single implementation.
The installer, conditional comparison and receipt reader call it directly.
Inventory tooling can invoke the same function through the public read-only
command:

```bash
scout --json extensions tree-digest /absolute/normalized/artifact
```

The result is `{ "treeDigest": "sha256:scout-extension-tree-v1:<64 lowercase hex digits>" }`.
Future invocation context and permission management must reuse this function,
not implement another walk. A digest identifies bytes and executable classes;
it is not a grant, authenticated publisher provenance, or manifest validation.

## Canonical walk

1. Select one physical artifact directory. A final root symlink refuses; use
   the receipt's canonical `publishedGeneration`, not its selection symlink.
   Ancestor aliases resolve once. Root location is not part of the digest.
2. Walk every entry recursively in preorder, including the root and empty
   directories. At each directory, sort names by unsigned UTF-8 byte order.
   Preserve spelling and case; do not perform Unicode or locale normalization.
   Invalid UTF-8 names refuse rather than collide through replacement text.
3. Accept directories and regular files only. Reject every symlink, whether
   internal, external, dangling or retargeted. Reject special files and
   hard-linked regular files (`nlink != 1`). Do not follow links to acquire
   another tree's contents. A source with hard links can first be copied by the
   supported installer, which detaches regular files.
4. Hash directory paths, regular-file paths, executable classification and
   every regular file's bytes. There are no filename exemptions, including
   hidden files, help, manifests, assets and auxiliary executables. Installer
   receipts/locks outside this artifact directory are not visited.
5. Ignore absolute root, UID/GID, inode, timestamps, non-executable permission
   bits, ACLs and extended attributes as identity inputs. Trust checks remain
   separate: current-user/root ownership and existing world-write rules apply
   to the root, its ancestors and descendants. A regular file is executable
   when any `0111` bit is set. Directory mode is not hashed; installer
   normalization makes directories `0700`, executable files `0700` and other
   files `0600`.
6. Apply the same shared limits as artifact copying: 32 MiB of regular-file
   content in total, 1,024 entries including the root, depth at most 16 with
   root at depth zero. Refuse before returning a partial digest.

A built artifact must ship its manifest command executable so its inventory
digest equals the receipt's `treeDigest` by construction; a mismatch means the
build is wrong, not the tool, and any future convenience normalization must
use an explicit `--as-installed` flag, never a silent default.

Inventory must describe the **installed, normalized** artifact. The installer
forces the manifest command executable before hashing the staged copy. A raw
source with a non-executable command can therefore differ from its installed
copy. Prepare the executable correctly, or obtain an inventory from a staged
installation in an explicitly isolated home. The digest function does not
chmod, install, create directories, validate a manifest API or execute code.
The CLI entry retains normal instance selection/bootstrap; this command does
not create or publish an extension installation.

## Exact encoding

Use SHA-256 over this byte stream:

- Domain prefix: UTF-8 `scout-extension-tree-v1` followed by one NUL byte.
- Directory record: ASCII `D`, then a path frame.
- File record: ASCII `F`, then a path frame, one executable byte (`00` or `01`),
  unsigned 64-bit big-endian content length, then the exact content bytes.
- A path frame is unsigned 64-bit big-endian UTF-8 byte length followed by
  those bytes. Paths are relative, separated by `/`; the root path is empty.

Records follow the canonical preorder above. Length framing makes path and
content boundaries unambiguous. Prefix the lowercase hexadecimal SHA-256
result with `sha256:scout-extension-tree-v1:`. A new canonicalization requires
a new scheme version; do not silently change v1.

The tests contain an independently calculated fixed vector as well as
before/after mode, added-file and rename checks. Symlink-retarget tests require
refusal, not a digest of either target.

## Quiescent-tree requirement

Use a quiescent installed generation or build artifact. The walk uses lstat,
no-follow/nonblocking opens, descriptor metadata comparisons, containment
checks, directory-list rechecks and post-read identity checks. Observed edits
refuse. Atime changes caused by reads are ignored.

This is **not an atomic filesystem snapshot or a hostile same-user filesystem
sandbox**. Path-based directory enumeration cannot exclude every adversarial
rename race. Do not use a digest alone to assert OS immutability or continued
trust after the check. The public installer lock serializes public installer
operations; it does not prevent a same-user actor from editing generation
contents directly. Later dispatch must revalidate the selected artifact and
its trust according to its invocation contract.

## Receipts and conditional updates

Publication receipts add `treeDigest` for installed artifacts; removed markers
use `null`. Receipt readback recomputes that identity and refuses changed
auxiliary bytes, executable classification, entry presence or paths, even when
the legacy manifest/command digest is unchanged. Older records without this
field cannot attest the publication tree and refuse readback; explicit audited
update can create a new receipt. No automatic adoption occurs.

Use `--expect-generation <absolute-directory>` together with
`--expect-tree-digest <versioned-tree-digest>` and `--operation-id <id>` for a
conditional update. A legacy two-file digest is not accepted in that field.
This replaces the unreleased draft condition flag `--expect-digest`; that old
flag refuses rather than silently selecting a weaker identity.

The existing receipt field `digest` and runtime `scoutExtensionDigest` retain
their old manifest-plus-command semantics for compatibility. They are legacy
dispatch observations, **not** tree identities. New inventory, context and
permission consumers must use `treeDigest`. No credential channel, grant store,
service activation, manifest API change or runtime restart-key change is part
of this primitive.

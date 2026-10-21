# CLI extension installation

See the [Extensions guide](./extensions.md) for the API-1 artifact contract,
completion, installed Markdown help and agent-readable help.

`scout extensions install <verb> <directory>` installs a **trusted, prebuilt
local artifact**. It does not download packages, execute hooks, or search PATH.
The directory must contain `extension.json` with `api: 1`, a semantic `version`
(such as `1.2.3`), a summary and an in-directory command such as `bin/scout-mesh`.
The installer sets executable permissions. Artifacts may contain regular files
and directories only: no symlinks, devices or pipes. Bounds are 32 MiB total,
1,024 entries, 16 directory levels and a 16 KiB manifest.

`scout extensions update <verb> <directory>` stages and validates a complete
artifact, then atomically replaces the active generation link. A bad candidate
leaves the current generation running. Previous immutable generations remain
available for explicit rollback using the returned `previousArtifact` directory
as the source for another update. At most eight generations are retained;
remove/reinstall clears history. Installing again is not an implicit update.
Updates can repair a refused managed install but never replace an unmanaged
folder or symlink. Move an unmanaged installation aside explicitly to migrate it.

`scout extensions remove <verb>` removes managed artifact generations and keeps
a disabled marker. This prevents an older legacy-home copy from silently taking
over. The loader lists that marker as removed/refused. Install enables it again.
Installation uses the same canonical/legacy home selection and trust checks as
the loader. An interrupted installer may leave a fail-closed per-verb lock under
`.locks`; verify no installer owns it before removing that lock manually.

These commands change extension-owned installation files only. They do not
start, stop or restart runtime services. A supervisor may reconcile a changed
artifact later. An artifact revision hashes its manifest and bundled executable,
not its installation path. Ship one bundled executable; changes to additional
assets must also change the manifest version. No runtime state or credentials
belong in the artifact.

Built-ins still win. Installing `mesh` does **not** flip `scout mesh`, and does
not pre-install anything in the native app. That cutover is a later step.

## Runtime-owned mesh bridge

The runtime's existing scout-base supervisor selects an installed `mesh`
extension with the same discovery and trust rules as the CLI loader. It launches
that executable directly as one child: `scout-mesh bridge --config <owned-file>`.
It does not launch a second supervisor or use `scout mesh bridge` as a wrapper.
The foreground built-in verb remains registered until the later flip.

A missing installation is **absent**. Absence retains the legacy source/global
bridge during this transition. An unsafe, invalid or removed installation is
**refused**. Refusal stops the prior bridge and backs off, with no older-root or
built-in fallback. Repairing the installation lifts the refusal. Installer
removal leaves a disabled marker, so removal is not mistaken for absence.

Reconciliation includes the manifest/executable digest, bounded configuration
content digest and configuration mtime. An artifact update or configuration
change stops and awaits the old child before launch. The runtime checks again
before spawning so a configuration changed during descriptor preparation cannot
launch a stale generation. Exit 78 receives the existing five-minute cooldown;
changed configuration or artifact content lifts it. Stable processes reset crash
backoff. Refusal, absence and installed selection are distinct redacted observed
states with timestamps; observations are not relay-authentication assertions.

The fixed `runtime/mesh-bridge.launch.json` file is written atomically with mode
0600. It supplies the loopback broker origin, fixed working directory, explicit
credential references (or the write-only configured token), direct parent PID
and MCP Events opt-in. The extension receives no ambient Scout secrets. User
local-admin proof is opt-in through the base process's explicit key-file setting;
only a reference and the public node-card destination ID enter the descriptor.
The runtime never gives its machine private key to an extension. Credential
values are not included in status responses or lifecycle logs.

The extension checks its actual parent PID, handles SIGTERM/SIGINT/SIGHUP and
uses a bounded shutdown budget. Scout-base retains its legacy launchd exclusion
and recorded-process fencing. Fencing rechecks the exact process incarnation
before signals, confirms exit and refuses a second process if exit cannot be
confirmed. All tests use fixtures; this change does not install, start or restart
an operator bridge. App pre-install, OAuth connect UX and the built-in-verb flip
remain separate work.

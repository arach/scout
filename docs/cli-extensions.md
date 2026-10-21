# CLI extension installation

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

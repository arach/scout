# Transitional app entry configuration

The broker no longer searches a source checkout for web or Scoutbot. An
explicit entry must name an absolute regular file. A missing file is a
configuration error, not permission to try a different implementation.

This is a transitional configuration contract for existing broker-owned app
processes. It is not a general extension autostart capability. It does not move
process ownership or replace the assistant-registration fence.

## Durable configuration

The daemon reads `<supportDirectory>/legacy-app-services.json`:

- `OPENSCOUT_SUPPORT_DIRECTORY` overrides the directory.
- Otherwise, use the current instance's support directory. Production macOS
  uses `~/Library/Application Support/OpenScout`; production Linux uses
  `${XDG_DATA_HOME:-~/.local/share}/openscout`.
- Named instances use the instance layout's support directory. Do not write
  production configuration for a development instance.

Example (paths are placeholders for installed artifacts, not source discovery):

```json
{
  "version": 1,
  "web": { "entry": "/opt/example/services/web.mjs" },
  "scoutbot": {
    "enabled": true,
    "entry": "/opt/example/services/assistant.mjs"
  }
}
```

A present file is authoritative. An absent or null `web.entry` disables web
entry selection. Scoutbot requires `scoutbot.enabled: true` **and** its explicit
entry. A missing/false `enabled` disables it. Relative paths, directories,
invalid JSON, unsupported versions, invalid field types and unreadable
configuration fail closed with a diagnostic. Configuration files and configured
entries must be owned by the current uid or root and must not be world-writable;
without `getuid`, strict ownership checks refuse them. Blank entries do not enable a
service. An enabled Scoutbot without an entry reports a configuration error.

The daemon reads this file at each entry/enablement decision, including daemon
startup and subsequent child start/restart attempts. It does not cache it at
module import. Replacing the file does not stop an existing child, restart it,
or automatically start a role that was disabled at broker startup. Those
changes take effect at the next normal service lifecycle boundary. In
particular, enabling Scoutbot after a disabled startup requires the next
broker startup. There is no filesystem watcher or new reload signal.

An installer must write the complete file through a same-directory temporary
file and atomic rename. Use a current-user-owned directory and mode 0600 for
the file; flush the file and directory for crash-durable installation. Do not
write tokens or other secrets in it. These entries run with the broker user's
privileges, so this file is trusted local execution policy, not untrusted
client input. It must not be writable through remote broker APIs.

## Environment overrides

Environment is captured for the service lifetime for Scoutbot. Durable entries
are reread as described above. For web, the service uses its supplied daemon
environment. Do not rely on mutating a running daemon's environment as an
installation or reload mechanism.

- `OPENSCOUT_WEB_SERVER_ENTRY` overrides the web entry.
- `OPENSCOUT_SCOUTBOT_ENTRY` overrides the Scoutbot entry, but never enables it
  by itself.
- `OPENSCOUT_SCOUTBOT_PROCESS=1`, `true` or `on` explicitly enables Scoutbot;
  `0`, `false`, `off` or blank disables it. The existing `managed` value is
  accepted for compatibility. Other values are configuration errors.
- Explicit blank entry variables suppress fallback. A nonblank but missing
  entry produces an error even if the durable file or a bundled entry is valid.
- Unspecified fields use the durable file. Remove stale environment overrides
  before relying on durable configuration. The broker's internal posting-only
  web marker must not replace Scoutbot's captured enablement policy.

Set `OPENSCOUT_WEB_SERVER_ENTRY=""` or `OPENSCOUT_SCOUTBOT_PROCESS=""` to turn
that role off explicitly; an empty override is not an absent override.

## Installed npm compatibility until web removal

A public npm installation currently ships web. Preserve that behavior until
the web packaging cutover: **only when no web entry variable and no durable
configuration file are present**, the broker can use its installed CLI web
bundle. Selection requires the neighboring package manifest to name
`@openscout/scout` and its directory's real path to contain a `node_modules`
path component. A built checkout or a linked package whose real path leaves
`node_modules` requires explicit configuration. It accepts the current bundle name or its compatibility
name. It never selects `packages/web` or walks the repository.

This exception is not used after explicit configuration, including a configured
missing file, blank entry, a present config without web, or malformed config.
Scoutbot has no bundle/source fallback and no implicit enablement. Remove the
npm exception with the web artifacts, not before existing npm users have a
supported replacement.

## Installer ordering

1. Stage and verify the installed service artifacts at versioned absolute
   paths. Keep the old artifact until existing children and rollback no longer
   need it.
2. Atomically persist this instance's configuration and remove stale daemon
   environment overrides. This must happen **before** adopting a runtime that
   requires explicit source entries. Configuration must survive logout and
   reboot; setting only the installer's shell environment is insufficient.
3. At the next operator-authorized runtime upgrade/lifecycle boundary, the
   daemon reads the durable entries. No migration code should start a second
   process merely to test the configuration.
4. A later ownership handoff must separately disable old restart/takeover
   policy, drain owned children and prove exit before another launcher starts
   replacements. Entry configuration alone is not an ownership fence.

The private installer owns these writes. The runtime only reads the contract.

## Staged custody contract

Explicit entry configuration selects an artifact; it does not establish role
ownership. The [R0/P1 handoff SDK](./SUPERVISION-HANDOFF.md) defines the separate
stable-inode lock, durable generations, effect receipts and operator consent.
Its production readiness gate is closed. This SDK does not yet fence the
legacy supervisors described above and must not be advertised as an integrated
R0 release. Old machines are not enrolled by importing or installing it.

## Mesh bridge

Mesh bridge selection has no implicit source or CLI fallback, including in dev
mode. Its installation ordering and read-only preflight are specified in the
[mesh bridge cutover gate](./MESH-BRIDGE-CUTOVER.md). Incorporate that gate into
the consuming installer checklist before adopting the refusal-only runtime.

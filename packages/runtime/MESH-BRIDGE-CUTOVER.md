# Mesh bridge upgrade preflight

## Before upgrading an enabled bridge

Run `openscout-runtime mesh-bridge-preflight` on **every bridge-enabled machine
before upgrading past the removal of the implicit CLI fallback**. Repeat it for
each enabled instance. Do not switch the running service to the new runtime
until this check passes.

Use the candidate runtime that contains this command, not an older installed
runtime that does not recognize it:

```bash
openscout-runtime mesh-bridge-preflight
```

If the candidate is a Scout checkout rather than an installed executable, run
this equivalent command from that checkout's root:

```bash
bun packages/runtime/bin/openscout-runtime.mjs mesh-bridge-preflight
```

Run the check **as the service runs**: the same uid, home and instance, with the
same support root, extension root and BIN environment. In particular, preserve
`HOME`, `OPENSCOUT_INSTANCE`, `OPENSCOUT_SUPPORT_DIRECTORY`, `SCOUT_HOME`,
`OPENSCOUT_HOME`, `OPENSCOUT_EXTENSIONS_HOME`, `OPENSCOUT_MESH_BRIDGE_BIN` and
`OPENSCOUT_BASE_MESH_BRIDGE_ENABLED` where the service sets them. An installer's
shell or another account can inspect different configuration and give a
misleading result.

Output is JSON; optional `--json` is also accepted.

- **Exit 0:** this instance passes the selection gate. An enabled bridge has a
  trusted extension or an available explicit BIN. Disabled or unconfigured
  instances also return 0, so check that `enabled` matches the intended service.
  This is not a relay-authentication, network-health or legacy-handoff check.
- **Exit 78:** do not upgrade yet. Read `reason` and `fix`. Stage the trusted
  mesh artifact, or configure an explicit absolute `OPENSCOUT_MESH_BRIDGE_BIN`
  in the service environment, before upgrading. A refused or removed artifact
  blocks BIN too: repair that installation rather than trying to bypass it.
  Repair invalid bridge configuration if reported. Rerun the preflight and
  require exit 0; otherwise, **do not upgrade**.

The preflight does **not** start a bridge, enable one, install an artifact or
migrate a legacy owner. Legacy-owner handoff remains a separate operation even
when the check returns 0.

## Selection contract

An enabled bridge requires a trusted installed `mesh` extension, or an explicit
`OPENSCOUT_MESH_BRIDGE_BIN` when the extension is absent. The runtime no longer
searches development source, a repository CLI build, its module sibling, or a
Bun global CLI installation. Service mode `dev` does not opt into source.

The extension takes precedence over BIN. A removed or invalid installation
refuses execution; BIN cannot bypass that decision. BIN must name an absolute
regular Scout CLI file, launched with Bun and `mesh bridge --config <file>`.
It is not a path to `scout-mesh` (which has different arguments). Development
source remains possible only by explicitly naming its CLI file in BIN.

## Migration decision

Runtime and updater do **not** install an extension implicitly. An extension is
trusted user-level executable code; this runtime has neither an approved
artifact source nor an automatic installation policy. On an enabled machine
with neither option, scout-base records `state: refused`, `extensionState:
absent`, `reason: extension-absent` (or `override-unavailable`), and the installation
fix in its state file and bounded-backoff warning. It retries inspection;
installing the extension changes the selected digest and lifts the refusal.
There is no silent fallback to a frozen checkout CLI.

Installing the extension never creates configuration, enables a disabled bridge,
or starts a bridge by itself. Existing desired-state and single-process fences
remain in force. No migration test should start a second relay connection.

## Required installer / cutover checklist

Use these steps before adopting the runtime on each machine **and each enabled
instance**:

1. Identify its bridge configuration and service environment, including any
   legacy LaunchAgent. Do not infer production readiness from a dev instance.
2. Stage the mesh artifact before switching the runtime. From the matching
   public Scout checkout, with a Scout CLI that supports extension installation:

   ```bash
   bun run --cwd packages/mesh-extension build
   scout extensions install mesh "$PWD/packages/mesh-extension/dist/mesh"
   ```

   Use `scout extensions update mesh <artifact-directory>` for an existing
   installation. A release installer may stage the equivalent verified release
   artifact instead. Do not copy private product material into this package.
   Alternatively, provision BIN in the **scout-base service's durable
   environment**, not just an installer shell. Keep its artifact available
   through restart and rollback. Changing service environment requires the normal
   authorized service restart; it cannot mutate an already running daemon.
3. Run the one-command gate using the candidate runtime, with the **same uid, home,
   instance, support directory and extension-root/BIN environment as scout-base**:

   ```bash
   openscout-runtime mesh-bridge-preflight
   ```

   In this checkout, before installing the candidate runtime:

   ```bash
   bun packages/runtime/bin/openscout-runtime.mjs mesh-bridge-preflight
   ```

   `--json` is also accepted; output is always JSON. Exit 0 permits this narrow
   gate; exit 78 blocks cutover and includes `reason` and `fix`. No relay token,
   config body or executable output is printed. `enabledWithoutExtension: true`
   with `ok: true` means an explicit BIN satisfies the requirement. Invalid
   configuration fails closed. A config deferred to a legacy LaunchAgent still
   requires an extension or BIN. This command never migrates that owner.
4. Abort/defer the runtime switch on any blocked result. Do not adopt the
   refusal-only runtime first and plan to install later. Complete the existing
   legacy-owner handoff separately, retaining its confirmed-exit fences.
5. Adopt the runtime at the normal operator-authorized lifecycle boundary.
   Verify the existing bridge observation reports its installed digest and one
   running child. A successful preflight proves selection readiness, not relay
   authentication, network health or legacy-owner retirement.

The preflight is read-only and does not import daemon entrypoints, build missing
artifacts, install anything, change enablement, or execute the selected command.
Without `OPENSCOUT_INSTANCE`, it uses the normal production instance (not an
implicit checkout development default). Always pass the target service's actual
environment when inspecting a named instance. Repeat this gate for all machines;
one local success is not a fleet rollout claim.

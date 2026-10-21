# Mesh bridge cutover gate

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

The consuming product's cutover checklist must incorporate these steps before
this runtime is adopted. Keep this change in draft until that checklist exists.
For each machine **and each enabled instance**:

1. Inventory its bridge configuration and service environment, including any
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
3. Run the one-command gate using the candidate runtime, with the **same uid,
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

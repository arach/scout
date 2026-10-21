# Instances Agent Notes

Source: `packages/runtime/src/instance.ts` (derivation + rails), `instance-bootstrap.ts`,
`instance-checkout-bootstrap.ts`, `support-paths.ts`, `systemd-user-service.ts`,
`broker-process-manager.ts` (service adapters).

Verified: 2026-10-08

## Role

One knob, `OPENSCOUT_INSTANCE`, isolates a dev checkout or worktree from the
installed ("prod") Scout on the same machine. `prod` (the default) is the
legacy layout byte-for-byte. Any other name derives its own homes, ports,
node identity, service name and sockets, stays off the mesh, and refuses to
touch prod.

## Derivation (`deriveOpenScoutInstanceLayout`)

| Thing | prod | `<name>` (e.g. `dev`) | Env override |
|---|---|---|---|
| root | n/a (scattered) | `~/.openscout/instances/<name>` | `OPENSCOUT_INSTANCE_ROOT` |
| OPENSCOUT_HOME | `~/.openscout` | `<root>` | `OPENSCOUT_HOME` |
| control home | `~/.openscout/control-plane` | `<root>/control-plane` | `OPENSCOUT_CONTROL_HOME` |
| support dir | macOS `~/Library/Application Support/OpenScout`, else `${XDG_DATA_HOME:-~/.local/share}/openscout` | `<root>/support` (all platforms) | `OPENSCOUT_SUPPORT_DIRECTORY` |
| relay hub | `~/.openscout/relay` | `<root>/relay` | `OPENSCOUT_RELAY_HUB` |
| `~/.scout` class (local edge, CLI logs) | `~/.scout` | `<root>` | `OPENSCOUT_SCOUT_HOME` |
| pairing (Noise key, peers, runtime.json) | `~/.scout/pairing` | `<root>/pairing` | `OPENSCOUT_PAIRING_HOME` (aliases `SCOUT_PAIRING_HOME`, `OPENSCOUT_PAIRING_DIR`) |
| broker socket | `<support>/runtime/broker.sock` | same, under the instance support dir | `OPENSCOUT_BROKER_SOCKET_PATH` |
| app / probes sockets | `~/.openscout/run/{scout-app,scoutd-probes}.sock` | `<root>/run/...` | `OPENSCOUT_APP_SOCKET`, `OPENSCOUT_PROBES_SOCKET` |
| ports | broker 43110, listening 43112, web 43120, terminal relay 43121, vite 43122, pairing 43130/43131/43132, jetstream 43150/43151 | block base + same offsets; `dev` base 24400; others: their slot/claim, else the first free block probing linearly from slot `1 + fnv1a(name) mod 119` (base `24400 + 50·slot`), skipping claimed blocks and blocks holding a well-known port (24800, 25565, 25672, 26257, 27017–27019, 28015, 30000) | per-port env (`OPENSCOUT_BROKER_PORT`, `OPENSCOUT_WEB_PORT`, `OPENSCOUT_PAIRING_PORT`, …) or `OPENSCOUT_INSTANCE_PORT_BASE` |
| node name / qualifier | hostname | `<host>-<name>` | `OPENSCOUT_NODE_NAME`, `OPENSCOUT_NODE_QUALIFIER` |
| node id | persisted identity decides | `<host>-<name>-<meshId>` | `OPENSCOUT_NODE_ID` |
| launchd label | `app.openscout` | `app.openscout.<name>` | `OPENSCOUT_SERVICE_LABEL` |
| systemd user unit | `scout.service` | `scout-<name>.service` | `OPENSCOUT_SYSTEMD_UNIT` |
| mesh | allowed | off | opt in: `OPENSCOUT_INSTANCE_MESH=1` |

**Registry** (`~/.openscout/instances`, `OPENSCOUT_INSTANCE_REGISTRY` overrides),
with no shared read-modify-write:

- `.slots/<portBase>`: created with O_EXCL, content = owning instance. The
  creator owns the block, atomically. Probing tries successive blocks from
  the hashed start (skipping well-known-port blocks); `dev` reserves 24400; an
  explicit `OPENSCOUT_INSTANCE_PORT_BASE` reserves its slot too and is refused
  when another instance holds it (cross-instance collision detection).
- `.claims/<name>.json`: `{ portBase, root?, checkout?, explicitBase?, claimedAt }`,
  written via temp file + fsync + rename **after** the slot. The claimer then
  re-reads its slot; if it was reclaimed while the claimer stalled, it retries.
- A slot whose owner has no claim for it is an orphan (a crash between slot
  and claim). After 30s it is reclaimable: rename aside, re-check the owner's
  claim, put it back if a late claim appeared. Its owner restarting just
  finishes the claim.
- Release renames its own slot aside (verifying the content), then deletes
  its claim. A corrupt claim file only affects its own instance.
- Claims happen only in bootstraps (apply, checkout default), never under a
  test runner unless the override is set. Readers (layout, local-config port
  defaults) read the instance's own claim and the slot names.
- `scout instance list` prunes instances whose checkout is gone, or whose root
  vanished an hour after the claim, only when none of their ports answer and
  no recorded pid lives (paths whose parent is missing are left alone).
  `scout instance release <name> [--purge]` frees a block, refused while
  anything of the instance runs; `--purge` checks real paths so an
  intermediate symlink cannot lead it outside `~/.openscout/instances`.
  Release (without `--purge`) and prune leave `<root>/.released` in the root
  they leave behind; a new claim of the name removes it.
- `scout instance repair` refuses on a healthy registry (unless `--force`) and
  never moves a healthy instance's block: it rebuilds corrupt or missing
  claims from their slot, else from the root's `support/.host-info` or
  `config.json` broker port (only a block-aligned base in 24400–30399 clear of
  prod and the avoided ports), keeps the `root`/`checkout` still readable in a
  broken claim, skips released roots, re-creates missing slots, and reports
  the rest.
- A legacy `.ledger.json` is imported once into slots and claims and renamed
  `.ledger.json.migrated` (an unreadable one is moved aside).
- A broker whose port already answers with a different node id refuses to
  start and names the other node.

Instance port blocks sit in 24400–30399: below the Linux (32768–60999) and
macOS (49152+) ephemeral ranges, so outbound sockets cannot squat them, and
clear of prod (431xx) and the per-worktree bands (43200–45299).

## Flow

The model: **an explicit `OPENSCOUT_INSTANCE` always wins; every supervisor
pins one on what it launches; user-facing spawns strip instance env and carry
only a client pointer; the checkout default applies only when unset.**

1. Entrypoints import a bootstrap **first** (ESM evaluation order):
   - `instance-checkout-bootstrap` (broker daemon, both pairing controllers;
     `bun run dev` does the same): an **unset** `OPENSCOUT_INSTANCE` becomes
     `dev` (main checkout) or `dev-<folder>` (linked worktree; `<name>-<hash>`
     when the registry shows another live checkout owns the name) when the
     module lives in a source checkout. Nothing else is consulted: no parent
     pid, label or inherited record.
   - `instance-bootstrap` (base, listening, mesh-discover, otel, web server)
     and the CLI: materialize only.
2. `applyOpenScoutInstanceEnvironment(process.env)`:
   - always pins `OPENSCOUT_INSTANCE` (prod included), so service children
     inherit an explicit choice; consumes `OPENSCOUT_INSTANCE_EXPLICIT`.
   - prod: nothing else changes (today's env overrides keep working).
   - non-prod: claims its block first, then **overwrites** every
     derived key (homes, dirs, sockets, ports, node identity, labels) from the
     layout, drops `OPENSCOUT_BROKER_HOST`, broker URLs that are not loopback
     on its own broker port, and `OPENSCOUT_CHAT_HOME` / `_ZELLIJ_SOCKET_DIR` /
     `_JETSTREAM_HOME` / `_PAIRING_RUNTIME_STATE_PATH` (they default under the
     instance).
     Ambient env never overrides a non-prod instance; customize it with
     `OPENSCOUT_INSTANCE_ROOT` / `_PORT_BASE` / `_MESH` or the instance's own
     `config.json` ports.
   - non-prod without mesh opt-in forces local scope, discovery/rendezvous
     off, empty seeds, and deletes inherited mesh/relay secrets. The push relay
     session/URL/mesh id are deleted for every non-prod instance.
   - Never reads `OPENSCOUT_CLIENT_INSTANCE`.
3. **Supervisors pin:** scoutd (base spawn and the launchd plist always carry
   `OPENSCOUT_INSTANCE`, prod by default), `nativeServiceEnvironment`, every
   systemd unit that runs checkout code, the macOS app and menu helper
   (`OpenScoutToolchain.defaultEnvironment`), and base/broker/web/CLI children
   (inherited from the pinned env). The installed-shim prod unit is the only
   unpinned case; installed packages never take a checkout default.
4. **User-facing spawns strip** (opt-in, never in service spawns):
   `buildUserSpawnEnvironment` always drops `OPENSCOUT_INSTANCE` and the
   spawner's markers (parent pid, service label/mode, explicit flag) and sets
   `OPENSCOUT_CLIENT_INSTANCE=<spawner's instance>`.
   - prod spawner: every other `OPENSCOUT_*` value is kept. Prod's apply
     derives nothing, so they are the operator's genuine overrides (a prod
     broker on `OPENSCOUT_BROKER_PORT=45555` keeps its agents on 45555).
   - non-prod spawner: every instance-derived key
     (`OPENSCOUT_USER_SPAWN_STRIPPED_ENV_KEYS`) is dropped too.
   Used by `buildInteractiveTerminalEnvironment`, the tmux launch directives
   (`unset …; export <pointer + kept overrides>`), `buildManagedAgentEnvironment`
   (claude stream-json, codex app-server), the agent-sessions adapters and
   codex transport fallback (`scoutUserSpawnEnvironment`; key list and
   normalizer kept in sync by a test), Pi (pointer + overrides added to its
   allow-list), scoutbot, the Devin CLI transport, and per-session servers
   whose env is their panes' env (zellij, herdr).
   **Multiplexer servers start clean:** a tmux server's env becomes every later
   pane's global env, so anything that may start one uses
   `buildMultiplexerServerEnvironment` (no instance key, not even the pointer):
   `execSystemFile` forces it for every local `tmux new-session`, scoutd's
   `tmux.newSession` verb `env_remove`s the same keys
   (`TMUX_SERVER_STRIPPED_ENV_KEYS`), and the call sites pass it explicitly.
   Per-pane values go in the pane command: `wrapUserSpawnPaneCommand`
   (`env -u … <pointer + kept overrides> sh -c …`; with no command it runs the
   user's tmux `default-command`, else `default-shell -l`).
   **Prod behaviour change:** panes Scout creates in a tmux server the user
   started now run with every `OPENSCOUT_*` instance key removed from that
   server's global env (PATH and other variables are kept); a prod spawner's
   own overrides are set explicitly instead.
   Prod user spawns also drop `OPENSCOUT_RUNTIME_PACKAGE_DIR` and the
   `OPENSCOUT_INSTANCE_ROOT/_PORT_BASE/_MESH` knobs (they describe the
   service), and a non-prod apply drops an inherited runtime package dir.
5. **Clients follow the pointer:** the CLI (`selectCliOpenScoutInstance`):
   explicit `OPENSCOUT_INSTANCE`/`--instance`, else `OPENSCOUT_CLIENT_INSTANCE`,
   else prod. So `scout ask` in an agent under a dev broker reaches dev, while
   `bun run dev` in that agent's checkout takes its own checkout default.
6. Central resolvers (`resolveOpenScoutSupportPaths`, `resolveOpenScoutHome`,
   `resolveOpenScoutPairingHome`, `resolveOpenScoutScoutHome`, local-config
   port defaults incl. the registry) are instance-aware even without step 2.
7. Rails: `enforceOpenScoutInstanceIsolation(surface)` runs before the broker,
   web server, pairing controllers, CLI and every systemd command except
   status. After step 2 they catch `OPENSCOUT_INSTANCE_*` knobs or service
   configs that land on prod. Mesh discovery (startup, interval,
   `POST /v1/mesh/discover`) and mesh bind are refused off prod without opt-in.
8. Entrypoint choice: a non-prod instance only runs pairing-controller builds
   that carry instance support, never prod's global copy; the runtime bin
   falls back from a pre-instance dist to source (unless the process is
   explicitly prod or asks for `OPENSCOUT_RUNTIME_ENTRYPOINT=dist`).

## Invariants

- `prod` with no other env is the pre-instance behaviour: same paths, ports,
  labels, unit name. Never change prod defaults to fix a dev problem.
- A non-prod instance never binds a prod port (including pairing +1/+2), never
  writes inside `~/.openscout` (except `~/.openscout/instances/`), `~/.scout`,
  or prod's support dir, never uses prod's label/unit or node qualifier, and
  never points `OPENSCOUT_BROKER_URL`/`OPENSCOUT_BROKER_INTERNAL_URL` at a prod
  loopback port. Violations exit non-zero with a list.
- Explicit env always wins for the running process. Only persisted service
  definitions (`persistentBrokerServiceConfig`) swap transient `/tmp` paths.
- Pairing identity (`identity.json`, the bridge's Noise static key) is per
  instance: a phone paired to prod must never trust a dev bridge.
- The Claude statusline (`~/.claude/settings.json`, one per login) belongs to
  prod: `installClaudeStatuslineTool` skips non-prod instances
  (`non-prod-instance`) and the statusline entry drops an inherited dev
  instance env unless `scout --instance <name>` or
  `OPENSCOUT_STATUSLINE_INSTANCE=<name>`.
- Never read `OPENSCOUT_CLIENT_INSTANCE` in a service bootstrap, and never
  strip instance env in a shared builder that service spawns use.
- New code that needs a path must call a resolver in `support-paths.ts`, never
  `join(homedir(), ".openscout" | ".scout" | ...)`. agent-sessions (no runtime
  dependency) uses `scout-state-paths.ts`.

## External readers of instance state

Tools outside this repo that read pairing state directly (for example
`oscout/scout-android`'s `scripts/pair-emulator.sh` and `tools/bridge-probe.ts`,
which read `~/.scout/pairing/runtime.json`) should read
`${OPENSCOUT_PAIRING_HOME:-$HOME/.scout/pairing}/runtime.json`. A dev
instance's file is `~/.openscout/instances/dev/pairing/runtime.json`; its
bridge listens on 24420 (relay 24421, file server 24422). Phones get the
relay and ports from the pairing QR and need nothing.

## Linux service adapter (`linux-systemd-user`)

Opt-in only: `OPENSCOUT_SERVICE_ADAPTER=systemd-user`. Linux defaults to
`headless-foreground`, as on main, for every caller (setup, doctor, the
desktop/web service client and `openscout-runtime service`). Unit: `${XDG_CONFIG_HOME:-~/.config}/systemd/user/<unit>`.
`ExecStart` is the global `openscout-runtime` shim when it belongs to the
runtime package (installed prod), else `<bun> <runtime>/bin/openscout-runtime.mjs broker`.
PATH = bun global bin (`BUN_INSTALL/bin`, else `bun pm bin -g`: `~/.cache/.bun/bin`
under mise, `~/.bun/bin` otherwise), mise shims when Bun is from mise,
`~/.local/bin`, `/usr/local/bin`, `/usr/bin`. `Restart=on-failure`,
`RestartSec=5`, `WantedBy=default.target`. `Environment=OPENSCOUT_INSTANCE=<name>`
is emitted for every non-prod unit and for prod whenever the runtime is not
the installed package (a checkout, or a shim resolving into one). Values are
quoted and escaped per systemd.syntax (`%`→`%%`, `$`→`$$` in ExecStart,
double-quoted words with `\\`/`"` escapes). Operator `Environment=` lines in
an existing unit are kept verbatim (quoted, multi-assignment), so adopting a
hand-written unit is a no-op. A unit whose `ExecStart` runs a different
runtime is not repointed, stopped or uninstalled without
`OPENSCOUT_ALLOW_SHARED_SERVICE_REPOINT=1`. `start` restarts an active unit
whose definition changed and fails when health never comes up; status warns
when lingering is off.

## Code map

| Concern | File |
|---|---|
| derivation, apply/strip, rails, checkout default | `packages/runtime/src/instance.ts` |
| path resolvers | `packages/runtime/src/support-paths.ts` |
| port defaults | `packages/runtime/src/local-config.ts` |
| launchd label, /tmp persistence boundary, systemd lifecycle | `packages/runtime/src/broker-process-manager.ts` |
| unit render/write/systemctl | `packages/runtime/src/systemd-user-service.ts` |
| mesh gate | `broker-daemon.ts` (discovery/rendezvous), `mesh-bind-controller.ts`, `resolveAdvertiseScope` |
| CLI flag | `packages/cli/bin/lifecycle-preflight.mjs` (`applyInstanceFlag`), `packages/cli/src/cli/main.ts` |
| dev loop | `packages/web/scripts/dev.mjs` |

## Verification

```bash
bun test packages/runtime/src/instance.test.ts packages/runtime/src/systemd-user-service.test.ts
bun test packages/runtime/src/broker-process-manager.test.ts packages/runtime/src/setup.test.ts
```

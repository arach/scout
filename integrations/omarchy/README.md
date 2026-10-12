# Scout on Omarchy

This optional Linux integration supplies the full Scout popup and launcher:
attention, tracked work, live provider capacity, machines, notification controls,
and quick actions. It also supplies an optional left-edge HUD. Its first-party sources are maintained here under the root
Apache-2.0 license. Omarchy/Quickshell APIs are dependencies; their source is not
copied into this repository.

Requires Omarchy with its Quickshell bar plugin API, Python 3, Bun, systemd,
`hyprctl`, and the public Scout CLI 0.3.8 or newer. The default user service name
is `scout.service`. This is a high-trust local developer integration.

From a public Scout checkout, inspect the destinations and apply:

```bash
bun integrations/omarchy/install.ts
bun integrations/omarchy/install.ts --apply
```

The installer backs up existing helper/plugin files, preserves shell placement
and preferences, and records the selected CLI in the Linux desktop installation
receipt. `--cli /path/to/scout` selects an explicit installed public CLI;
`SCOUT_CLI_BIN` overrides it at runtime. It does not prepend an old Bun cache
directory or invoke a private checkout. `--home /temporary/home` prepares an
isolated installation for inspection.

## Left-edge HUD and TUI

```bash
bun integrations/omarchy/install.ts --enable-hud --tui target/release/scout-tui
bun integrations/omarchy/install.ts --enable-hud --tui target/release/scout-tui --apply
```

`--enable-hud` adds only `scout.hud` to the existing shell plugin list. It preserves
bar layout, other plugins, and settings. Approach the left-edge Scout handle to
peek; leave to fold it away. Pin keeps it open. Motion off stops its decorative
light and makes opening immediate. The drawer takes no keyboard focus and reserves
no workspace area. It uses the same supported CLI reads as the bar menu; unavailable
and stale observations stay unavailable. Quota readings require an observation
time within 15 minutes; fresh cache reads do not reset that age. Refresh asks
Scout to refresh provider readings. In-progress work requires an explicit running
flight or active work item; recorded/starting requests remain in tracked history.
Preferences live in
`${XDG_CONFIG_HOME:-~/.config}/openscout/linux-hud.json`; optional `screen` selects
a monitor by name (otherwise the first monitor).

`--tui` verifies a public TUI candidate's interface and copies it into a directory
named by its SHA-256. The launcher records and uses that installed binary, outside
source checkouts. Open TUI launches a separate Ghostty window where available.
To float that terminal on the left across workspaces, copy `scout-hud.lua` into your
user `hypr` directory and add `require("hypr.scout-hud")` to your Hyprland Lua config;
reload and check `hyprctl configerrors`. The rule matches only Scout's HUD terminal.

The TUI accepts `scout tui --ambient shimmer` and `--ambient off`. Ctrl+S toggles
the light, including while drafting; it leaves the draft intact. The default is
off, or set `SCOUT_TUI_AMBIENT=shimmer`. Shimmer changes background colors only,
runs at five frames per second while idle, and pauses when the terminal loses focus.

Use `omarchy-shell scout.hud open`, `close`, `toggle`, `hide`, `show`, or `state`
to control the drawer. `setMotion false` turns motion off. Hiding can be reversed
with `show`; removing the `scout.hud` plugin entry disables it on startup.

For first installation, run `omarchy bar put scout.linux --section right`. Existing
entries hot-reload when their user-owned plugin files are replaced. No files in
`/usr/share/omarchy` are modified. The menu consumes supported Scout CLI reads;
budget reads start the web child through `scout server start` before querying
the feed. They do not launch another broker.

Install the [notification observer](../../docs/linux-desktop.md) separately if
you want live notification controls. Without it, that panel reports the missing
observer; the remaining popup and launcher still work. The standalone
[usage study](../../examples/linux-usage/README.md) remains a synthetic design
example, independent of this live menu.

The appearance helper supports `solid`, `subtle`, and `glass`. It writes only
the user-owned `hypr/scout.lua` file, validates a reload, and restores the prior
file when configuration errors occur. Include that file from your user Hyprland
Lua configuration to opt into appearance controls; the desktop installer does
not alter your window-manager configuration.

Keep installation receipts and desktop preferences outside Git. Update from a
reviewed public source revision and rerun the installer; use its recorded backup
to restore previous helper/plugin files. The installer restores replaced files
if applying a later file fails. Backups mirror destination paths, including the
shell layout when HUD activation is requested.

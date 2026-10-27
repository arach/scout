# Scout notifications on Linux

Scout's optional Linux desktop observer consumes the local runtime's live
`/v1/events/stream` API over its Unix socket. It shows communication and
broker attention through Omarchy's notification service. It does not write
Scout messages, launch agents, or read external harness transcripts.

## Install

Requires Bun, `busctl` (from systemd), a running Scout runtime with
`GET /v1/notification-routing` (public Scout 0.3.7 or newer), and Omarchy with clickable
`omarchy-exec-argv` notification hints. This API is added by the Linux
notification source change; runtimes older than 0.3.7 do not provide it.
An older runtime produces an HTTP 404 observer error and no live alerts;
the observer never falls back to reading full conversation history.

The observer is an optional source installation. It is not bundled into the
npm package and does not start when `scout setup` runs. From a checkout of
public `openscout-app/scout`, review the destinations and install:

```bash
bun scripts/linux/install-notifications.ts
bun scripts/linux/install-notifications.ts --apply
systemctl --user daemon-reload
systemctl --user enable --now scout-notifications.service
scout-notifications test
```

The installer bundles the observer into
`${XDG_DATA_HOME:-~/.local/share}/openscout/linux-desktop`, creates a CLI wrapper
and user service, and preserves existing notification preferences. It adds
notification controls to an existing `scout.linux` Omarchy bar plugin, backing
up `Widget.qml` before editing it. Install the public
[Omarchy popup and launcher](../integrations/omarchy/README.md) to create the
full bar menu. Without that plugin, CLI configuration remains available.
Rerun the installer and restart the notification service
to update it. The runtime is not restarted.

The observer starts with the graphical session and follows its lifetime.
Omarchy handles notification display, history, and Do Not Disturb. Clicking
an alert opens the related Scout conversation or work view through
`scout server open`.

Preview both directions with `scout-notifications test roundtrip`. It shows an
outgoing **OUT → IN** card, then an incoming **IN → OUT** card. These are labeled
as demos and do not send Scout messages or launch agents. Use `test inbound` or
`test outbound` to preview one direction. The preview respects the enabled,
direction, preview, and desktop Do Not Disturb settings.

### Scout card styling

For compact Scout cards with separate direction badges, sender/recipient lines,
sage inbound and amber outbound accents, clone Omarchy's notification plugin:

```bash
omarchy plugin clone omarchy.notifications
bun scripts/linux/install-notifications.ts --apply --notification-plugin="$HOME/.config/omarchy/plugins/$USER.notifications"
systemctl --user daemon-reload
systemctl --user restart scout-notifications.service
omarchy restart shell
omarchy-shell notifications ping
scout-notifications test roundtrip
```

The clone lives in your user configuration. Omarchy keeps the notification
service loaded, so restart the shell after installing or updating the card.
Its original native card is saved as `components/NativeNotificationCard.qml`; other apps use that
card. The native notification service continues to handle DND, history, click
actions, hover-paused expiry, and right-click dismissal. Scout's small expiry
line shares the service's timer. Preview cards carry a **PREVIEW** label.

Rerun the installer with the same plugin path to update the Scout presentation.
The clone retains the Omarchy service version present when it was created;
review it after Omarchy updates. To restore the original card, copy
`NativeNotificationCard.qml` over `NotificationCard.qml` in that clone.
Restart the shell to apply the restored presentation.

## Configuration

Open the Scout bar menu's **Tools** tab. Inbound and outbound communication,
attention, previews, and agent-to-agent traffic have independent controls.
All are enabled on first installation. Preferences apply to subsequent events
without restarting the observer.

The same settings are available through the CLI:

```bash
scout-notifications status
scout-notifications set inbound true
scout-notifications set outbound false
scout-notifications set attention true
scout-notifications set previews false
scout-notifications set scope operator
scout-notifications set maxPerMinute 12
scout-notifications set enabled false
```

Settings live in
`${XDG_CONFIG_HOME:-~/.config}/openscout/linux-notifications.json`.
`OPENSCOUT_LINUX_NOTIFICATION_CONFIG` overrides that file. The observer uses
Scout's support-directory resolver and honors `OPENSCOUT_BROKER_SOCKET_PATH`.

In operator conversations, **outbound** means authored by `operator` and
**inbound** means addressed to the operator or posted by another actor in a
conversation the operator participates in. With scope `all`, additional
agent-to-agent messages are outbound when their `originNodeId` is this runtime's
node and inbound when they originate elsewhere. Routing fields determine
direction; body mentions do not.

Communication alerts cover `message.posted` events with class `agent`.
Attention alerts cover declared operator needs, broker delivery failures,
collaboration requests whose next move belongs to the operator, failures for
observed invocations, and completions with explicit `replyMode: notify`.
One message produces one alert; an operator need uses the attention switch.
Ordinary status/log messages do not generate communication alerts.

## Delivery and verification

This is a best-effort live observer. It does not backfill messages on startup
or reconnect; traffic during a disconnect may be missed. Only events emitted
by this runtime are visible. It does not claim to capture host permission
prompts or messages forwarded without a local `message.posted` event.

Before each stream connection, the observer hydrates sender identity and
metadata for every conversation, including old idle operator threads, plus
invocations referenced by active flights. The dedicated routing endpoint
returns conversation IDs, participants and titles, and invocation IDs,
requester/conversation IDs and reply mode. It excludes message bodies,
invocation task text, flight results and attention history. A completion after
startup uses its live result summary, or a generic fallback when absent.

Recent notification IDs are deduplicated across restarts. Communication bursts
are limited to `maxPerMinute`; attention does not compete for that allowance.
The sink queue and dedupe cache are bounded. Message text is escaped as text,
and notification click commands have fixed argv. Observer status and dedupe
files contain IDs and counts, not message previews. Desktop notification
history follows Omarchy's own retention behavior.

```bash
systemctl --user status scout-notifications.service
journalctl --user -u scout-notifications.service -n 50
bun test scripts/linux/notification-policy.test.ts scripts/linux/scout-notifications.test.ts
```

From a clean source checkout, `bun install`, `bun run protocol:build`, then
`bunx tsc -p scripts/linux/tsconfig.json` checks the observer, installer, tests
and standalone usage example. QML parsing requires Qt's `qmlformat`; a source
parse does not establish that every Omarchy version can render the cards.

Stop login startup with
`systemctl --user disable --now scout-notifications.service`.

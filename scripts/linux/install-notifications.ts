#!/usr/bin/env bun
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { defaultSettings } from "./notification-policy.js";

const args = process.argv.slice(2);
const selectedHome = args.find(arg => arg.startsWith("--home="))?.slice("--home=".length);
const home = selectedHome ? resolve(selectedHome) : homedir();
const configHome = (!selectedHome && process.env.XDG_CONFIG_HOME) || join(home, ".config");
const dataHome = (!selectedHome && process.env.XDG_DATA_HOME) || join(home, ".local", "share");
const apply = args.includes("--apply");
const candidate = args.find(arg => arg.startsWith("--candidate="))?.slice("--candidate=".length);
const notificationPlugin = args.find(arg => arg.startsWith("--notification-plugin="))?.slice("--notification-plugin=".length);
const installDirectory = join(dataHome, "openscout", "linux-desktop");
const scriptPath = join(installDirectory, "scout-notifications.js");
const executable = join(home, ".local", "bin", "scout-notifications");
const configPath = join(configHome, "openscout", "linux-notifications.json");
const servicePath = join(configHome, "systemd", "user", "scout-notifications.service");
const pluginDirectory = join(configHome, "omarchy", "plugins", "scout.linux");
const widgetPath = join(pluginDirectory, "Widget.qml");
const controlsPath = join(pluginDirectory, "NotificationControls.qml");
const sourceDirectory = dirname(import.meta.path);
const cardPath = notificationPlugin ? join(resolve(notificationPlugin), "components", "NotificationCard.qml") : undefined;
const nativeCardPath = cardPath ? join(dirname(cardPath), "NativeNotificationCard.qml") : undefined;
const cardMarker = "// Scout presentation for a user-owned clone of omarchy.notifications.";
let originalCard: string | undefined;
if (cardPath && nativeCardPath) {
  const manifest = JSON.parse(readFileSync(join(resolve(notificationPlugin!), "manifest.json"), "utf8"));
  if (manifest.omarchy?.clonedFrom !== "omarchy.notifications") throw new Error("Notification styling requires a user-owned clone of omarchy.notifications");
  originalCard = readFileSync(cardPath, "utf8");
  if (originalCard.startsWith(cardMarker) && !existsSync(nativeCardPath)) throw new Error("The original native notification card is missing");
  if (!originalCard.startsWith(cardMarker) && existsSync(nativeCardPath)) throw new Error("This notification card has independent edits; use a fresh clone for Scout styling");
}
const bun = Bun.which("bun");
if (!bun) throw new Error("Bun is required to run the notification observer");

const shellQuote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
const unitQuote = (value: string) => '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%") + '"';
const build = candidate ? resolve(candidate) : join(installDirectory, "scout-notifications.js");
const unit = `[Unit]
Description=Scout desktop communication notifications
After=graphical-session.target
PartOf=graphical-session.target

[Service]
Type=simple
Environment=PATH=${home}/.local/bin:${home}/.cache/.bun/bin:${home}/.bun/bin:${home}/.local/share/mise/shims:/usr/local/bin:/usr/bin
ExecStart=${unitQuote(bun)} ${unitQuote(scriptPath)} run
Restart=on-failure
RestartSec=3

[Install]
WantedBy=graphical-session.target
`;
const marker = "                        NotificationControls {";
const anchor = '                        visible: root.tab === "Tools"';
let widget: string | undefined;
if (existsSync(widgetPath)) {
  widget = readFileSync(widgetPath, "utf8");
  if (!widget.includes(marker)) {
    if (!widget.includes(anchor)) throw new Error("Scout menu layout changed; notification controls cannot be inserted safely");
    widget = widget.replace(anchor, anchor + "\n" + marker + "\n                            width: parent.width\n                        }");
  }
}

console.log(JSON.stringify({ apply, files: [scriptPath, executable, servicePath, ...(existsSync(configPath) ? [] : [configPath]), ...(widget ? [widgetPath, controlsPath] : []), ...(cardPath ? [cardPath, nativeCardPath] : [])] }, null, 2));
if (!apply) {
  console.log("Run with --apply to install. Then: systemctl --user daemon-reload && systemctl --user enable --now scout-notifications.service");
  process.exit(0);
}

mkdirSync(installDirectory, { recursive: true });
if (candidate) {
  if (!existsSync(build)) throw new Error("Prepared notification bundle was not found");
  writeFileSync(scriptPath, readFileSync(build));
} else {
  const result = await Bun.build({ entrypoints: [join(sourceDirectory, "scout-notifications.ts")], target: "bun", outdir: installDirectory, naming: "scout-notifications.js" });
  if (!result.success) throw new Error(result.logs.join("\n"));
}
mkdirSync(dirname(executable), { recursive: true });
writeFileSync(executable, `#!/usr/bin/env bash\nexec ${shellQuote(bun)} ${shellQuote(scriptPath)} "$@"\n`, { mode: 0o755 });
chmodSync(executable, 0o755);
mkdirSync(dirname(servicePath), { recursive: true });
writeFileSync(servicePath, unit);
if (!existsSync(configPath)) {
  mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
  writeFileSync(configPath, JSON.stringify(defaultSettings, null, 2) + "\n", { mode: 0o600 });
}
if (widget) {
  const current = readFileSync(widgetPath, "utf8");
  if (current !== widget) {
    writeFileSync(`${widgetPath}.before-notifications-${Date.now()}`, current);
    writeFileSync(controlsPath, readFileSync(join(sourceDirectory, "NotificationControls.qml")));
    writeFileSync(widgetPath, widget);
  } else writeFileSync(controlsPath, readFileSync(join(sourceDirectory, "NotificationControls.qml")));
}
if (cardPath && nativeCardPath && originalCard !== undefined) {
  // Keep the native presentation for every other app and as a restore source.
  if (!existsSync(nativeCardPath)) writeFileSync(nativeCardPath, originalCard);
  const styled = readFileSync(join(sourceDirectory, "ScoutNotificationCard.qml"), "utf8");
  if (styled !== originalCard) {
    if (originalCard.startsWith(cardMarker)) writeFileSync(`${cardPath}.before-scout-${Date.now()}`, originalCard);
    writeFileSync(cardPath, styled);
  }
}
console.log("Installed. Enable with: systemctl --user daemon-reload && systemctl --user enable --now scout-notifications.service");

import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { install } from "./install";
const homes: string[] = [];
afterEach(async () => { await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true }))); });
async function fixture(version = "0.3.8") {
  const home = await mkdtemp(join(tmpdir(), "scout-desktop-install-test-")); homes.push(home);
  const cli = join(home, "public-scout"); await writeFile(cli, "#!/bin/sh\nprintf '%s\\n' '" + version + "'\n", { mode: 0o755 });
  return { home, cli };
}
test("dry run changes no desktop files", async () => {
  const { home, cli } = await fixture(); await install(["--home", home, "--cli", cli]);
  expect(existsSync(join(home, ".config"))).toBe(false); expect(existsSync(join(home, ".local"))).toBe(false);
});
test("apply backs up customization and preserves layout and notification preferences", async () => {
  const { home, cli } = await fixture(); const widget = join(home, ".config/omarchy/plugins/scout.linux/Widget.qml");
  await mkdir(join(home, ".config/omarchy/plugins/scout.linux"), { recursive: true }); await writeFile(widget, "intentional custom widget");
  await writeFile(join(home, ".config/omarchy/shell.json"), "intentional shell layout");
  await mkdir(join(home, ".config/openscout"), { recursive: true }); await writeFile(join(home, ".config/openscout/linux-notifications.json"), "intentional notification preferences");
  await install(["--home", home, "--cli", cli, "--apply"]);
  const receipt = JSON.parse(await readFile(join(home, ".local/share/openscout/linux-desktop/desktop-install.json"), "utf8"));
  expect(receipt.cliBin).toBe(cli); expect(receipt.cliVersion).toBe("0.3.8");
  expect(await readFile(join(receipt.backup, ".config/omarchy/plugins/scout.linux/Widget.qml"), "utf8")).toBe("intentional custom widget");
  expect(await readFile(join(home, ".config/omarchy/shell.json"), "utf8")).toBe("intentional shell layout");
  expect(await readFile(join(home, ".config/openscout/linux-notifications.json"), "utf8")).toBe("intentional notification preferences");
  expect(existsSync(join(home, ".local/bin/scout-menu-common.py"))).toBe(true);
});
test("enabling HUD preserves the bar and existing plugin settings", async () => {
  const {home, cli} = await fixture(); const path = join(home, ".config/omarchy/shell.json");
  await mkdir(join(home, ".config/omarchy"), {recursive: true});
  const layout = {version: 1, bar: {layout: {left: [{id: "my.bar"}]}}, plugins: [{id: "custom.plugin", setting: 42}]};
  await writeFile(path, JSON.stringify(layout));
  await install(["--home", home, "--cli", cli, "--enable-hud", "--apply"]);
  const installed = JSON.parse(await readFile(path, "utf8"));
  expect(installed.bar).toEqual(layout.bar); expect(installed.plugins).toEqual([...layout.plugins, {id: "scout.hud"}]);
});
test("a later write failure restores earlier helper files", async () => {
  const {home, cli} = await fixture(); const helper = join(home, ".local/bin/scout-menu-status");
  await mkdir(join(home, ".local/bin"), {recursive: true}); await writeFile(helper, "original helper", {mode: 0o755});
  await mkdir(join(home, ".config/omarchy"), {recursive: true});
  await writeFile(join(home, ".config/omarchy/plugins"), "a file prevents plugin installation");
  await expect(install(["--home", home, "--cli", cli, "--apply"])).rejects.toThrow();
  expect(await readFile(helper, "utf8")).toBe("original helper");
  expect(existsSync(join(home, ".local/bin/scout-menu-action"))).toBe(false);
});
test("a copied TUI is reused without rewriting its inode and survives receipt-only updates", async () => {
  const {home, cli} = await fixture(); const source = join(home, "public-tui");
  await writeFile(source, "#!/bin/sh\nprintf '%s\\n' '--ambient off|shimmer'\n", {mode: 0o755});
  await install(["--home", home, "--cli", cli, "--tui", source, "--apply"]);
  const receiptPath = join(home, ".local/share/openscout/linux-desktop/desktop-install.json");
  const first = JSON.parse(await readFile(receiptPath, "utf8")); const inode = (await stat(first.tuiBin)).ino;
  await install(["--home", home, "--cli", cli, "--tui", source, "--apply"]);
  expect((await stat(first.tuiBin)).ino).toBe(inode);
  await install(["--home", home, "--cli", cli, "--apply"]);
  const last = JSON.parse(await readFile(receiptPath, "utf8"));
  expect(last.tuiBin).toBe(first.tuiBin); expect(last.tuiSha256).toBe(first.tuiSha256);
});
test("unsupported cached development CLI is rejected before writes", async () => {
  const { home, cli } = await fixture("0.3.6-dev.2");
  await expect(install(["--home", home, "--cli", cli, "--apply"])).rejects.toThrow("version");
  expect(existsSync(join(home, ".config"))).toBe(false);
});

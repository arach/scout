#!/usr/bin/env bun
import { mkdir, readFile, writeFile, chmod, copyFile, stat, rm, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, relative } from "node:path";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";

const SOURCE = import.meta.dir;
const HELPERS = ["scout-menu-common.py", "scout-menu-status", "scout-menu-action", "scout-appearance", "scout-omarchy", "scout-hud-tui"];
const PLUGIN_FILES = ["Widget.qml", "manifest.json"];
const RECEIPT_NAME = "desktop-install.json";

async function replaceFile(target: string, bytes: Buffer, mode: number): Promise<void> {
  const temporary = join(dirname(target), ".scout-install-" + crypto.randomUUID());
  try {
    await writeFile(temporary, bytes, {mode}); await chmod(temporary, mode);
    await rename(temporary, target); // Running Linux executables retain their original inode.
  } finally { await rm(temporary, {force: true}); }
}

export async function install(argv: string[]): Promise<void> {
  const { values } = parseArgs({ args: argv, options: { apply: { type: "boolean", default: false }, home: { type: "string" }, cli: { type: "string" }, tui: { type: "string" }, "enable-hud": { type: "boolean", default: false } } });
  const home = resolve(values.home ?? homedir());
  const config = values.home ? join(home, ".config") : process.env.XDG_CONFIG_HOME || join(home, ".config");
  const data = values.home ? join(home, ".local/share") : process.env.XDG_DATA_HOME || join(home, ".local/share");
  const bin = join(home, ".local/bin");
  const plugin = join(config, "omarchy/plugins/scout.linux");
  const installation = join(data, "openscout/linux-desktop");
  const cli = values.cli ? resolve(values.cli) : Bun.which("scout");
  if (!cli) throw new Error("Install the public Scout CLI or select --cli /path/to/scout");
  const child = Bun.spawn([cli, "--version"], { stdout: "pipe", stderr: "pipe" });
  const timeout = setTimeout(() => child.kill(), 10000);
  const [versionText, errorText, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  clearTimeout(timeout);
  const version = versionText.trim().match(/^(?:scout\s+)?(\d+\.\d+\.\d+)$/)?.[1];
  if (code || !version) throw new Error("Cannot verify Scout CLI version: " + errorText.trim());
  const parts = version.split(".").map(Number);
  if (parts[0] === 0 && parts[1] === 3 && parts[2] < 8 || parts[0] === 0 && parts[1] < 3) throw new Error("The desktop integration requires public Scout 0.3.8 or newer");

  const sources = [
    ...HELPERS.map((name) => ({ source: join(SOURCE, "bin", name), target: join(bin, name), executable: true })),
    ...PLUGIN_FILES.map((name) => ({ source: join(SOURCE, "plugin", name), target: join(plugin, name), executable: false })),
    ...["Service.qml", "HudButton.qml", "HudModel.js", "manifest.json"].map((name) => ({ source: join(SOURCE, "hud", name), target: join(config, "omarchy/plugins/scout.hud", name), executable: false })),
    { source: join(SOURCE, "../../scripts/linux/NotificationControls.qml"), target: join(plugin, "NotificationControls.qml"), executable: false },
    { source: join(SOURCE, "hud/HudModel.js"), target: join(plugin, "HudModel.js"), executable: false },
  ];
  // Read every source before replacing anything. Existing preferences and shell layout are not inputs to overwrite.
  const files = await Promise.all(sources.map(async (file) => ({ ...file, bytes: await readFile(file.source) })));
  let tuiBin: string | undefined;
  let tuiSha256: string | undefined;
  if (values.tui) {
    const source = resolve(values.tui);
    const probe = Bun.spawn([source, "--help"], { stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => probe.kill(), 10000);
    const [out, err, result] = await Promise.all([new Response(probe.stdout).text(), new Response(probe.stderr).text(), probe.exited]);
    clearTimeout(timer);
    if (result || !(out + err).includes("--ambient off|shimmer")) throw new Error("Select a public TUI build that supports --ambient off|shimmer");
    const bytes = await readFile(source); tuiSha256 = createHash("sha256").update(bytes).digest("hex");
    tuiBin = join(installation, "bin", tuiSha256, "scout-tui");
    files.push({source, target: tuiBin, executable: true, bytes});
  }
  if (values["enable-hud"]) {
    const target = join(config, "omarchy/shell.json");
    const layout = JSON.parse(await readFile(target, "utf8"));
    if (layout.version !== 1 || (layout.plugins !== undefined && !Array.isArray(layout.plugins))) throw new Error("Cannot enable HUD in an unrecognized Omarchy shell layout");
    layout.plugins ??= [];
    if (!layout.plugins.some((entry: {id?: string} | string) => (typeof entry === "string" ? entry : entry.id) === "scout.hud")) layout.plugins.push({id: "scout.hud"});
    files.push({source: target, target, executable: false, bytes: Buffer.from(JSON.stringify(layout, null, 2) + "\n")});
  }
  const receipt = join(installation, RECEIPT_NAME);
  const git = Bun.spawnSync(["git", "-C", SOURCE, "rev-parse", "HEAD"]);
  const sourceRevision = git.exitCode === 0 ? git.stdout.toString().trim() : null;
  const dirty = Bun.spawnSync(["git", "-C", SOURCE, "status", "--porcelain", "--", ".", "../../crates/scout-tui", "../../scripts/linux"]);
  const sourceDirty = dirty.exitCode !== 0 || dirty.stdout.toString().trim().length > 0;
  console.log(JSON.stringify({ apply: values.apply, cliBin: cli, cliVersion: version, tuiBin, files: [...files.map((file) => file.target), receipt] }, null, 2));
  if (!values.apply) return;
  const backup = join(installation, "backups", new Date().toISOString().replaceAll(":", "-") + "-" + crypto.randomUUID());
  const prior = new Map<string, {bytes: Buffer; mode: number} | null>();
  for (const target of [...files.map((file) => file.target), receipt]) {
    prior.set(target, existsSync(target) ? {bytes: await readFile(target), mode: (await stat(target)).mode & 0o777} : null);
    if (prior.get(target)) {
      const saved = join(backup, relative(home, target).replaceAll("..", "_external_"));
      await mkdir(dirname(saved), {recursive: true}); await copyFile(target, saved);
    }
  }
  const changed: string[] = [];
  try {
    await mkdir(join(config, "openscout"), {recursive: true});
    for (const file of files) {
      const original = prior.get(file.target);
      if (original?.bytes.equals(file.bytes) && (!file.executable || original.mode === 0o755)) continue;
      await mkdir(dirname(file.target), { recursive: true }); changed.push(file.target);
      await replaceFile(file.target, file.bytes, file.executable ? 0o755 : original?.mode ?? 0o644);
    }
    await mkdir(installation, { recursive: true }); changed.push(receipt);
    const oldReceipt = prior.get(receipt);
    const previous = oldReceipt ? JSON.parse(oldReceipt.bytes.toString()) : {};
    await replaceFile(receipt, Buffer.from(JSON.stringify({ schemaVersion: 1, repository: "oscout/scout", sourceRevision, sourceDirty, installedAt: new Date().toISOString(), cliBin: cli, cliVersion: version, tuiBin: tuiBin ?? previous.tuiBin, tuiSha256: tuiSha256 ?? previous.tuiSha256, backup, files: Object.fromEntries(files.map((file) => [file.target, createHash("sha256").update(file.bytes).digest("hex")])) }, null, 2) + "\n"), oldReceipt?.mode ?? 0o644);
  } catch (error) {
    const failures: unknown[] = [];
    for (const target of changed.reverse()) {
      const original = prior.get(target);
      try {
        if (original) await replaceFile(target, original.bytes, original.mode);
        else await rm(target, {force: true});
      } catch (failure) { failures.push(failure); }
    }
    if (failures.length) throw new AggregateError([error, ...failures], "Install failed; some files could not restore from backup " + backup);
    throw error;
  }
  console.log("Installed public Scout desktop files. Existing shell placement and preferences are preserved.");
  console.log("For a new bar entry: omarchy bar put scout.linux --section right");
  console.log("Install the optional observer separately: bun scripts/linux/install-notifications.ts --apply");
}
if (import.meta.main) await install(process.argv.slice(2));

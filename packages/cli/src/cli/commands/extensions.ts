import { runExtensionInputPermissions } from "../extension-input-permissions.ts";
import { join } from "node:path";
import { scoutExtensionTreeDigest } from "../extension-tree-digest.ts";
import { mutateScoutExtension, readScoutExtensionInstallReceipt, ScoutExtensionInstallError, type ScoutExtensionInstallOptions } from "../extension-install.ts";
import type { ScoutCommandContext } from "../context.ts";
import { ScoutCliError } from "../errors.ts";
import { listScoutExtensions, scoutExtensionsHome } from "../extensions.ts";
import { renderScoutExtensionLines } from "../help.ts";

const EXTENSIONS_HELP = `scout extensions — Manage installed CLI extensions

scout extensions                         List installed and refused extensions
scout extensions install <verb> <dir>    Install a trusted prebuilt local artifact
scout extensions update <verb> <dir>     Atomically activate a new artifact
scout extensions remove <verb>           Remove a managed install; block legacy fallback
scout extensions receipt <verb>          Read the selected generation's publication receipt
scout extensions tree-digest <directory> Read the canonical full-tree identity (no install)
scout extensions permissions list|inspect|grant|revoke  Manage explicit exact-tree input grants

Inspect: permissions inspect <verb>
Grant: permissions grant <verb> --tree-digest <digest> --declaration-digest <digest>
       --input distribution-key --destination <URL> --acknowledge-unknown-origin
Revoke: permissions revoke <grant-id>
No key literals, automatic grants or publisher continuity are supported.

Conditional install: --expect-absent --operation-id <id>
Conditional update:  --expect-generation <absolute-dir> --expect-tree-digest <tree-digest> --operation-id <id>
Conditions are checked under the installer lock. Without them, explicit install,
update and re-enable behavior is unchanged. --operation-id is also optional alone.

Artifacts need extension.json (api: 1 or 2, version, summary, command) and a bundled
executable inside the directory. No downloads, install hooks or PATH search.
Built-ins still win; installing mesh does not flip scout mesh. Updates retain
old generations for explicit rollback via update <verb> <old-artifact-dir>.
Unmanaged directories/links are never overwritten. See docs/cli-extensions.md
and docs/extension-install-conditions.md for conditions and receipt recovery.`;

function mutationOptions(args: string[]): ScoutExtensionInstallOptions {
  const values = new Map<string, string>(); let absent = false;
  const invalid = () => new ScoutExtensionInstallError("EXTENSION_CONDITION_INVALID", "use --expect-absent or both --expect-generation <absolute-dir> and --expect-tree-digest <tree-digest>, with --operation-id <id>; flags must not repeat");
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]!;
    if (flag === "--expect-absent") { if (absent) throw invalid(); absent = true; }
    else if (["--expect-generation", "--expect-tree-digest", "--operation-id"].includes(flag)) {
      const value = args[++index];
      if (!value || value.startsWith("--") || values.has(flag)) throw invalid();
      values.set(flag, value);
    } else throw invalid();
  }
  const generation = values.get("--expect-generation"), treeDigest = values.get("--expect-tree-digest");
  if ((absent && (generation !== undefined || treeDigest !== undefined)) || (generation === undefined) !== (treeDigest === undefined)) throw invalid();
  return { operationId: values.get("--operation-id"), expected: absent ? { absent: true } : generation !== undefined ? { generation, treeDigest: treeDigest! } : undefined };
}

export async function runExtensionsCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    context.output.writeText(EXTENSIONS_HELP);
    return;
  }
  if (args[0] === "permissions") { runExtensionInputPermissions(context, args.slice(1)); return; }
  if (args[0] === "tree-digest") {
    if (args.length !== 2) throw new ScoutCliError("usage: scout extensions tree-digest <directory>");
    context.output.writeValue({ treeDigest: scoutExtensionTreeDigest(args[1]!) }, value => value.treeDigest);
    return;
  }
  if (args.length) {
    const [action, name, source] = args;
    const count = action === "remove" || action === "receipt" ? 2 : 3;
    if (!["install", "update", "remove", "receipt"].includes(action!) || !name || args.length < count || (action === "receipt" && args.length !== 2)) {
      throw new ScoutCliError("usage: scout extensions install|update <verb> <directory> [conditions], or remove|receipt <verb>");
    }
    try {
      const receipt = action === "receipt" ? readScoutExtensionInstallReceipt(name, context.env)
        : mutateScoutExtension(action as "install" | "update" | "remove", name, action === "remove" ? undefined : source, context.env, mutationOptions(args.slice(count)));
      context.output.writeValue(receipt, value => `${value.name}: ${value.status}${value.version ? ` (${value.version})` : ""}`);
    } catch (error) {
      if (error instanceof ScoutExtensionInstallError && context.output.mode === "json") {
        // Only expose a pointer after the read-only reader verifies the live selection.
        let lastReceipt: string | undefined;
        try {
          const current = readScoutExtensionInstallReceipt(name, context.env);
          lastReceipt = join(current.home, ".receipts", name, `${current.publishedGeneration.split("/").pop()}.json`);
        } catch { /* Unknown or unsafe metadata is not a recovery pointer. */ }
        // context.stderr uses a raw stream write, never a color-aware console formatter.
        context.stderr(JSON.stringify({ schema: "scout.cli.extension-install-error/v1", error: error.code, message: error.message,
          ...(lastReceipt === undefined ? {} : { lastReceipt }) }));
        process.exitCode = 1;
        return;
      }
      throw new ScoutCliError(error instanceof ScoutExtensionInstallError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : "extension installation failed");
    }
    return;
  }
  const installed = listScoutExtensions(context.env);
  context.output.writeValue({ home: scoutExtensionsHome(context.env), extensions: installed }, (value) => [
    `Extensions home: ${value.home}`,
    renderScoutExtensionLines(value.extensions),
    ...value.extensions.filter((extension) => extension.refused).map((extension) => `\n${extension.refused}`),
  ].join("\n"));
}

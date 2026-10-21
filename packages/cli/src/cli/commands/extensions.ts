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

Conditional install: --expect-absent --operation-id <id>
Conditional update:  --expect-generation <absolute-dir> --expect-digest <sha256> --operation-id <id>
Conditions are checked under the installer lock. Without them, explicit install,
update and re-enable behavior is unchanged. --operation-id is also optional alone.

Artifacts need extension.json (api: 1, version, summary, command) and a bundled
executable inside the directory. No downloads, install hooks or PATH search.
Built-ins still win; installing mesh does not flip scout mesh. Updates retain
old generations for explicit rollback via update <verb> <old-artifact-dir>.
Unmanaged directories/links are never overwritten. See docs/cli-extensions.md
and docs/extension-install-conditions.md for conditions and receipt recovery.`;

function mutationOptions(args: string[]): ScoutExtensionInstallOptions {
  const values = new Map<string, string>(); let absent = false;
  const invalid = () => new ScoutExtensionInstallError("EXTENSION_CONDITION_INVALID", "use --expect-absent or both --expect-generation <absolute-dir> and --expect-digest <sha256>, with --operation-id <id>; flags must not repeat");
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]!;
    if (flag === "--expect-absent") { if (absent) throw invalid(); absent = true; }
    else if (["--expect-generation", "--expect-digest", "--operation-id"].includes(flag)) {
      const value = args[++index];
      if (!value || value.startsWith("--") || values.has(flag)) throw invalid();
      values.set(flag, value);
    } else throw invalid();
  }
  const generation = values.get("--expect-generation"), digest = values.get("--expect-digest");
  if ((absent && (generation !== undefined || digest !== undefined)) || (generation === undefined) !== (digest === undefined)) throw invalid();
  return { operationId: values.get("--operation-id"), expected: absent ? { absent: true } : generation !== undefined ? { generation, digest: digest! } : undefined };
}

export async function runExtensionsCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    context.output.writeText(EXTENSIONS_HELP);
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

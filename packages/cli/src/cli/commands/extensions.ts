import { mutateScoutExtension } from "../extension-install.ts";
import type { ScoutCommandContext } from "../context.ts";
import { ScoutCliError } from "../errors.ts";
import { listScoutExtensions, scoutExtensionsHome } from "../extensions.ts";
import { renderScoutExtensionLines } from "../help.ts";

const EXTENSIONS_HELP = `scout extensions — Manage installed CLI extensions

scout extensions                         List installed and refused extensions
scout extensions install <verb> <dir>    Install a trusted prebuilt local artifact
scout extensions update <verb> <dir>     Atomically activate a new artifact
scout extensions remove <verb>           Remove a managed install; block legacy fallback

Artifacts need extension.json (api: 1, version, summary, command) and a bundled
executable inside the directory. No downloads, install hooks or PATH search.
Built-ins still win; installing mesh does not flip scout mesh. Updates retain
old generations for explicit rollback via update <verb> <old-artifact-dir>.
Unmanaged directories/links are never overwritten. See docs/cli-extensions.md.`;

export async function runExtensionsCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    context.output.writeText(EXTENSIONS_HELP);
    return;
  }
  if (args.length) {
    const [action, name, source] = args;
    if ((action !== "install" && action !== "update" && action !== "remove") || !name
      || args.length !== (action === "remove" ? 2 : 3)) throw new ScoutCliError("usage: scout extensions install|update <verb> <directory>, or remove <verb>");
    try { context.output.writeValue(mutateScoutExtension(action, name, source, context.env), value => `${value.name}: ${value.status}${value.version ? ` (${value.version})` : ""}`); }
    catch (error) { throw new ScoutCliError(error instanceof Error ? error.message : "extension installation failed"); }
    return;
  }
  const installed = listScoutExtensions(context.env);
  context.output.writeValue({ home: scoutExtensionsHome(context.env), extensions: installed }, (value) => [
    `Extensions home: ${value.home}`,
    renderScoutExtensionLines(value.extensions),
    ...value.extensions.filter((extension) => extension.refused).map((extension) => `\n${extension.refused}`),
  ].join("\n"));
}

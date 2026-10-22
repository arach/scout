import type { ScoutCommandContext } from "../context.ts";
import { defaultScoutContextDirectory } from "../context.ts";
import { parseWhoCommandOptions } from "../options.ts";
import { listScoutAgents } from "../../lib/core/broker/service.ts";
import { renderScoutAgentList } from "../../lib/ui/terminal/broker.ts";

const HELP_FLAGS = new Set(["--help", "-h"]);

export function renderWhoCommandHelp(): string {
  return [
    "Usage: scout who [--machine <name>] [--context-root <path>] [--json]",
    "",
    "List agents known to the broker for routing and discovery.",
    "Filter by node id, name, hostname, or a short name token (mini); all matching nodes are included.",
    "",
    "Use this before sending or asking when you need the exact target.",
    "Short handles like @hudson can be ambiguous; copy a qualified handle or agent id from discovery output when needed.",
    "Qualified handles can include harness and model selectors, such as @talkie#codex?5.5.",
    "",
    "Examples:",
    "  scout who",
    "  scout who --json",
    "  scout who --machine mini",
    "  scout ask --to talkie#codex?5.5 \"status?\"",
  ].join("\n");
}

export async function runWhoCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  if (args.some((arg) => HELP_FLAGS.has(arg))) {
    context.output.writeText(renderWhoCommandHelp());
    return;
  }

  const options = parseWhoCommandOptions(args, defaultScoutContextDirectory(context));
  const entries = await listScoutAgents({ currentDirectory: options.currentDirectory, machine: options.machine });
  context.output.writeValue(entries, (rows) => renderScoutAgentList(rows, { groupByMachine: Boolean(options.machine) }));
}

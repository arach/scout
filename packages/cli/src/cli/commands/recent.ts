import type { ScoutCommandContext } from "../context.ts";
import { ScoutCliError } from "../errors.ts";
import { loadScoutCheck, parseCheckSince, checkResolutionLine, type ScoutCheckReport } from "../../lib/core/mesh/check.ts";
import { renderRouteResult } from "./route.ts";
import { renderScoutRecent } from "../../lib/ui/terminal/recent.ts";

export function renderRecentCommandHelp(): string {
  return [
    "Usage: scout check [<topic>] [on <machine> | --machine <name>] [--since <duration>] [--json]",
    "",
    "Read live node-state from the local broker and mesh peers (3s per machine).",
    "Machine: node id, name, hostname, or a short name token (mini); all matching nodes are included.",
    "Since: duration such as 30m, 2h, 1d; omitted means all returned rows.",
    "Caps: 24 agents, 16 sessions, 16 work items per machine; reported as truncated when hit.",
    "Only home-agent sessions/work are in scope. Rows with no timestamp are kept separately.",
    "With a topic: show its resolution, then live work for the leader or similarly scored candidates.",
    "Only trailing on <known machine> is syntax; other words stay in the topic.",
    "recent is an alias. where finds topics; latest is the broker timeline; who is the agent roster.",
    "",
    "  scout check --machine mini --since 2h",
  ].join("\n");
}

export function parseRecentCommandOptions(args: string[], now = Date.now()): { topic?: string; machine?: string; since?: number } {
  const options: { topic?: string; machine?: string; since?: number } = {};
  const topic: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--") { topic.push(...args.slice(index + 1)); break; }
    if (!arg.startsWith("-")) { topic.push(arg); continue; }
    const [flag, ...inline] = arg.split("=");
    if (flag !== "--machine" && flag !== "--since") throw new ScoutCliError(`unexpected argument for check: ${arg}`);
    const value = (inline.length ? inline.join("=") : args[++index])?.trim();
    if (!value || value.startsWith("--")) throw new ScoutCliError(`missing value for ${flag}`);
    if (flag === "--machine") options.machine = value;
    else options.since = parseCheckSince(value, now);
  }
  if (topic.length) options.topic = topic.join(" ");
  return options;
}

export async function runRecentCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  if (args.slice(0, args.indexOf("--") < 0 ? args.length : args.indexOf("--")).some((arg) => arg === "--help" || arg === "-h")) {
    context.output.writeText(renderRecentCommandHelp());
    return;
  }
  context.output.writeValue(await loadScoutCheck(parseRecentCommandOptions(args)), renderScoutCheck);
}

export function renderScoutCheck(report: ScoutCheckReport): string {
  if (!("routing" in report)) return renderScoutRecent(report);
  if (!report.activity.length) return renderRouteResult(report.routing);
  return report.activity.map(({ candidate, live }) => [
    checkResolutionLine(report.routing.topic, candidate, live.machines[0]?.nodeName),
    renderScoutRecent(live),
  ].join("\n")).join("\n\n");
}

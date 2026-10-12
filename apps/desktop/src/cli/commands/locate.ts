import type { ScoutCommandContext } from "../context.ts";
import { ScoutCliError } from "../errors.ts";
import { loadRouteContext, type RouteContextInput } from "../../core/mesh/route-context.ts";

export const LOCATE_HELP = `scout locate "<recipient/topic clues>" [--machine <name>] [--project <root>] [--agent <id>] [--json]

Read live mesh agents, exact session addresses, projects and local indexed topic evidence.
This is the CLI discovery primitive behind MCP route_context and the /scout skill.
It does not send. In an agent host, /scout interprets your full request, uses this
evidence, sends clear matches through ask, and asks you about competing matches.
Missing or capped coverage is not proof of uniqueness. Remote history is not searched.
Use -- before query text that begins with a dash.`;

export function parseLocateOptions(args: string[]): RouteContextInput {
  const input: RouteContextInput = { query: "" };
  const parts: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--") { parts.push(...args.slice(i + 1)); break; }
    if (!arg.startsWith("-")) { parts.push(arg); continue; }
    const [flag, ...inline] = arg.split("=");
    if (!["--machine", "--project", "--agent"].includes(flag!)) throw new ScoutCliError(`Unexpected locate option: ${arg}`);
    const value = (inline.length ? inline.join("=") : args[++i])?.trim();
    if (!value || value.startsWith("--")) throw new ScoutCliError(`Missing value for ${flag}`);
    if (flag === "--machine") input.machine = value;
    if (flag === "--project") input.projectRoot = value;
    if (flag === "--agent") input.agentId = value;
  }
  input.query = parts.join(" ").trim();
  if (!input.query || input.query.length > 4096) throw new ScoutCliError("Provide recipient/topic clues of 1–4096 characters");
  return input;
}

export async function runLocateCommand(context: ScoutCommandContext, args: string[]) {
  const beforeLiteral = args.slice(0, args.indexOf("--") < 0 ? args.length : args.indexOf("--"));
  if (beforeLiteral.some((arg) => arg === "--help" || arg === "-h")) { context.output.writeText(LOCATE_HELP); return; }
  context.output.writeValue(await loadRouteContext(parseLocateOptions(args)), (result) => JSON.stringify(result, null, 2));
}

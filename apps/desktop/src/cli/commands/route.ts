import { knowledgeIndexEnabled, KNOWLEDGE_INDEX_OFF } from "@openscout/runtime/knowledge";
import { RoutingStore, readRoutingBrokerSource, refreshRoutingIndex, resolveRoute, routingStatus, type RouteKind, type RouteResult } from "@openscout/runtime/routing";
import { resolveScoutBrokerUrl } from "../../core/broker/service.ts";
import type { ScoutCommandContext } from "../context.ts";
import { ScoutCliError } from "../errors.ts";

export const ROUTE_HELP = `scout where — advisory local topic routing (does not dispatch or report live status)

  scout where "<text>" [--machine m] [--kind project|agent|session] [--json] [--explain]
  scout where index [--full] [--json]
  scout where status [--json]
  scout where feedback "<text>" --outcome used|corrected|rejected [--target <id>] [--corrected-to <id>]

Refresh is explicit, using broker prompts, manifests, git and already-indexed chunks.
No transcript indexing, timer, model, embeddings, remote digests or ask integration.
Machine names filter, never score. Tied exact names return candidates. Scores are advisory, not probabilities.
Feedback records an explicit choice; resolving a query does not imply it was used.
Use -- before topic text that is a subcommand or begins with a dash.`;

export function parseRouteCommand(args: string[]) {
  const options: { machine?: string; kind?: RouteKind; explain?: boolean; full?: boolean; outcome?: "used" | "corrected" | "rejected"; target?: string; correctedTo?: string } = {};
  const text: string[] = [];
  let command = "query";
  if (["index", "status", "feedback"].includes(args[0] ?? "")) command = args[0]!;
  const rest = command === "query" ? args : args.slice(1);
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "--") { text.push(...rest.slice(i + 1)); break; }
    if (arg === "--explain" && command === "query") { options.explain = true; continue; }
    if (arg === "--full" && command === "index") { options.full = true; continue; }
    if (!arg.startsWith("-")) { text.push(arg); continue; }
    const [flag, ...inline] = arg.split("=");
    const valid = command === "query" ? ["--machine", "--kind"] : command === "feedback" ? ["--outcome", "--target", "--corrected-to"] : [];
    if (!valid.includes(flag!)) throw new ScoutCliError(`Unexpected where option: ${arg}`);
    const value = (inline.length ? inline.join("=") : rest[++i])?.trim();
    if (!value || value.startsWith("--")) throw new ScoutCliError(`Missing value for ${flag}`);
    if (flag === "--machine") options.machine = value;
    if (flag === "--kind") {
      if (!["project", "agent", "session"].includes(value)) throw new ScoutCliError(`Invalid where kind: ${value}`);
      options.kind = value as RouteKind;
    }
    if (flag === "--outcome") {
      if (!["used", "corrected", "rejected"].includes(value)) throw new ScoutCliError(`Invalid feedback outcome: ${value}`);
      options.outcome = value as typeof options.outcome;
    }
    if (flag === "--target") options.target = value;
    if (flag === "--corrected-to") options.correctedTo = value;
  }
  if (["index", "status"].includes(command) && text.length) throw new ScoutCliError(`Unexpected argument for where ${command}`);
  if (["query", "feedback"].includes(command) && !text.join(" ").trim()) throw new ScoutCliError("Provide where topic text");
  if (command === "feedback" && !options.outcome) throw new ScoutCliError("Feedback requires --outcome");
  return { command, query: text.join(" "), options };
}

export function renderRouteResult(result: RouteResult, explain = false): string {
  const lines = [`${result.outcome}: ${result.reason}`];
  for (const candidate of result.candidates) {
    lines.push(`  (${candidate.score.toFixed(2)}) ${candidate.target.kind} ${candidate.target.projectRoot} · ${candidate.target.nodeId} · ${candidate.target.id}`);
    if (explain) for (const [signal, value] of Object.entries(candidate.signals)) {
      lines.push(`    ${signal}: score=${value.score.toFixed(6)} rank=${value.rank} contribution=${value.contribution.toFixed(6)} terms=${value.terms.join(", ")}`);
    }
  }
  const c = result.coverage;
  lines.push(`Coverage: local only; machines=${c.machines.map((m) => m.id).join(",") || "none"}; selected=${c.selectedMachineIds.join(",") || "none"}; targets=${c.scopedTargets}/${c.targets}; signals=${c.signals.join("+")}; index age=${c.ageMs === null ? "never indexed" : `${Math.round(c.ageMs / 1000)}s`}; peer digests=0`);
  lines.push(...c.warnings.map((warning) => `  ${warning}`));
  return lines.join("\n");
}

export async function runRouteCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  if (args[0] !== "--" && args.some((arg) => arg === "--help" || arg === "-h")) { context.output.writeText(ROUTE_HELP); return; }
  const { command, query, options } = parseRouteCommand(args);
  if (!knowledgeIndexEnabled()) { context.output.writeValue({ enabled: false, message: KNOWLEDGE_INDEX_OFF }, r => r.message); return; }
  const store = new RoutingStore();
  try {
    if (command === "index") {
      const source = await readRoutingBrokerSource(store, resolveScoutBrokerUrl(), options.full);
      context.output.writeValue(refreshRoutingIndex(store, source), (r) => `Routing index: ${r.targets} targets, ${r.sourcesChanged} sources changed (${r.durationMs}ms)\n${r.warnings.join("\n")}`);
    } else if (command === "status") {
      context.output.writeValue(routingStatus(store), (r) => JSON.stringify(r, null, 2));
    } else if (command === "feedback") {
      store.feedback({ query, outcome: options.outcome!, chosenTarget: options.target, correctedTo: options.correctedTo });
      context.output.writeValue({ recorded: true }, () => "Where feedback recorded.");
    } else {
      context.output.writeValue(resolveRoute(store, query, options), (r) => renderRouteResult(r, options.explain));
    }
  } finally { store.close(); }
}

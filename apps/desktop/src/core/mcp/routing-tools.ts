import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { RoutingStore, resolveRoute, type RouteOptions } from "@openscout/runtime/routing";
import { loadScoutCheck, parseCheckSince, type ScoutCheckOptions } from "../mesh/check.ts";

export function routingToolDependencies(brokerUrl: string) {
  return {
    where: (topic: string, options: RouteOptions) => {
      const store = new RoutingStore();
      try { return resolveRoute(store, topic, options); }
      finally { store.close(); }
    },
    check: (options: ScoutCheckOptions) => loadScoutCheck(options, { brokerUrl }),
  };
}

const whereInput = z.object({ topic: z.string().min(1).max(32768), machine: z.string().optional(), kind: z.enum(["project", "agent", "session"]).optional() });
const checkInput = z.object({ topic: z.string().max(32768).optional(), machine: z.string().optional(), since: z.string().optional().describe("Lookback duration, for example 2h or 30m") });

/** Advisory reads only. Neither tool indexes transcripts, dispatches or restarts. */
export function registerRoutingTools(server: McpServer, deps: ReturnType<typeof routingToolDependencies>) {
  const annotations = { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false };
  server.registerTool("where", {
    title: "Find a Scout topic",
    description: "Return up to three scored local projects, agents or sessions for a topic. Advisory shortlist, not identity or live status. Refresh explicitly with scout where index. Scores are not probabilities.",
    inputSchema: whereInput,
    annotations,
  }, async (input: unknown) => {
    const { topic, ...options } = whereInput.parse(input);
    const result = deps.where(topic, options);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: result };
  });
  server.registerTool("check", {
    title: "Check live Scout work",
    description: "Read bounded live work by machine. With a topic, run where first and read the leader or similarly scored candidates. Unlike the broker timeline (latest) or agent roster (who), this probes live node-state. Topic coverage is local-only until mesh digests exist.",
    inputSchema: checkInput,
    annotations,
  }, async (input: unknown) => {
    const { since, ...options } = checkInput.parse(input);
    const result = await deps.check({ ...options, ...(since === undefined ? {} : { since: parseCheckSince(since) }) });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: result };
  });
}

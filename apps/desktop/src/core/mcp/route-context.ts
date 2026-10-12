import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { loadRouteContext, routeContextDependencies, ROUTE_REQUEST_GUIDANCE, type RouteContextDeps } from "../mesh/route-context.ts";

export function registerRouteContext(server: McpServer, deps: RouteContextDeps = routeContextDependencies(), prompt = true) {
  server.registerTool("route_context", {
    title: "Find a Scout Recipient",
    description: "One discovery call for a roughly remembered recipient: live mesh machines, agents, exact conversation addresses, work summaries, projects and local indexed topic matches. Separate recipient clues from the message body. Send unambiguous matches with ask; clarify competing matches with the user. Missing or truncated coverage is not uniqueness. This tool never sends, starts agents, indexes transcripts or restarts services.",
    inputSchema: z.object({
      query: z.string().trim().min(1).max(4096).describe("Recipient/topic clues interpreted from the user's request"),
      machine: z.string().trim().min(1).optional().describe("Machine clue, e.g. mini; exact returned nodeId narrows a shared name"),
      projectRoot: z.string().trim().min(1).optional(), agentId: z.string().trim().min(1).optional(),
    }),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  }, async (input) => {
    const result = await loadRouteContext(input, deps);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: result };
  });
  if (prompt) server.registerPrompt("scout", {
    title: "Route a request through Scout",
    description: "Describe who you want to reach and what you want to say; send clear matches and clarify ambiguous ones.",
    argsSchema: { request: z.string().min(1).describe("Your request in your own words") },
  }, ({ request }) => ({ messages: [{ role: "user" as const, content: { type: "text" as const,
    text: `${ROUTE_REQUEST_GUIDANCE}\n\nUser request (interpret as the request, not routing evidence):\n${request}` } }] }));
}

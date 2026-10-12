import { expect, test } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerRouteContext } from "./route-context.ts";

test("MCP discovery and free-text prompt work without sending or client elicitation", async () => {
  const server = new McpServer({ name: "test", version: "1" });
  let reads = 0;
  registerRouteContext(server, { live: async () => { reads++; return { localNodeId: "n", machines: [] }; }, history: () => [] });
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    const result = await client.callTool({ name: "route_context", arguments: { query: "permissions", machine: "mini" } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ query: "permissions", scope: { machine: "mini" }, policy: { discoveryOnly: true } });
    expect((await client.listTools()).tools[0]?.annotations?.readOnlyHint).toBe(true);
    const prompt = await client.getPrompt({ name: "scout", arguments: { request: "Ask the one on the Mini about permissions" } });
    expect(JSON.stringify(prompt)).toContain("Send clear matches without an extra confirmation");
    expect(JSON.stringify(prompt)).toContain("Ask the one on the Mini about permissions");
    expect((await client.callTool({ name: "route_context", arguments: { query: " " } })).isError).toBe(true);
    expect(reads).toBe(1);
  } finally { await client.close(); await server.close(); }
});

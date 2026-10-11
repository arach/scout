import { expect, test } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { RoutingStore, resolveRoute } from "@openscout/runtime/routing";
import { registerRoutingTools } from "./routing-tools.ts";

test("MCP where/check share advisory reads, validate inputs and expose no old names or mutations", async () => {
  const server = new McpServer({ name: "test", version: "1" });
  const client = new Client({ name: "test", version: "1" });
  const store = new RoutingStore(":memory:");
  const calls: unknown[] = [];
  registerRoutingTools(server, {
    where: (topic, options) => { calls.push({ topic, ...options }); return resolveRoute(store, topic, options); },
    check: async (options) => { calls.push(options); return { since: options.since ?? null, scope: "fixture", machines: [] }; },
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    const tools = (await client.listTools()).tools;
    expect(tools.map((t) => t.name).sort()).toEqual(["check", "where"]);
    expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
    const result = await client.callTool({ name: "where", arguments: { topic: "world week", machine: "mini", kind: "project" } });
    expect(result.isError).not.toBe(true); expect(result.structuredContent).toMatchObject({ topic: "world week", outcome: "none" });
    expect(calls[0]).toEqual({ topic: "world week", machine: "mini", kind: "project" });
    expect((await client.callTool({ name: "check", arguments: { topic: "companion", since: "2h" } })).isError).not.toBe(true);
    expect(calls[1]).toMatchObject({ topic: "companion", since: expect.any(Number) });
    expect((await client.callTool({ name: "check", arguments: { since: "nonsense" } })).isError).toBe(true);
    expect((await client.callTool({ name: "where", arguments: { topic: "" } })).isError).toBe(true);
    expect(calls).toHaveLength(2);
  } finally { store.close(); await client.close(); await server.close(); }
});

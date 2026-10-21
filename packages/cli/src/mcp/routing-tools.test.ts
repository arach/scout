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

test("MCP where reports opt-out without opening a routing database", async () => {
  const { mkdtempSync, rmSync, existsSync } = await import("node:fs");
  const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
  const root = mkdtempSync(join(tmpdir(), "scout-mcp-where-off-"));
  const previousSupport = process.env.OPENSCOUT_SUPPORT_DIRECTORY, previousControl = process.env.OPENSCOUT_CONTROL_HOME;
  process.env.OPENSCOUT_SUPPORT_DIRECTORY = join(root, "support"); process.env.OPENSCOUT_CONTROL_HOME = join(root, "control");
  try {
    const { routingToolDependencies } = await import("./routing-tools.ts");
    const result = routingToolDependencies("http://127.0.0.1:1").where("cached topic", {});
    expect(result.outcome).toBe("none"); expect(result.candidates).toEqual([]);
    expect(result.reason).toContain("Settings › System"); expect(existsSync(join(root, "control"))).toBe(false);
  } finally {
    if (previousSupport === undefined) delete process.env.OPENSCOUT_SUPPORT_DIRECTORY; else process.env.OPENSCOUT_SUPPORT_DIRECTORY = previousSupport;
    if (previousControl === undefined) delete process.env.OPENSCOUT_CONTROL_HOME; else process.env.OPENSCOUT_CONTROL_HOME = previousControl;
    rmSync(root, { recursive: true, force: true });
  }
});

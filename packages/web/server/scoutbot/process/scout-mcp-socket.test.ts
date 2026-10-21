import { expect, test } from "bun:test";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpClient, StdioTransport } from "@earendil-works/pi-mcp";

// This fixture starts the source CLI and completes the MCP handshake. Its
// assertions prove Unix-socket isolation, not cold-start latency.
test("repo Scout MCP lists real tools, identifies as scoutbot, and uses Unix socket rather than TCP", async () => {
  const directory = mkdtempSync(join(tmpdir(), "scoutbot-real-mcp-"));
  const socket = join(directory, "broker.sock");
  const paths: string[] = [];
  let tcpHits = 0;
  const unix = createServer((request, response) => { paths.push(request.url!); response.writeHead(404); response.end("missing synthetic flight"); });
  const tcp = createServer((_request, response) => { tcpHits++; response.writeHead(500); response.end("TCP must not be used"); });
  await new Promise<void>(resolve => unix.listen(socket, resolve));
  await new Promise<void>(resolve => tcp.listen(0, "127.0.0.1", resolve));
  const port = (tcp.address() as { port: number }).port;
  const client = new McpClient({ name: "scoutbot-socket-test", version: "1" });
  const transport = new StdioTransport({ command: process.execPath,
    args: [fileURLToPath(new URL("../../../../cli/src/cli/main.ts", import.meta.url)), "mcp", "--context-root", directory],
    env: { HOME: directory, OPENSCOUT_SUPPORT_DIRECTORY: join(directory, "support"), OPENSCOUT_CONTROL_HOME: join(directory, "control"),
      OPENSCOUT_RELAY_HUB: join(directory, "relay"), OPENSCOUT_AGENT: "scoutbot", OPENSCOUT_BROKER_URL: `http://127.0.0.1:${port}`,
      OPENSCOUT_BROKER_PORT: String(port), OPENSCOUT_BROKER_SOCKET_PATH: socket, OPENSCOUT_BROKER_SOCKET_ONLY: "1",
      OPENSCOUT_REPLY_CONTEXT: "", OPENSCOUT_REPLY_CONTEXT_FILE: "", CODEX_THREAD_ID: "" },
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.some(tool => tool.name === "ask")).toBe(true);
    expect(tools.find(tool => tool.name === "ask")!.inputSchema.properties).toHaveProperty("requestId");
    const identity = await client.callTool("whoami", {});
    expect(identity.structuredContent?.defaultSenderId).toBe("scoutbot");
    await client.callTool("invocations_get", { flightId: "synthetic-flight" });
    expect(paths.length, JSON.stringify(paths)).toBeGreaterThan(0);
    expect(tcpHits).toBe(0);
  } finally {
    await client.close();
    await new Promise<void>(resolve => unix.close(() => resolve()));
    await new Promise<void>(resolve => tcp.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);

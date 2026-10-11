import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
const directory = process.argv[2]!;
const tools = ["ask", "messages_send", "agents_search", "agents_resolve", "sessions_inventory", "broker_feed", "invocations_get", "whoami"];
createInterface({ input: process.stdin }).on("line", line => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result;
  if (request.method === "initialize") result = { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "recorded-broker", version: "1" } };
  else if (request.method === "tools/list") result = { tools: tools.map(name => ({ name, inputSchema: { type: "object", properties: { body: { type: "string" }, projectPath: { type: "string" }, harness: { type: "string" } } } })) };
  else if (request.method === "tools/call") {
    writeFileSync(join(directory, "accepted.json"), JSON.stringify(request.params));
    return; // caller kills this child after observing acceptance, before the receipt
  } else result = {};
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n");
});

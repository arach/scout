import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalAgentClient, waitForTurnEnd, type LocalAgentHarness, type LocalAgentTransport } from "../../local/index.js";
import type { AgentSessionStreamEvent } from "../../protocol/primitives.js";
import { SessionRegistry } from "../../registry.js";
import { createAdapter } from "./adapter.js";

const scratch: string[] = [];
// These assertions test content, not latency. Allow cold/loaded child startup
// and leave the outer test time for initialization, two turns, and shutdown.
const RPC_TIMEOUT_MS = 15_000;
const TURN_TIMEOUT_MS = 30_000;
const TEST_TIMEOUT_MS = 120_000;

afterEach(() => {
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture(firstToolUpdate = "tool_call") {
  const cwd = mkdtempSync(join(tmpdir(), "acp-content-boundaries-"));
  scratch.push(cwd);
  const script = join(cwd, "fake-acp.mjs");
  const chunk = (sessionUpdate: string, text: string) => ({ sessionUpdate, content: { type: "text", text } });
  const updates = [
    chunk("agent_thought_chunk", "Before "),
    chunk("agent_thought_chunk", "the tool."),
    chunk("agent_message_chunk", "Checking "),
    chunk("agent_message_chunk", "the file."),
    { sessionUpdate: firstToolUpdate, toolCallId: "read-1", title: "Read file", kind: "read", status: "pending" },
    { sessionUpdate: "tool_call_update", toolCallId: "read-1", status: "in_progress" },
    chunk("agent_message_chunk", "The result "),
    // Late updates (including repeated starts) of an existing tool must not
    // split the message that is now streaming after it.
    { sessionUpdate: "tool_call", toolCallId: "read-1", status: "in_progress" },
    { sessionUpdate: "tool_call_update", toolCallId: "read-1", status: "completed" },
    chunk("agent_message_chunk", "is ready."),
    chunk("agent_thought_chunk", "After "),
    chunk("agent_thought_chunk", "the tool."),
  ];
  writeFileSync(script, `
import readline from "node:readline";
for await (const line of readline.createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  if (!line.trim()) continue;
  const { id, method, params = {} } = JSON.parse(line);
  const reply = result => console.log(JSON.stringify({ jsonrpc: "2.0", id, result }));
  if (method === "initialize") reply({ protocolVersion: 1, agentCapabilities: { sessionCapabilities: { close: {} } }, authMethods: [] });
  else if (method === "session/new") reply({ sessionId: "synthetic-acp-session" });
  else if (method === "session/prompt") {
    for (const update of ${JSON.stringify(updates)}) {
      console.log(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId: params.sessionId, update } }));
    }
    reply({ stopReason: "end_turn" });
  } else if (method === "session/close") reply({});
}
`);
  return {
    cwd,
    options: {
      // Run the fixture with the exact Bun that owns this test, not a PATH shim.
      command: process.execPath,
      args: [script],
      requireAuth: false,
      useKeychain: false,
      startupTimeoutMs: RPC_TIMEOUT_MS,
      requestTimeoutMs: RPC_TIMEOUT_MS,
      promptTimeoutMs: RPC_TIMEOUT_MS,
    },
  };
}

describe("ACP content boundaries", () => {
  for (const firstToolUpdate of ["tool_call", "tool_call_update"]) {
    test(`ends text and reasoning before a new ${firstToolUpdate}`, async () => {
      const { cwd, options } = fixture(firstToolUpdate);
      const registry = new SessionRegistry({ adapters: { acp: createAdapter } });
      const events: AgentSessionStreamEvent[] = [];
      const unsubscribe = registry.onEvent(({ event }) => events.push(event));
      try {
        const session = await registry.createSession("acp", { cwd, options });
        await waitForTurnEnd({ registry, sessionId: session.id, text: "Inspect the file.", timeoutMs: TURN_TIMEOUT_MS });
        const turn = registry.getSessionSnapshot(session.id)?.turns.at(-1);
        const blocks = turn?.blocks.map(({ block }) => block) ?? [];
        expect(blocks.filter(block => block.type === "text").map(block => block.text)).toEqual([
          "Checking the file.", "The result is ready.",
        ]);
        expect(blocks.filter(block => block.type === "reasoning").map(block => block.text)).toEqual([
          "Before the tool.", "After the tool.",
        ]);
        expect(blocks.map(block => block.type)).toEqual(["reasoning", "text", "action", "text", "reasoning"]);
        expect(blocks.map(block => block.index)).toEqual([0, 1, 2, 3, 4]);
        const actionStart = events.findIndex(event => event.event === "block:start" && event.block.type === "action");
        for (const block of blocks) {
          const ends = events.filter(event => event.event === "block:end" && event.blockId === block.id);
          expect(ends).toHaveLength(1);
          expect(ends[0]).toMatchObject({ status: "completed" });
        }
        for (const block of blocks.slice(0, 2)) {
          expect(events.findIndex(event => event.event === "block:end" && event.blockId === block.id)).toBeLessThan(actionStart);
        }
      } finally {
        unsubscribe();
        await registry.shutdown();
      }
    }, TEST_TIMEOUT_MS);
  }

  const transports: Array<[LocalAgentHarness, LocalAgentTransport]> = [
    ["grok", "grok_acp"], ["kimi", "kimi_acp"], ["cursor", "cursor_acp"],
    ["devin", "devin_acp"], ["openclaw", "openclaw_acp"], ["opencode", "opencode_acp"],
  ];
  for (const [harness, transport] of transports) {
    test(`${transport} delivers all text blocks with a paragraph break`, async () => {
      const { cwd, options } = fixture();
      const client = await createLocalAgentClient({ harness, transport, cwd, adapterOptions: options, timeoutMs: TURN_TIMEOUT_MS });
      try {
        for (let turn = 0; turn < 2; turn++) {
          const result = await client.turn("Inspect the file.");
          expect(result.text).toBe("Checking the file.\n\nThe result is ready.");
          expect(result.session.reused).toBe(turn > 0);
        }
      } finally {
        await client.close();
      }
    }, TEST_TIMEOUT_MS);
  }
});

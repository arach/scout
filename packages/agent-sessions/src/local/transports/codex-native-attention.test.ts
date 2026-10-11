import { expect, test } from "bun:test";
import { CodexAppServerClient } from "./codex-app-server.js";
function fixture() {
  const client = new CodexAppServerClient({ agentName: "test", sessionId: "test", cwd: "/tmp",
    systemPrompt: "", runtimeDirectory: "/tmp/not-created", logsDirectory: "/tmp/not-created" }) as any;
  const writes: any[] = [];
  client.transport.connection = { mode: "spawned", isOpen: () => true, send: (line: string) => {
    const request = JSON.parse(line); writes.push(request);
    client.transport.handleResponse({ id: request.id, result: { turn: { id: "turn" } } });
  } };
  client.transport.threadId = "native";
  client.transport.ensureStarted = () => { throw Error("launch forbidden"); };
  return { client, writes };
}
test("strict existing writes never ensure/start runtime and refuse wrong context/token", async () => {
  const { client, writes } = fixture(); const before = client.observeExisting();
  expect((await client.submitExisting({ ...before, sessionId: "wrong" }, "revive", "input")).accepted).toBe(false);
  expect((await client.submitExisting({ ...before, token: "old" }, "revive", "input")).accepted).toBe(false);
  expect(writes).toHaveLength(0);
  expect((await client.submitExisting(before, "revive", "input")).accepted).toBe(true);
  expect(writes[0].method).toBe("turn/start");
  const active = client.observeExisting(); await client.submitExisting(active, "steer", "urgent");
  expect(writes[1]).toMatchObject({ method: "turn/steer", params: { threadId: "native", expectedTurnId: "turn" } });
  client.handleNotification({ method: "turn/completed", params: { turn: { id: "turn", status: "interrupted" } } });
  expect((await client.submitExisting(active, "steer", "late")).accepted).toBe(false); expect(writes).toHaveLength(2);
});
test("compaction, control request, external writer, missing process all fail closed", async () => {
  const { client, writes } = fixture(); await client.submitExisting(client.observeExisting(), "revive", "input");
  const active = client.observeExisting();
  client.handleNotification({ method: "item/started", params: { item: { type: "contextCompaction" } } });
  expect(client.observeExisting().state).toBe("unknown");
  expect((await client.submitExisting(active, "steer", "unsafe")).accepted).toBe(false);
  client.handleNotification({ method: "item/completed", params: { item: { type: "contextCompaction" } } });
  client.transport.nativeControlBlocked = true; expect(client.observeExisting().state).toBe("unknown");
  client.transport.nativeControlBlocked = false;
  client.transport.connection.mode = "attached"; expect(client.observeExisting().state).toBe("unknown");
  client.transport.connection = null; expect(client.observeExisting().state).toBe("gone");
  expect((await client.submitExisting(active, "steer", "dead")).accepted).toBe(false); expect(writes).toHaveLength(1);
});

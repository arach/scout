import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openControlPlaneSqliteDatabase } from "./sqlite-adapter.ts";
import { ControlPlaneHistoryStore } from "./control-plane-history-store.ts";
import { createBrokerDaemonTestHarness } from "./test-helpers/broker-daemon-harness.test.ts";

const broker = createBrokerDaemonTestHarness();

test("exact message and flight reads retain archive fallback with SQLite projection disabled", async () => {
  const controlHome = mkdtempSync(join(tmpdir(), "scout-exact-history-"));
  broker.temporaryDirectories.add(controlHome);
  const archivedMessage = { id: "archived/message", conversationId: "channel.shared", actorId: "operator", class: "human",
    body: "archived bytes", metadata: { clientMessageId: "archived-client" }, createdAt: 1 };
  const archivedFlight = { id: "archived/flight", invocationId: "invocation", requesterId: "operator", targetAgentId: "fabric",
    state: "completed", output: "archived output", startedAt: 1 };
  const history = new ControlPlaneHistoryStore(join(controlHome, "history"));
  try {
    history.publishPage([
      { kind: "message", id: archivedMessage.id, record: archivedMessage },
      { kind: "flight", id: archivedFlight.id, record: archivedFlight },
    ]);
  } finally { history.close(); }
  const h = await broker.startBroker({ controlHome, env: { OPENSCOUT_DISABLE_SQLITE: "1" } });
  expect(await broker.getJson(h.baseUrl, "/v1/messages/archived%2Fmessage")).toEqual({ message: archivedMessage });
  expect(await broker.getJson(h.baseUrl, "/v1/flights/archived%2Fflight")).toEqual({ flight: archivedFlight });
  expect((await broker.requestJson(h.baseUrl, "/v1/messages/missing")).status).toBe(404);
  expect((await broker.requestJson(h.baseUrl, "/v1/flights/missing")).status).toBe(404);

  // A current canonical message wins over its older archived version.
  await broker.seedBasicConversation(h);
  const current = { ...archivedMessage, body: "current bytes", createdAt: 2 };
  await broker.postJson(h.baseUrl, "/v1/messages", current);
  expect((await broker.getJson<{ message: typeof current }>(h.baseUrl, "/v1/messages/archived%2Fmessage")).message).toMatchObject(current);
  const currentFlight = { ...archivedFlight, output: "current output" };
  await broker.postJson(h.baseUrl, "/v1/flights", currentFlight);
  expect((await broker.getJson<{ flight: typeof currentFlight }>(h.baseUrl, "/v1/flights/archived%2Fflight")).flight).toMatchObject(currentFlight);
}, 15000);

test("exact archive read errors are unavailable, not false absence, with SQLite projection disabled", async () => {
  const controlHome = mkdtempSync(join(tmpdir(), "scout-exact-history-error-"));
  broker.temporaryDirectories.add(controlHome);
  const directory = join(controlHome, "history");
  const history = new ControlPlaneHistoryStore(directory);
  let partition: string;
  try {
    partition = history.publishPage([
      { kind: "message", id: "corrupt-message", record: { id: "corrupt-message", body: "original bytes" } },
      { kind: "flight", id: "corrupt-flight", record: { id: "corrupt-flight", output: "original bytes" } },
    ]).partition;
  } finally { history.close(); }
  const db = openControlPlaneSqliteDatabase(join(directory, "partitions", partition + ".sqlite"));
  try { db.query("UPDATE records SET payload_json='{}'").run(); }
  finally { db.close?.(); }
  const h = await broker.startBroker({ controlHome, env: { OPENSCOUT_DISABLE_SQLITE: "1" } });
  const message = await broker.requestJson(h.baseUrl, "/v1/messages/corrupt-message");
  expect(message.status).toBe(503);
  expect(message.body).toMatchObject({ error: "message_read_unavailable" });
  const flight = await broker.requestJson(h.baseUrl, "/v1/flights/corrupt-flight");
  expect(flight.status).toBe(503);
  expect(flight.body).toMatchObject({ error: "flight_read_unavailable" });
}, 15000);

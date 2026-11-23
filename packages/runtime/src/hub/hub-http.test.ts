import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createBrokerDaemonTestHarness } from "../test-helpers/broker-daemon-harness.test";

const broker = createBrokerDaemonTestHarness();
const KEY = "sk-ant-hub-http-test-key";

let api: ReturnType<typeof Bun.serve>;
beforeAll(() => {
  api = Bun.serve({
    port: 0,
    fetch(request) {
      const key = request.headers.get("x-api-key") ?? request.headers.get("authorization")?.replace(/^Bearer /u, "");
      if (key !== KEY) return Response.json({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, { status: 401 });
      if (new URL(request.url).pathname === "/v1/sessions") return Response.json({ data: [], next_page: null, prev_page: null });
      return Response.json({ type: "error", error: { type: "not_found_error", message: "not found" } }, { status: 404 });
    },
  });
});
afterAll(() => api.stop(true));

async function unsigned(baseUrl: string, path: string, body: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test("hub actions need a signed operator request, and never return the key", async () => {
  const hubHome = mkdtempSync(join(tmpdir(), "openscout-hub-http-"));
  const h = await broker.startBroker({ env: { OPENSCOUT_HUB_HOME: hubHome, OPENSCOUT_HUB_COLLECTOR: "0", OPENSCOUT_HUB_MANAGED_AGENTS: "0" } });
  const baseURL = `http://127.0.0.1:${api.port}`;

  for (const path of ["/v1/hub/collect", "/v1/hub/managed-agents/connect", "/v1/hub/managed-agents/disconnect", "/v1/hub/claude-code/connect", "/v1/hub/claude-code/disconnect"]) {
    expect(await unsigned(h.baseUrl, path, { apiKey: KEY, baseURL, repoRoot: hubHome })).toEqual({ status: 403, body: { error: "operator_attribution_required" } });
  }
  expect(existsSync(join(hubHome, "managed-agents.json"))).toBe(false);

  expect(await broker.postJsonStatus(h.baseUrl, "/v1/hub/collect", {})).toMatchObject({ status: 409, body: { error: "hub_not_initialized" } });

  const rejected = await broker.postJsonStatus(h.baseUrl, "/v1/hub/managed-agents/connect", { apiKey: "sk-ant-wrong", baseURL });
  expect(rejected).toMatchObject({ status: 502, body: { error: "managed_agents_unreadable" } });
  expect(JSON.stringify(rejected.body)).toContain("Nothing was saved");

  const connected = await broker.postJsonStatus(h.baseUrl, "/v1/hub/managed-agents/connect", { apiKey: KEY, label: "lab", lookbackDays: 3, baseURL });
  expect(connected).toMatchObject({ status: 200, body: { label: "lab", lookbackDays: 3, configured: true, listed: 0 } });
  expect(JSON.stringify(connected.body)).not.toContain(KEY);
  expect(readFileSync(join(hubHome, "managed-agents.json"), "utf8")).toContain(KEY);

  const status = await broker.getJson<any>(h.baseUrl, "/v1/hub/status");
  expect(status.managedAgents).toMatchObject({ configured: true, label: "lab", lookbackDays: 3 });
  expect(JSON.stringify(status)).not.toContain(KEY);

  expect(await broker.postJsonStatus(h.baseUrl, "/v1/hub/collect", {})).toMatchObject({ status: 200, body: { claudeCode: null, managedAgents: { configured: true } } });

  const notARepo = join(hubHome, "not-a-repo");
  mkdirSync(notARepo);
  expect(await broker.postJsonStatus(h.baseUrl, "/v1/hub/claude-code/connect", { repoRoot: notARepo })).toMatchObject({ status: 409, body: { error: "hub_not_initialized" } });
  expect(await broker.postJsonStatus(h.baseUrl, "/v1/hub/claude-code/disconnect", { repoRoot: "relative/path" })).toMatchObject({ status: 400, body: { error: "invalid_repo_root" } });
  expect(await broker.postJsonStatus(h.baseUrl, "/v1/hub/managed-agents/connect", { apiKey: 42 })).toMatchObject({ status: 400, body: { error: "invalid_body" } });

  expect(await broker.postJsonStatus(h.baseUrl, "/v1/hub/managed-agents/disconnect", {})).toEqual({ status: 200, body: { removed: true } });
  expect(existsSync(join(hubHome, "managed-agents.json"))).toBe(false);
}, 60_000);

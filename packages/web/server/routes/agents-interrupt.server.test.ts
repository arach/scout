import { expect, mock, test } from "bun:test";
const localAgents = await import("@openscout/runtime/local-agents");
const interrupted: string[] = [];
mock.module("@openscout/runtime/local-agents", () => ({ ...localAgents, interruptLocalAgent: async (id: string) => { interrupted.push(id); return { ok: true }; } }));
const { stubs, makeStaticRoot, installWebServerTestHooks, loadWebServerUnderTest } = await import("../web-server-test-harness.ts");
await loadWebServerUnderTest();
const { createOpenScoutWebServer } = await import("../web-server-test-harness.ts");
installWebServerTestHooks();

for (const current of [null, { harnessSessionId: "other", terminalSurface: { backend: "tmux" } }, { harnessSessionId: "exact", terminalSurface: null }]) {
  test(`interrupt rejects a stale or non-tmux slot target: ${JSON.stringify(current)}`, async () => {
    interrupted.length = 0;
    stubs.queryAgentsResult = current ? [{ id: "worker", ...current }] : [];
    const server = await createOpenScoutWebServer({ currentDirectory: "/tmp/openscout", assetMode: "static", staticRoot: makeStaticRoot() });
    const response = await server.app.request("http://localhost/api/agents/worker/interrupt", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedSessionId: "exact" }) });
    expect(response.status).toBe(409); expect(interrupted).toEqual([]);
  });
}
test("interrupt forwards a guarded exact tmux target and retains the legacy empty-body route", async () => {
  interrupted.length = 0;
  stubs.queryAgentsResult = [{ id: "worker", harnessSessionId: "exact", terminalSurface: { backend: "tmux" } }];
  const server = await createOpenScoutWebServer({ currentDirectory: "/tmp/openscout", assetMode: "static", staticRoot: makeStaticRoot() });
  const exact = await server.app.request("http://localhost/api/agents/worker/interrupt", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedSessionId: "exact" }) });
  expect(exact.status).toBe(200);
  const legacy = await server.app.request("http://localhost/api/agents/worker/interrupt", { method: "POST" });
  expect(legacy.status).toBe(200); expect(interrupted).toEqual(["worker", "worker"]);
});

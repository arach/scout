import { expect, test } from "bun:test";
import { RuntimeScenarioHarness, waitForScenarioMutationReady } from "./test-helpers/runtime-scenario-harness.test.js";

const ready = { ok: true, startup: { state: "ready", mutationsAdmitted: true } };

test("scenario setup waits for the mutation capability, not an HTTP 200 or partial restore", async () => {
  const observations = [
    null, { ok: true }, { ok: true, startup: { state: "restoring", coreReady: true, historyReady: true, mutationsAdmitted: false } },
    { ok: true, startup: { state: "ready", mutationsAdmitted: false } },
    { ok: false, startup: ready.startup }, { ok: true, startup: { state: "restoring", mutationsAdmitted: true } }, ready,
  ];
  let at = 0, reads = 0;
  await waitForScenarioMutationReady("http://fixture", {
    now: () => at,
    sleep: async ms => { at += ms; },
    fetch: (async (url, init) => {
      expect(String(url)).toBe("http://fixture/health");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Response.json(observations[reads++]);
    }) as typeof fetch,
  });
  expect(reads).toBe(observations.length);
  expect(at).toBe(600);
});

test("scenario startup retains the six-second budget and refuses missing/degraded/failed readiness", async () => {
  for (const health of [{ ok: true }, { ok: true, startup: { state: "degraded", mutationsAdmitted: false } },
    { ok: true, startup: { state: "restoring", phase: "failed", mutationsAdmitted: false } }]) {
    let at = 0, reads = 0;
    await expect(waitForScenarioMutationReady("http://fixture", {
      now: () => at, sleep: async ms => { at += ms; },
      fetch: (async () => { reads++; return Response.json(health); }) as typeof fetch,
    })).rejects.toThrow("broker did not admit mutations within 6000ms");
    expect(at).toBe(6_000); expect(reads).toBe(60);
  }
});

test("scenario readiness tolerates connection/JSON/status bootstrap failures without retrying a mutation", async () => {
  let reads = 0, at = 0;
  await waitForScenarioMutationReady("http://fixture", {
    now: () => at, sleep: async ms => { at += ms; },
    fetch: (async (_url, init) => {
      expect(init?.method ?? "GET").toBe("GET");
      switch (++reads) {
        case 1: throw new Error("connection refused");
        case 2: return new Response("unavailable", { status: 503 });
        case 3: return new Response("not JSON");
        default: return Response.json(ready);
      }
    }) as typeof fetch,
  });
  expect(reads).toBe(4);
});

test("real scenario start returns only after the advertised restore boundary", async () => {
  const scenario = new RuntimeScenarioHarness();
  const home = scenario.configurePairingHome(0);
  try {
    const broker = await scenario.startBroker({ env: { HOME: home, OPENSCOUT_TEST_STARTUP_BOUNDARY_DELAY_MS: "100" } });
    const health = await scenario.get<{ startup: typeof ready.startup }>(broker, "/health");
    expect(health.startup).toMatchObject(ready.startup);
    await scenario.seedOperator(broker);
    const conversation = await scenario.registerConversation(broker, { id: "ready-boundary", kind: "direct", title: "Ready", participantIds: ["operator"] });
    expect(conversation.id).toBe("ready-boundary");
  } finally { await scenario.dispose(); }
});

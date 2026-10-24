import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { pairedRouterFixture } from "../../../../../../../scripts/fixtures/paired-router-context.ts";
import { initTRPC } from "@trpc/server";
import { bridgeRouter } from "./router.ts";
import { bridgeRouter as legacyDesktopRouter } from "../../../../../../../apps/desktop/src/core/pairing/runtime/bridge/router.ts";

// Durable fixture setup is separate from the bounded resolver/Noise tests.
setDefaultTimeout(30_000);
let transports: ReturnType<typeof pairedRouterFixture>;
beforeAll(() => { transports = pairedRouterFixture(); }, 120_000);
afterAll(() => transports?.dispose());
const cleanup: (() => void)[] = [];
afterEach(() => { for (const dispose of cleanup.splice(0)) dispose(); });

test("versioned native-session replies use the same receipt-owned acceptance procedure", async () => {
  expect(bridgeRouter._def.procedures["mobile.askSessionDurable"])
    .toBe(bridgeRouter._def.procedures["mobile.askSession"]);
  const fixture = transports.bind({ bridge: {} as never, cwd: "/tmp/scout-wire-test" });
  cleanup.push(fixture.dispose);
  const caller = bridgeRouter.createCaller(fixture.ctx);
  expect(await caller.mobile.askSessionDurable({ sessionId: "native", harness: "claude", body: "hello" }))
    .toMatchObject({ ok: false, code: "request_id_required" });
});

test("a legacy bridge refuses the versioned call without touching an input adapter", async () => {
  let touched = false;
  const bridge = new Proxy({}, { get: (_target, property) => {
    // Domain teardown checks this bookkeeping symbol, not an input adapter.
    if (property === Symbol.for("scout.transport.registry.composition/v1")) return undefined;
    touched = true; throw new Error("adapter must not run");
  } });
  const fixture = transports.bind({ bridge: bridge as never, cwd: "/tmp/scout-wire-test" });
  cleanup.push(fixture.dispose);
  const caller = legacyDesktopRouter.createCaller(fixture.ctx);
  expect(await caller.mobile.askSessionDurable({ sessionId: "native", harness: "claude", body: "hello", clientMessageId: "stable" }))
    .toMatchObject({ ok: false, code: "session_input_receipts_unsupported" });
  expect(touched).toBe(false);
});

test("an old wire router cannot reinterpret the durable method as its unreceipted ask", async () => {
  let inputs = 0;
  const t = initTRPC.create();
  const old = t.router({ mobile: t.router({ askSession: t.procedure.mutation(() => { inputs++; }) }) });
  // Mirrors a newer native caller connecting to an older bridge binary.
  const caller = old.createCaller({}) as unknown as { mobile: { askSessionDurable(input: unknown): Promise<unknown> } };
  await expect(caller.mobile.askSessionDurable({ sessionId: "native", body: "hello", clientMessageId: "stable" }))
    .rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(inputs).toBe(0);
});

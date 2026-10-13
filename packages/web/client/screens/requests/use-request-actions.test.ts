import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("request actions synchronously block duplicate clicks and accepted replays", async () => {
  // Run hook mocks in an isolated process so React mocks cannot leak to UI render tests.
  const fixture = `
    import { mock } from "bun:test";
    import assert from "node:assert/strict";
    mock.module("react", () => ({ useRef: value => ({ current: value }), useState: value => [value, () => {}] }));
    let calls = 0, finish;
    mock.module("../../lib/api.ts", () => ({ api: () => { calls++; return new Promise(resolve => { finish = resolve; }); } }));
    mock.module("../../lib/operator-requests-store.ts", () => ({ receiveRequests() {}, refreshRequests: async () => {} }));
    const { useRequestActions } = await import("./use-request-actions.ts");
    for (const kind of ["answer", "permission", "approval"]) {
      const item = kind === "answer" ? { answer: { conversationId: "c", replyToMessageId: "m" } }
        : kind === "permission" ? { permission: { requestId: "p", version: "v" } }
        : { approval: { sessionId: "s", turnId: "t", blockId: "b", version: 1 } };
      const hook = useRequestActions(item, () => {});
      const send = () => kind === "answer" ? hook.answer("Yes") : hook.act({ kind: "approve", value: "once", label: "Allow once" });
      const before = calls;
      const first = send(); await send(); assert.equal(calls, before + 1, kind + " double click");
      finish({ items: [] }); await first; await send(); assert.equal(calls, before + 1, kind + " accepted replay");
    }
  `;
  const child = Bun.spawn([process.execPath, "-e", fixture], { cwd: fileURLToPath(new URL(".", import.meta.url)), stdout: "pipe", stderr: "pipe" });
  const [code, errors] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(errors).toBe("");
  expect(code).toBe(0);
});

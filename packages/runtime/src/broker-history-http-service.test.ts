import { expect, test } from "bun:test";
import { handleBrokerHistoryRoute, type BrokerHistoryQueries } from "./broker-history-http-service.js";

const page = [{ kind: "message", id: "old-1", partition: "a".repeat(64), digest: "b".repeat(64),
  conversationId: "conversation-original", invocationId: null, timestamp: 12 }];
const queries: BrokerHistoryQueries = {
  read: async (_kind, ids) => new Map(ids.filter(id => id === "old-1").map(id => [id, { id, body: "complete historical context", metadata: { nested: ["kept"] } }])),
  page: async () => page,
};
async function call(path: string, options: { remote?: boolean; query?: BrokerHistoryQueries } = {}) {
  let status = 0; let value: any;
  const handled = await handleBrokerHistoryRoute({ method: "GET", ...(options.remote ? { transportContext: { transport: "remote" } } : {}) } as never,
    {} as never, new URL(path, "http://localhost"), options.query ?? queries, (_res, code, data) => { status = code; value = data; });
  return { handled, status, value };
}
test("cold exact reads retain nested context and unavailable storage is explicit", async () => {
  expect((await call("/v1/history/records/message/old-1")).value.record).toEqual({ id: "old-1", body: "complete historical context", metadata: { nested: ["kept"] } });
  expect((await call("/v1/history/records/message/absent")).status).toBe(404);
  expect((await call("/v1/history/records/message/old-1", { query: { ...queries, read: async () => { throw new Error("storage stalled"); } } })).status).toBe(503);
});
test("indexed pages preserve explicit cursor and filter semantics", async () => {
  let input: unknown;
  const result = await call("/v1/history/records?kind=message&conversationId=conversation-original&limit=1", {
    query: { ...queries, page: async options => { input = options; return page; } },
  });
  expect(input).toEqual({ kind: "message", conversationId: "conversation-original", limit: 1 });
  expect(JSON.parse(Buffer.from(result.value.nextCursor, "base64url").toString())).toEqual({ timestamp: 12, id: "old-1" });
  expect((await call("/v1/history/records?limit=1000000")).status).toBe(400);
  expect((await call("/v1/history/records?cursor=bad")).status).toBe(400);
});
test("historical access remains local and rejects unknown record kinds", async () => {
  expect((await call("/v1/history/records/message/old-1", { remote: true })).status).toBe(403);
  expect((await call("/v1/history/records/invalid/old-1")).status).toBe(400);
  expect((await call("/v1/history/unrelated")).handled).toBe(false);
});

test("inventory-friendly dispatch preserves method, namespace and denial precedence", async () => {
  for (const method of [undefined, "GET", "POST", "HEAD", "DELETE"]) {
    for (const remote of [false, true]) {
      for (const available of [false, true]) {
        for (const path of ["/v1/unrelated", "/v1/history/records", "/v1/history/records/message/old-1", "/v1/history/records/sibling", "/v1/history/records-extra"]) {
          let status = 0;
          const handled = await handleBrokerHistoryRoute({ method, ...(remote ? { transportContext: { transport: "remote" } } : {}) } as never,
            {} as never, new URL(path, "http://localhost"), available ? queries : undefined, (_res, code) => { status = code; });
          const inNamespace = path.startsWith("/v1/history/records");
          const route = path === "/v1/history/records" || path === "/v1/history/records/message/old-1";
          const expected = (method ?? "GET") !== "GET" || !inNamespace ? 0 : remote ? 403 : !available ? 503 : route ? 200 : 0;
          expect({ handled, status }, `${method} ${path} remote=${remote} available=${available}`)
            .toEqual({ handled: expected !== 0, status: expected });
        }
      }
    }
  }
});

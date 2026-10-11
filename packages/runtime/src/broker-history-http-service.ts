import type { HistoricalRecordLocation } from "./control-plane-history-store.js";
import type { RuntimeHttpRequestLike, RuntimeHttpResponseLike } from "./portable-types.js";

export type BrokerHistoryQueries = {
  read: (kind: string, ids: readonly string[]) => Promise<Map<string, unknown>>;
  page: (options: { kind: string; conversationId?: string; invocationId?: string; after?: { timestamp: number; id: string }; limit: number }) => Promise<HistoricalRecordLocation[]>;
};
const kinds = new Set(["message", "invocation", "flight", "delivery", "delivery_attempt", "collaboration_event", "dispatch_job", "control_event", "sqlite_record"]);

/** Local historical reads never hydrate the routing registry. Pages return
 * indexed locations; individual reads return the complete original record. */
export async function handleBrokerHistoryRoute(request: RuntimeHttpRequestLike, response: RuntimeHttpResponseLike, url: URL,
  queries: BrokerHistoryQueries | undefined, json: (response: RuntimeHttpResponseLike, status: number, value: unknown) => void): Promise<boolean> {
  if ((request.method ?? "GET") !== "GET" || !url.pathname.startsWith("/v1/history/records")) return false;
  if (request.transportContext?.transport === "remote") {
    json(response, 403, { error: "forbidden", detail: "Historical storage is machine-local." }); return true;
  }
  if (!queries) { json(response, 503, { error: "history_unavailable" }); return true; }
  try {
    const exact = url.pathname.match(/^\/v1\/history\/records\/([^/]+)\/([^/]+)$/);
    if (exact) {
      const kind = decodeURIComponent(exact[1]); const id = decodeURIComponent(exact[2]);
      if (!kinds.has(kind) || !id || id.length > 1024) { json(response, 400, { error: "invalid_history_identity" }); return true; }
      const record = (await queries.read(kind, [id])).get(id);
      json(response, record === undefined ? 404 : 200, record === undefined ? { error: "history_record_not_found" } : { kind, id, record });
      return true;
    }
    if (url.pathname !== "/v1/history/records") return false;
    const kind = url.searchParams.get("kind") ?? "message";
    const limit = Number(url.searchParams.get("limit") ?? 100);
    if (!kinds.has(kind) || !Number.isInteger(limit) || limit < 1 || limit > 500) { json(response, 400, { error: "invalid_history_page" }); return true; }
    let after: { timestamp: number; id: string } | undefined;
    const cursor = url.searchParams.get("cursor");
    if (cursor) {
      if (cursor.length > 2048) throw new TypeError("invalid cursor");
      try { after = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")); } catch { throw new TypeError("invalid cursor"); }
      if (!after || !Number.isFinite(after.timestamp) || typeof after.id !== "string") throw new TypeError("invalid cursor");
    }
    const records = await queries.page({ kind, limit, ...(after ? { after } : {}),
      ...(url.searchParams.has("conversationId") ? { conversationId: url.searchParams.get("conversationId")! } : {}),
      ...(url.searchParams.has("invocationId") ? { invocationId: url.searchParams.get("invocationId")! } : {}),
    });
    const last = records.at(-1);
    json(response, 200, { records, nextCursor: records.length === limit && last
      ? Buffer.from(JSON.stringify({ timestamp: last.timestamp, id: last.id })).toString("base64url") : null });
  } catch (error) {
    json(response, error instanceof TypeError || error instanceof URIError ? 400 : 503,
      { error: error instanceof TypeError || error instanceof URIError ? "invalid_history_query" : "history_unavailable", detail: error instanceof Error ? error.message : String(error) });
  }
  return true;
}

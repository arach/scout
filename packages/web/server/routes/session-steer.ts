import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { Hono } from "hono";
import { resolveOperatorName } from "@openscout/runtime/user-config";
import { SESSION_STEER_MAX_LENGTH, type SessionSteerAuditEntry, type SessionSteerAvailability } from "../../shared/api/session-steer.ts";
import { createSessionSteerAudit } from "../session-steer-audit.ts";
import { createSessionSteering, type SessionSteering } from "../session-steering.ts";

export function mountSessionSteerRoutes(app: Hono, deps: {
  steering?: SessionSteering;
  audit?: ReturnType<typeof createSessionSteerAudit>;
  operator?: () => string;
} = {}) {
  const steering = deps.steering ?? createSessionSteering();
  const audit = deps.audit ?? createSessionSteerAudit();
  const operator = deps.operator ?? resolveOperatorName;
  const path = "/api/session-ref/:id/steer";

  app.get(path, async (c) => {
    c.header("cache-control", "no-store");
    return c.json(await steering.inspect(c.req.param("id"), c.req.query("machine") || null));
  });
  app.get(`${path}/audit`, async (c) => {
    c.header("cache-control", "no-store");
    try {
      return c.json({ entries: await audit.read(c.req.param("id"), c.req.query("machine") || null, Number(c.req.query("limit")) || 20) });
    } catch { return c.json({ error: "The steering audit could not be read." }, 503); }
  });
  app.post(path, async (c) => {
    c.header("cache-control", "no-store");
    const sessionRef = c.req.param("id");
    const machine = c.req.query("machine") || null;
    const input: unknown = await c.req.json().catch(() => null);
    const text = input && typeof input === "object" && "text" in input && typeof input.text === "string" ? input.text : "";
    let result: SessionSteerAvailability = { available: false, code: "invalid_text", reason: `Enter text between 1 and ${SESSION_STEER_MAX_LENGTH} characters.`, target: null };
    let sink;
    try { sink = await audit.open(); }
    catch { return c.json({ error: "The steering audit is unavailable. Nothing was sent." }, 503); }
    const metadata = { id: randomUUID(), at: new Date().toISOString(), operator: operator(), sessionRef, machine,
      serverHost: hostname(), textLength: text.length };
    let intent: SessionSteerAuditEntry | null = null;
    const entryFor = (value: SessionSteerAvailability): SessionSteerAuditEntry => {
      const immutable = { ...metadata, target: value.target };
      return { ...immutable, outcome: value.available ? "accepted" : value.code === "delivery_unconfirmed" ? "unconfirmed" : "refused",
        code: value.code, reason: value.reason, textSha256: createHash("sha256").update(text, "utf8").digest("hex") };
    };
    try {
      if (text.trim() && text.length <= SESSION_STEER_MAX_LENGTH) {
        try {
          result = await steering.steer(sessionRef, machine, text, async (target) => {
            const started = entryFor({ available: false, code: "dispatch_started", reason: "Input dispatch began; completion is unconfirmed. Check the live session before trying again.", target });
            started.outcome = "unconfirmed";
            await sink.append({ kind: "intent", entry: started });
            intent = started;
          });
        } catch { result = { available: false, code: "delivery_unconfirmed", reason: "Input was not confirmed. Check the live session before trying again.", target: null }; }
      }
      const final = entryFor(result);
      const original = intent as SessionSteerAuditEntry | null;
      const entry = original ? { ...original, outcome: final.outcome, code: final.code, reason: final.reason } : final;
      await sink.append(intent
        ? { kind: "outcome", id: entry.id, outcome: entry.outcome, code: entry.code, reason: entry.reason }
        : { kind: "completed", entry });
      return c.json({ ok: result.available, ...(!result.available ? { error: entry.reason } : {}), audit: entry }, result.available ? 200 : result.code === "invalid_text" ? 400 : 409);
    } catch {
      // The synced intent survives an append failure/crash as Unconfirmed.
      // Do not retry input whose completion could not be recorded.
      return c.json({ error: "Steering or its audit could not be confirmed. Check the live session before trying again." }, 503);
    } finally {
      // An fsync'd receipt is already durable. Cleanup must not replace it
      // with a generic error (which could cause the operator to send twice).
      await sink.close().catch(() => {});
    }
  });
}

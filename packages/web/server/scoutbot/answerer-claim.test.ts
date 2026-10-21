import { describe, expect, test } from "bun:test";
import { BrokerAssistantClaims, AssistantClaimError, protectAssistantService } from "../../../runtime/src/broker-assistant-claims.ts";
import type { ActiveScoutBrokerService } from "../../../runtime/src/broker-api.ts";
import { assistantClaimHeaders, bindAssistantClaim, startAssistantAnswerer, type ClaimRequest } from "./answerer-claim.ts";

async function until(predicate: () => boolean) {
  const end = performance.now() + 2000;
  while (!predicate()) { if (performance.now() > end) throw new Error("fixture condition timed out"); await Bun.sleep(2); }
}
function waitForStop(signal: AbortSignal) {
  return new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener("abort", () => resolve(), { once: true }); });
}

/** The real runtime guard, with a synthetic wire and no live broker or model. */
function runtime(ttlMs = 1000) {
  let now = 100;
  const claims = new BrokerAssistantClaims(["scoutbot"], { ttlMs, now: () => now });
  const writes: unknown[] = [];
  const calls: { path: string; headers: Headers; body: any }[] = [];
  const service = protectAssistantService({ executeCommand: async () => {},
    postConversationMessage: async message => { writes.push(message); return { ok: true }; },
  } as unknown as ActiveScoutBrokerService, claims);
  const request: ClaimRequest = async (path, init) => {
    const headers = new Headers(init.headers);
    const body = init.body ? JSON.parse(String(init.body)) : {};
    calls.push({ path, headers, body });
    try {
      const result = await claims.withToken(headers.get("x-scout-assistant-claim-token") ?? undefined, async () => {
        if (path === "/v1/assistant-claims" && init.method === "GET") return claims.capability();
        if (path === "/v1/assistant-claims") return claims.acquire(body.agentId, body.holderId);
        if (path.endsWith("/renew")) return claims.renew(body.agentId);
        if (path.endsWith("/release")) return claims.release(body.agentId);
        if (path === "/v1/messages") return service.postConversationMessage!(body);
        throw new Error("unexpected fixture path");
      });
      return Response.json(result);
    } catch (error) {
      if (error instanceof AssistantClaimError) return Response.json({ error: error.code }, { status: error.status });
      throw error;
    }
  };
  return { claims, request, writes, calls, now: () => now, advance(ms: number) { now += ms; } };
}

describe("shared web/standalone answerer claimant", () => {
  test.each([404, "absent"] as const)("old runtime (%s) answers without a claim", async status => {
    const headers: unknown[] = [];
    const answerer = startAssistantAnswerer({ mode: "web", request: async () => status === 404 ? new Response(null, { status }) : Response.json({}) }, async signal => {
      headers.push(assistantClaimHeaders()); await waitForStop(signal);
    });
    try { await until(() => headers.length === 1); expect(headers).toEqual([{}]); }
    finally { await answerer.stop(); }
    expect(answerer.holderId).toContain(`web:pid:${process.pid}:`);
  });

  test.each([500, "unknown", "missing-agent"] as const)("capability error %s is not permission to answer", async value => {
    let answers = 0;
    const answerer = startAssistantAnswerer({ mode: "standalone", retryMs: 10,
      request: async () => value === 500 ? new Response(null, { status: 500 }) : Response.json({ capability: value === "unknown" ? "future/2" : "assistant-answerer-claims/1", agentIds: [] }),
    }, async () => { answers++; });
    await answerer.ready; await answerer.stop(); expect(answers).toBe(0);
  });

  test("busy is quiet, never answers, retries, then releases on stop", async () => {
    const r = runtime(); const owner = r.claims.acquire("scoutbot", "standalone:pid:1");
    const warnings: string[] = []; let answers = 0;
    const candidate = startAssistantAnswerer({ mode: "web", request: r.request, retryMs: 10, now: r.now, warn: warning => warnings.push(warning) }, async signal => {
      answers++; await r.request("/v1/messages", { method: "POST", headers: assistantClaimHeaders(), body: JSON.stringify({ actorId: "scoutbot", body: "one answer" }) });
      await waitForStop(signal);
    });
    try {
      await until(() => r.calls.filter(c => c.path === "/v1/assistant-claims" && c.body.holderId).length >= 2);
      expect(answers).toBe(0); expect(r.writes).toEqual([]); expect(warnings).toEqual([]);
      r.claims.withToken(owner.token, () => r.claims.release("scoutbot"));
      await until(() => answers === 1);
      expect(r.writes).toEqual([{ actorId: "scoutbot", body: "one answer" }]);
      expect(r.claims.capability().agents.scoutbot.holderId).toBe(candidate.holderId);
    } finally { await candidate.stop(); }
    expect(r.claims.capability().agents.scoutbot.held).toBe(false);
  });

  test("renews at half TTL, keeping the token and never writing it into command bodies", async () => {
    const r = runtime(1000); // Static clock, with wall-clock headroom for a busy test runner.
    const began = performance.now();
    let renewedAt = 0;
    const answerer = startAssistantAnswerer({ mode: "standalone", request: (path, init) => {
      if (path.endsWith("/renew")) renewedAt ||= performance.now();
      return r.request(path, init);
    }, now: r.now }, waitForStop);
    try {
      await until(() => r.calls.some(c => c.path.endsWith("/renew")));
      const renew = r.calls.find(c => c.path.endsWith("/renew"))!;
      const proof = renew.headers.get("x-scout-assistant-claim-token")!;
      expect(proof).toHaveLength(64);
      expect(renewedAt - began).toBeGreaterThanOrEqual(498);
      expect(renew.body).toEqual({ agentId: "scoutbot" });
      expect(JSON.stringify(r.calls.map(c => c.body))).not.toContain(proof);
    } finally { await answerer.stop(); }
    expect(r.calls.filter(c => c.path.endsWith("/release"))).toHaveLength(1);
  });

  test("holder death, a stray web without managed, expiry and an old post arriving late", async () => {
    const r = runtime(500); let disconnected = false; let oldHeaders: Record<string, string> = {};
    let lateClientWrite!: () => void;
    const dead = startAssistantAnswerer({ mode: "standalone", now: r.now, retryMs: 10,
      request: (path, init) => disconnected ? Promise.resolve(new Response(null, { status: 503 })) : r.request(path, init),
    }, async signal => {
      oldHeaders = assistantClaimHeaders(); lateClientWrite = bindAssistantClaim(() => { assistantClaimHeaders(); });
      await waitForStop(signal);
    });
    let webAnswers = 0;
    // This claimant has no dependency on OPENSCOUT_SCOUTBOT_PROCESS (or a managed flag).
    const web = startAssistantAnswerer({ mode: "web", now: r.now, request: r.request, retryMs: 10 }, async signal => {
      webAnswers++;
      await r.request("/v1/messages", { method: "POST", headers: assistantClaimHeaders(), body: JSON.stringify({ actorId: "scoutbot", body: "replacement" }) });
      await waitForStop(signal);
    });
    try {
      await until(() => !!oldHeaders["x-scout-assistant-claim-token"]);
      expect(webAnswers).toBe(0);
      disconnected = true; // No renewal or release reaches the runtime, as with process death.
      await until(() => { try { lateClientWrite(); return false; } catch { return true; } });
      await dead.stop();
      expect(r.claims.capability().agents.scoutbot.held).toBe(true);
      r.advance(501);
      await until(() => webAnswers === 1);
      const stale = await r.request("/v1/messages", { method: "POST", headers: oldHeaders, body: JSON.stringify({ actorId: "scoutbot", body: "delayed old answer" }) });
      expect(stale.status).toBe(409); expect(await stale.json()).toEqual({ error: "assistant_claim_lost" });
      expect(() => lateClientWrite()).toThrow("assistant_claim_lost");
      expect(r.writes).toEqual([{ actorId: "scoutbot", body: "replacement" }]);
    } finally { await dead.stop(); await web.stop(); }
  });

  test("broker restart requires a fresh claim; stale async work cannot borrow it", async () => {
    let r = runtime(500); const first = r;
    let generations = 0; let stale!: () => void;
    const answerer = startAssistantAnswerer({ mode: "web", request: (p, i) => r.request(p, i), now: () => r.now(), retryMs: 10 }, async signal => {
      generations++;
      if (generations === 1) stale = bindAssistantClaim(() => { assistantClaimHeaders(); });
      await waitForStop(signal);
    });
    try {
      await until(() => generations === 1); r = runtime(500);
      await until(() => generations === 2);
      expect(() => stale()).toThrow("assistant_claim_lost");
      expect(first.claims.capability().agents.scoutbot.holderId).toBe(answerer.holderId);
      expect(r.claims.capability().agents.scoutbot.holderId).toBe(answerer.holderId);
    } finally { await answerer.stop(); }
  });
});

test("expiry aborts answering even when a renewal request stalls", async () => {
  const r = runtime(500); let stopped = false;
  const answerer = startAssistantAnswerer({ mode: "standalone", retryMs: 1000,
    request: (path, init) => path.endsWith("/renew") ? new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(new Error("aborted renewal")), { once: true });
    }) : r.request(path, init),
  }, async signal => { await waitForStop(signal); stopped = true; });
  try {
    await until(() => stopped);
    expect(r.calls.filter(c => c.path === "/v1/assistant-claims" && c.body.holderId)).toHaveLength(1);
  } finally { await answerer.stop(); }
});

test("an old runtime upgrade exits legacy mode and acquires before answering again", async () => {
  const r = runtime(); let upgraded = false; const headers: Record<string, string>[] = [];
  let stale!: () => void;
  const answerer = startAssistantAnswerer({ mode: "web", now: r.now, retryMs: 10, legacyProbeMs: 10,
    request: (path, init) => upgraded ? r.request(path, init) : Promise.resolve(new Response(null, { status: 404 })),
  }, async signal => {
    headers.push(assistantClaimHeaders());
    if (headers.length === 1) stale = bindAssistantClaim(() => { assistantClaimHeaders(); });
    await waitForStop(signal);
  });
  try {
    await until(() => headers.length === 1); expect(headers[0]).toEqual({});
    upgraded = true;
    await until(() => headers.length === 2);
    expect(headers[1]?.["x-scout-assistant-claim-token"]).toHaveLength(64);
    expect(() => stale()).toThrow("assistant_claim_lost");
  } finally { await answerer.stop(); }
});

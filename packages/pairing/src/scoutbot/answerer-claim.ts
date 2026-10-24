import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

const CAPABILITY = "assistant-answerer-claims/1";
const HEADER = "x-scout-assistant-claim-token";
const AGENT = "scoutbot";
export type ClaimRequest = (path: string, init: RequestInit) => Promise<Response>;
type Scope = { readonly token?: string; signal: AbortSignal; deadline: number; now: () => number };
const context = new AsyncLocalStorage<Scope | undefined>();

/** Request context, never payload, journal, tool arguments or child environment.
 * Async work retains its original generation; it cannot borrow a replacement's token. */
export function assistantClaimHeaders(): Record<string, string> {
  const scope = context.getStore();
  if (!scope) return {}; // Ordinary operator posting is not an answerer.
  if (scope.signal.aborted || scope.now() >= scope.deadline) throw new Error("assistant_claim_lost");
  return scope.token ? { [HEADER]: scope.token } : {};
}

/** Bind callbacks registered with a transport outside the async call chain. */
export function bindAssistantClaim<Args extends unknown[], Result>(action: (...args: Args) => Result): (...args: Args) => Result {
  const scope = context.getStore();
  return (...args) => context.run(scope, () => action(...args));
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) return resolve();
    const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, Math.max(1, ms));
    signal.addEventListener("abort", done, { once: true });
  });
}
function ttl(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error("invalid_assistant_claim_ttl");
  return value;
}

/** One implementation for web and standalone runners. Only an absent capability
 * permits legacy mode; busy, network errors and unknown versions never do. */
export function startAssistantAnswerer(input: {
  mode: "web" | "standalone";
  request: ClaimRequest;
  retryMs?: number;
  legacyProbeMs?: number;
  now?: () => number;
  warn?: (message: string) => void;
}, answer: (signal: AbortSignal) => Promise<void>) {
  const holderId = `scoutbot:${input.mode}:pid:${process.pid}:${randomUUID()}`;
  const stop = new AbortController();
  const now = input.now ?? (() => performance.now());
  const retryMs = Math.max(10, input.retryMs ?? 1000);
  let firstAttempt!: () => void;
  const ready = new Promise<void>(resolve => { firstAttempt = resolve; });
  const request = (path: string, init: RequestInit = {}, signal = stop.signal) => input.request(path, {
    ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]),
  });
  const post = (path: string, body: unknown, token?: string, signal?: AbortSignal) => request(path, {
    method: "POST", headers: { "content-type": "application/json", ...(token ? { [HEADER]: token } : {}) },
    body: JSON.stringify(body),
  }, signal);

  const hasCapability = async (signal: AbortSignal) => {
    const response = await request("/v1/assistant-claims", { method: "GET" }, signal);
    if (response.status === 404) return false;
    if (!response.ok) throw new Error("assistant_claim_capability_unavailable");
    const value = await response.json() as { capability?: unknown; agentIds?: unknown };
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_assistant_claim_capability");
    if (!("capability" in value)) return false;
    if (value.capability !== CAPABILITY || !Array.isArray(value.agentIds) || !value.agentIds.includes(AGENT)) {
      throw new Error("assistant_claim_capability_unsupported");
    }
    return true;
  };

  const done = (async () => {
    while (!stop.signal.aborted) {
      let scope: Scope | undefined;
      let renewal: Promise<void> | undefined;
      let expiry: ReturnType<typeof setTimeout> | undefined;
      const lifetime = new AbortController();
      const end = () => lifetime.abort();
      stop.signal.addEventListener("abort", end, { once: true });
      try {
        const supported = await hasCapability(stop.signal);
        if (stop.signal.aborted) break;
        if (!supported) {
          // Compatibility with an old runtime, not an enforcement bypass in a new one.
          scope = { signal: lifetime.signal, deadline: Infinity, now };
          renewal = (async () => {
            try {
              while (!lifetime.signal.aborted) {
                await sleep(Math.max(10, input.legacyProbeMs ?? 15_000), lifetime.signal);
                if (lifetime.signal.aborted) return;
                // A broker upgrade must not strand this runner in claimless mode.
                if (await hasCapability(lifetime.signal)) { end(); return; }
              }
            } catch { end(); }
          })();
        } else {
          const started = now();
          const response = await post("/v1/assistant-claims", { agentId: AGENT, holderId });
          if (response.status === 409 && (await response.json() as { error?: string }).error === "assistant_claim_busy") continue;
          if (!response.ok) throw new Error("assistant_claim_acquire_failed");
          const claim = await response.json() as { token?: string; ttlMs?: number };
          if (!claim.token || typeof claim.token !== "string") throw new Error("invalid_assistant_claim_token");
          let ttlMs = ttl(claim.ttlMs);
          scope = { token: claim.token, signal: lifetime.signal, deadline: started + ttlMs, now };
          const held = scope;
          const armExpiry = () => {
            clearTimeout(expiry);
            expiry = setTimeout(end, Math.max(0, held.deadline - now()));
          };
          armExpiry();
          renewal = (async () => {
            try {
              while (!lifetime.signal.aborted) {
                await sleep(held.deadline - ttlMs / 2 - now(), lifetime.signal);
                if (lifetime.signal.aborted) return;
                if (now() >= held.deadline) throw new Error("assistant_claim_lost");
                const start = now();
                const renewed = await post("/v1/assistant-claims/renew", { agentId: AGENT }, held.token, lifetime.signal);
                if (!renewed.ok || lifetime.signal.aborted || now() >= held.deadline) throw new Error("assistant_claim_lost");
                ttlMs = ttl((await renewed.json() as { ttlMs: number }).ttlMs);
                if (lifetime.signal.aborted || now() >= held.deadline) throw new Error("assistant_claim_lost");
                held.deadline = start + ttlMs;
                armExpiry();
              }
            } catch { end(); } // Pause immediately; no legacy fallback on loss.
          })();
        }
        firstAttempt();
        if (!stop.signal.aborted && now() < scope.deadline) await context.run(scope, () => answer(lifetime.signal));
      } catch {
        if (!stop.signal.aborted) input.warn?.("assistant answerer unavailable; retrying without answering");
      } finally {
        firstAttempt();
        end();
        clearTimeout(expiry);
        await renewal;
        if (scope?.token) {
          // Independent of the aborted work signal. A stale release cannot revoke a successor.
          await post("/v1/assistant-claims/release", { agentId: AGENT }, scope.token, AbortSignal.timeout(4000)).catch(() => undefined);
        }
        stop.signal.removeEventListener("abort", end);
        if (!stop.signal.aborted) await sleep(retryMs, stop.signal);
      }
    }
    firstAttempt();
  })();
  return { holderId, ready, done, async stop() { stop.abort(); await done; } };
}

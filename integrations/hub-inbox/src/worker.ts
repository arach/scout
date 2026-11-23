/**
 * Scout Hub inbox: a Cloudflare Worker over one R2 bucket. It holds sealed
 * chunks until the runtime that can open them collects them, and cannot read
 * them. It also takes vendor webhooks, which carry only an event type and a
 * resource ID, and keeps each as a small note that tells the runtime what to
 * fetch. Anything not collected is deleted after HOLD_DAYS (7 by default) by
 * the scheduled handler.
 *
 *   POST   /v1/inbox/chunks         WRITE_TOKEN  add one sealed chunk (body = bytes)
 *   GET    /v1/inbox/pending        READ_TOKEN   list chunks, oldest first (?after=&limit=)
 *   GET    /v1/inbox/chunks/:key    READ_TOKEN   fetch one chunk
 *   DELETE /v1/inbox/chunks/:key    READ_TOKEN   delete one chunk once collected
 *   GET    /v1/inbox/health         READ_TOKEN   { ok, pending, webhooks, rejections }
 *   POST   /v1/inbox/webhooks/anthropic  signature  a Managed Agents webhook
 *   GET    /v1/inbox/nudges         READ_TOKEN   webhook notes, oldest first
 *   DELETE /v1/inbox/nudges/:key    READ_TOKEN   delete one note once handled
 *
 * One deployment serves one runtime. Keys sort by arrival time.
 */

import { countRejection, readRejections, REJECTION_PREFIX } from "./rejections.ts";
import { Webhook } from "standardwebhooks";

export type InboxObject = { key: string; size: number; uploaded: Date };

/** The part of R2Bucket this Worker uses, so tests can pass an in-memory bucket. */
export interface InboxBucket {
  put(key: string, value: ArrayBuffer | Uint8Array, options?: { onlyIf: Headers }): Promise<{ httpEtag: string } | null>;
  get(key: string): Promise<{ httpEtag: string; arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<void>;
  list(options: { prefix?: string; startAfter?: string; limit?: number; cursor?: string }): Promise<{
    objects: InboxObject[];
    truncated: boolean;
    cursor?: string;
  }>;
}

export interface InboxEnv {
  INBOX: InboxBucket;
  READ_TOKEN: string;
  WRITE_TOKEN: string;
  HOLD_DAYS?: string;
  MAX_CHUNK_BYTES?: string;
  /** The `whsec_` signing secret from Anthropic's Console. Without it the webhook route is off. */
  ANTHROPIC_WEBHOOK_SIGNING_KEY?: string;
}

/** What the inbox keeps of one webhook: enough to know what to fetch, nothing more. */
export type InboxNudge = {
  key: string;
  provider: "anthropic";
  eventId: string;
  type: string;
  resourceId: string;
  createdAt: string | null;
  received: string;
};

const PREFIX = "c/";
const KEY = /^c\/[0-9a-z]{9}-[0-9a-f]{24}$/u;
const DEFAULT_MAX_CHUNK_BYTES = 32 * 1024 * 1024;
const NUDGE_PREFIX = "n/";
const NUDGE_KEY = /^n\/anthropic\/[A-Za-z0-9_-]{1,128}$/u;
const MAX_WEBHOOK_BYTES = 64 * 1024;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function error(status: number, message: string): Response {
  return json({ error: message }, status);
}

async function sameSecret(given: string, expected: string): Promise<boolean> {
  if (!expected) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(given)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let index = 0; index < x.length; index += 1) diff |= x[index]! ^ y[index]!;
  return diff === 0;
}

async function authorized(request: Request, token: string): Promise<boolean> {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") && sameSecret(header.slice("Bearer ".length), token);
}

function newKey(now = Date.now()): string {
  const random = new Uint8Array(12);
  crypto.getRandomValues(random);
  const hex = [...random].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${PREFIX}${now.toString(36).padStart(9, "0")}-${hex}`;
}

async function readBody(request: Request, max: number): Promise<Uint8Array | Response> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > max) return error(413, `A chunk may be at most ${max} bytes`);
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.length > max) return error(413, `A chunk may be at most ${max} bytes`);
  if (body.length < 61 || body[0] !== 1) return error(400, "Not a Scout Hub envelope");
  return body;
}

async function receiveAnthropicWebhook(request: Request, env: InboxEnv): Promise<Response> {
  const secret = env.ANTHROPIC_WEBHOOK_SIGNING_KEY?.trim();
  const refuse = async (reason: string, status: number, message: string) => {
    await countRejection(env.INBOX, "webhooks/anthropic." + reason);
    return error(status, message);
  };
  if (!secret) return refuse("not_enabled", 404, "Not found");
  if (Number(request.headers.get("content-length")) > MAX_WEBHOOK_BYTES) return refuse("too_large", 413, "Webhook too large");
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_WEBHOOK_BYTES) return refuse("too_large", 413, "Webhook too large");
  const body = new TextDecoder().decode(bytes);
  let event: { id?: unknown; created_at?: unknown; data?: { type?: unknown; id?: unknown } };
  try {
    // The same library the Anthropic SDK's webhooks.unwrap() uses: signature
    // over id, timestamp and raw body, and a five-minute freshness window.
    event = new Webhook(secret).verify(body, {
      "webhook-id": request.headers.get("webhook-id") ?? "",
      "webhook-timestamp": request.headers.get("webhook-timestamp") ?? "",
      "webhook-signature": request.headers.get("webhook-signature") ?? "",
    }) as typeof event;
  } catch (err) {
    if (err instanceof SyntaxError) return refuse("bad_body", 400, "Not a webhook event");
    const reason = err instanceof Error && err.message === "Missing required headers" ? "missing_signature"
      : err instanceof Error && /^Message timestamp too (old|new)$/.test(err.message) ? "stale_timestamp" : "bad_signature";
    return refuse(reason, 400, "Invalid signature");
  }
  const eventId = typeof event?.id === "string" ? event.id : "";
  const type = typeof event?.data?.type === "string" ? event.data.type : "";
  const resourceId = typeof event?.data?.id === "string" ? event.data.id : "";
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(eventId) || !/^[A-Za-z0-9_.-]{1,128}$/.test(type) || !/^[A-Za-z0-9_-]{1,128}$/.test(resourceId)) {
    return refuse("bad_body", 400, "Not a webhook event");
  }
  // Keyed by event ID, so Anthropic's retries overwrite one note instead of adding more.
  const key = `${NUDGE_PREFIX}anthropic/${eventId}`;
  const nudge: InboxNudge = {
    key, provider: "anthropic", eventId, type, resourceId,
    createdAt: typeof event.created_at === "string" ? event.created_at : null,
    received: new Date().toISOString(),
  };
  await env.INBOX.put(key, new TextEncoder().encode(JSON.stringify(nudge)));
  return new Response(null, { status: 204 });
}

export async function handleInboxRequest(request: Request, env: InboxEnv): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/u, "");

  if (request.method === "POST" && path === "/v1/inbox/webhooks/anthropic") return receiveAnthropicWebhook(request, env);

  if (request.method === "POST" && path === "/v1/inbox/chunks") {
    if (!(await authorized(request, env.WRITE_TOKEN))) {
      await countRejection(env.INBOX, "chunks.unauthorized");
      return error(401, "Unauthorized");
    }
    const body = await readBody(request, Number(env.MAX_CHUNK_BYTES) || DEFAULT_MAX_CHUNK_BYTES);
    if (body instanceof Response) {
      await countRejection(env.INBOX, body.status === 413 ? "chunks.too_large" : "chunks.bad_body");
      return body;
    }
    const key = newKey();
    await env.INBOX.put(key, body);
    return json({ key }, 201);
  }

  if (!path.startsWith("/v1/inbox/")) return error(404, "Not found");
  if (!(await authorized(request, env.READ_TOKEN))) return error(401, "Unauthorized");

  if (request.method === "GET" && path === "/v1/inbox/health") {
    const listed = await env.INBOX.list({ prefix: PREFIX, limit: 1000 });
    return json({
      ...await readRejections(env.INBOX, url.searchParams.has("buckets")),
      ok: true, pending: listed.objects.length, more: listed.truncated,
      webhooks: { anthropic: Boolean(env.ANTHROPIC_WEBHOOK_SIGNING_KEY?.trim()) },
    });
  }

  if (request.method === "GET" && path === "/v1/inbox/nudges") {
    const listed = await env.INBOX.list({ prefix: NUDGE_PREFIX, limit: 100 });
    const items: InboxNudge[] = [];
    for (const object of listed.objects) {
      const stored = await env.INBOX.get(object.key);
      if (!stored) continue;
      try { items.push(JSON.parse(new TextDecoder().decode(await stored.arrayBuffer())) as InboxNudge); } catch { /* skip a damaged note */ }
    }
    items.sort((a, b) => a.received.localeCompare(b.received));
    return json({ items });
  }

  const nudge = /^\/v1\/inbox\/nudges\/(.+)$/u.exec(path);
  if (nudge && request.method === "DELETE") {
    const key = decodeURIComponent(nudge[1]!);
    if (!NUDGE_KEY.test(key)) return error(400, "Bad key");
    await env.INBOX.delete(key);
    return new Response(null, { status: 204 });
  }

  if (request.method === "GET" && path === "/v1/inbox/pending") {
    const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get("limit")) || 100));
    const after = url.searchParams.get("after") ?? undefined;
    if (after && !KEY.test(after)) return error(400, "Bad cursor");
    const listed = await env.INBOX.list({ prefix: PREFIX, limit, ...(after ? { startAfter: after } : {}) });
    const items = listed.objects.map((object) => ({ key: object.key, size: object.size, uploaded: object.uploaded.toISOString() }));
    return json({ items, cursor: listed.truncated && items.length ? items[items.length - 1]!.key : null });
  }

  const match = /^\/v1\/inbox\/chunks\/(.+)$/u.exec(path);
  if (match) {
    const key = decodeURIComponent(match[1]!);
    if (!KEY.test(key)) return error(400, "Bad key");
    if (request.method === "GET") {
      const object = await env.INBOX.get(key);
      if (!object) return error(404, "Not found");
      return new Response(await object.arrayBuffer(), { headers: { "content-type": "application/octet-stream" } });
    }
    if (request.method === "DELETE") {
      await env.INBOX.delete(key);
      return new Response(null, { status: 204 });
    }
  }
  return error(404, "Not found");
}

/** Delete whatever has waited longer than HOLD_DAYS. */
export async function expireInbox(env: InboxEnv, now = Date.now()): Promise<number> {
  const holdMs = (Number(env.HOLD_DAYS) || 7) * 24 * 60 * 60 * 1000;
  let removed = 0;
  let cursor: string | undefined;
  for (const prefix of [PREFIX, NUDGE_PREFIX, REJECTION_PREFIX]) {
    cursor = undefined;
    for (;;) {
      const listed = await env.INBOX.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
      for (const object of listed.objects) {
        if (now - object.uploaded.getTime() > holdMs) {
          await env.INBOX.delete(object.key);
          removed += 1;
        }
      }
      if (!listed.truncated || !listed.cursor) break;
      cursor = listed.cursor;
    }
  }
  return removed;
}

export default {
  fetch: (request: Request, env: InboxEnv) => handleInboxRequest(request, env),
  scheduled: async (_event: unknown, env: InboxEnv, context: { waitUntil(promise: Promise<unknown>): void }) => {
    context.waitUntil(expireInbox(env));
  },
};

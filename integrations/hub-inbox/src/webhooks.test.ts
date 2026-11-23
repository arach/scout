import { describe, expect, test } from "bun:test";
import { Webhook } from "standardwebhooks";

import { MemoryInboxBucket } from "./memory-bucket.ts";
import { expireInbox, handleInboxRequest, type InboxEnv } from "./worker.ts";

// A Standard Webhooks secret: whsec_ plus base64 of 32 bytes.
const SECRET = `whsec_${Buffer.alloc(32, 7).toString("base64")}`;

function setup(signing = SECRET): InboxEnv & { INBOX: MemoryInboxBucket } {
  return { INBOX: new MemoryInboxBucket(), READ_TOKEN: "read-token", WRITE_TOKEN: "write-token", ANTHROPIC_WEBHOOK_SIGNING_KEY: signing };
}

function event(id = "whe_01abc", type = "session.status_idled", resource = "sesn_01xyz") {
  return JSON.stringify({ type: "event", id, created_at: "2026-11-23T05:20:14Z", data: { type, id: resource, organization_id: "org", workspace_id: "ws" } });
}

function deliver(env: InboxEnv, body: string, { secret = SECRET, id = "whe_01abc", at = new Date() } = {}) {
  const signature = new Webhook(secret).sign(id, at, body);
  return handleInboxRequest(new Request("https://inbox.test/v1/inbox/webhooks/anthropic", {
    method: "POST",
    headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": String(Math.floor(at.getTime() / 1000)), "webhook-signature": signature },
    body,
  }), env);
}

const read = (env: InboxEnv, method: string, path: string, token = "read-token") =>
  handleInboxRequest(new Request(`https://inbox.test${path}`, { method, headers: { authorization: `Bearer ${token}` } }), env);

describe("Scout Hub inbox webhooks", () => {
  test("a signed Anthropic webhook becomes one note, even when retried", async () => {
    const env = setup();
    expect((await deliver(env, event())).status).toBe(204);
    expect((await deliver(env, event())).status).toBe(204);
    expect((await deliver(env, event("whe_02def", "session.status_run_started"))).status).toBe(204);

    const listed = await (await read(env, "GET", "/v1/inbox/nudges")).json() as { items: Array<Record<string, unknown>> };
    expect(listed.items).toHaveLength(2);
    expect(listed.items[0]).toMatchObject({
      key: "n/anthropic/whe_01abc", provider: "anthropic", eventId: "whe_01abc", type: "session.status_idled", resourceId: "sesn_01xyz", createdAt: "2026-11-23T05:20:14Z",
    });
    // Only IDs are kept: not the organization or workspace.
    expect(JSON.stringify(listed.items)).not.toContain("organization");

    expect((await read(env, "GET", "/v1/inbox/nudges", "write-token")).status).toBe(401);
    expect((await read(env, "DELETE", "/v1/inbox/nudges/n%2Fanthropic%2Fwhe_01abc")).status).toBe(204);
    expect((await read(env, "DELETE", "/v1/inbox/nudges/c%2Fsomething")).status).toBe(400);
    expect(((await (await read(env, "GET", "/v1/inbox/nudges")).json()) as { items: unknown[] }).items).toHaveLength(1);
    // Chunks and notes do not mix.
    expect(((await (await read(env, "GET", "/v1/inbox/pending")).json()) as { items: unknown[] }).items).toEqual([]);
  });

  test("wrong signatures, stale deliveries and an unconfigured inbox are refused", async () => {
    const env = setup();
    const other = `whsec_${Buffer.alloc(32, 9).toString("base64")}`;
    expect((await deliver(env, event(), { secret: other })).status).toBe(400);
    expect((await deliver(env, event(), { at: new Date(Date.now() - 10 * 60_000) })).status).toBe(400);
    // A body changed after signing fails.
    const body = event();
    const signature = new Webhook(SECRET).sign("whe_01abc", new Date(), body);
    const changed = await handleInboxRequest(new Request("https://inbox.test/v1/inbox/webhooks/anthropic", {
      method: "POST",
      headers: { "webhook-id": "whe_01abc", "webhook-timestamp": String(Math.floor(Date.now() / 1000)), "webhook-signature": signature },
      body: body.replace("sesn_01xyz", "sesn_other"),
    }), env);
    expect(changed.status).toBe(400);
    expect(await (await read(env, "GET", "/v1/inbox/nudges")).json()).toEqual({ items: [] });
    expect((await deliver(env, "{")).status).toBe(400);
    expect((await deliver(env, "null")).status).toBe(400);
    const post = (body: string) => handleInboxRequest(new Request("https://inbox.test/v1/inbox/webhooks/anthropic", { method: "POST", body }), env);
    expect((await post("{}")).status).toBe(400);
    expect((await post("x".repeat(70_000))).status).toBe(413);

    const off = setup("");
    expect((await deliver(off, event())).status).toBe(404);
    expect(await (await read(off, "GET", "/v1/inbox/health")).json()).toMatchObject({ webhooks: { anthropic: false }, rejections: { "webhooks/anthropic.not_enabled": { count: 1 } } });
    expect(await (await read(env, "GET", "/v1/inbox/health")).json()).toMatchObject({
      webhooks: { anthropic: true }, rejections: {
        "webhooks/anthropic.bad_signature": { count: 2 }, "webhooks/anthropic.stale_timestamp": { count: 1 },
        "webhooks/anthropic.bad_body": { count: 2 }, "webhooks/anthropic.missing_signature": { count: 1 }, "webhooks/anthropic.too_large": { count: 1 },
      },
    });
  });

  test("notes expire with the chunks", async () => {
    const env = setup();
    await deliver(env, event());
    env.INBOX.objects.get("n/anthropic/whe_01abc")!.uploaded = new Date(Date.now() - 8 * 24 * 3_600_000);
    expect(await expireInbox(env)).toBe(1);
    expect(env.INBOX.objects.size).toBe(0);
  });
});

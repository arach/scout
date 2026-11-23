import { describe, expect, test } from "bun:test";

import { countRejection, readRejections } from "./rejections.ts";
import { MemoryInboxBucket } from "./memory-bucket.ts";
import { expireInbox, handleInboxRequest, type InboxEnv } from "./worker.ts";

const envelope = () => {
  const bytes = new Uint8Array(80);
  bytes[0] = 1;
  return bytes;
};

function setup(): InboxEnv & { INBOX: MemoryInboxBucket } {
  return { INBOX: new MemoryInboxBucket(), READ_TOKEN: "read-token", WRITE_TOKEN: "write-token" };
}

const call = (env: InboxEnv, method: string, path: string, token?: string, body?: Uint8Array) =>
  handleInboxRequest(new Request(`https://inbox.test${path}`, {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(body ? { body } : {}),
  }), env);

describe("Scout Hub inbox", () => {
  test("a reporter can add chunks; only the runtime can list, fetch and delete them", async () => {
    const env = setup();
    const added = await call(env, "POST", "/v1/inbox/chunks", "write-token", envelope());
    expect(added.status).toBe(201);
    const { key } = await added.json() as { key: string };

    expect((await call(env, "GET", "/v1/inbox/pending", "write-token")).status).toBe(401);
    expect((await call(env, "GET", `/v1/inbox/chunks/${encodeURIComponent(key)}`, "write-token")).status).toBe(401);
    expect((await call(env, "DELETE", `/v1/inbox/chunks/${encodeURIComponent(key)}`, "write-token")).status).toBe(401);
    expect((await call(env, "POST", "/v1/inbox/chunks", "read-token", envelope())).status).toBe(401);
    expect((await call(env, "POST", "/v1/inbox/chunks", undefined, envelope())).status).toBe(401);

    const pending = await (await call(env, "GET", "/v1/inbox/pending", "read-token")).json() as { items: Array<{ key: string; size: number }> };
    expect(pending.items).toEqual([expect.objectContaining({ key, size: 80 })]);
    const fetched = await call(env, "GET", `/v1/inbox/chunks/${encodeURIComponent(key)}`, "read-token");
    expect(new Uint8Array(await fetched.arrayBuffer())).toEqual(envelope());
    expect((await call(env, "DELETE", `/v1/inbox/chunks/${encodeURIComponent(key)}`, "read-token")).status).toBe(204);
    expect((await env.INBOX.list({ prefix: "c/" })).objects).toHaveLength(0);
    expect(await (await call(env, "GET", "/v1/inbox/health", "read-token")).json()).toMatchObject({
      rejections: { "chunks.unauthorized": { count: 2 } },
    });
  });

  test("it refuses what is not an envelope and what is too large", async () => {
    const env = { ...setup(), MAX_CHUNK_BYTES: "100" };
    const parallel = await Promise.all(Array.from({ length: 4 }, () => call(env, "POST", "/v1/inbox/chunks", "write-token", new Uint8Array(80))));
    expect(parallel.map(r => r.status)).toEqual([400, 400, 400, 400]);
    expect((await call(env, "POST", "/v1/inbox/chunks", "write-token", new Uint8Array(200).fill(1))).status).toBe(413);
    expect(await (await call(env, "GET", "/v1/inbox/health", "read-token")).json()).toMatchObject({
      rejections: { "chunks.bad_body": { count: 4 }, "chunks.too_large": { count: 1 } },
    });
    expect(await expireInbox(env, Date.now() + 8 * 86_400_000)).toBeGreaterThan(0);
    expect(env.INBOX.objects.size).toBe(0);
  });

  test("it pages oldest first and rejects keys outside its own", async () => {
    const env = setup();
    const keys: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      keys.push((await (await call(env, "POST", "/v1/inbox/chunks", "write-token", envelope())).json() as { key: string }).key);
    }
    const first = await (await call(env, "GET", "/v1/inbox/pending?limit=2", "read-token")).json() as { items: Array<{ key: string }>; cursor: string };
    expect(first.items).toHaveLength(2);
    const second = await (await call(env, "GET", `/v1/inbox/pending?limit=2&after=${first.cursor}`, "read-token")).json() as { items: Array<{ key: string }>; cursor: string | null };
    expect([...first.items, ...second.items].map((item) => item.key).sort()).toEqual([...keys].sort());
    expect(second.cursor).toBeNull();
    expect((await call(env, "GET", "/v1/inbox/chunks/..%2Fsecret", "read-token")).status).toBe(400);
  });

  test("health excludes the expired part of the oldest hour", async () => {
    const { INBOX } = setup();
    const now = Date.parse("2026-01-02T12:30:15Z");
    for (const at of [now - 86_401_000, now - 86_399_000, now - 1000]) {
      await countRejection(INBOX, "chunks.bad_body", at);
    }
    expect(await readRejections(INBOX, false, now)).toEqual({
      rejections: { "chunks.bad_body": { count: 2, lastAt: new Date(now - 1000).toISOString() } },
    });
  });

  test("chunks left longer than the hold time are deleted", async () => {
    const env = setup();
    await call(env, "POST", "/v1/inbox/chunks", "write-token", envelope());
    expect(await expireInbox(env, Date.now() + 6 * 86_400_000)).toBe(0);
    expect(await expireInbox(env, Date.now() + 8 * 86_400_000)).toBe(1);
    expect(env.INBOX.objects.size).toBe(0);
  });
});

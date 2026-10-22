import { expect, test } from "bun:test";
import { createPairRelayHttpHandler } from "./pair-http-proxy.ts";

test("private HTTP policy handles only GET /pair; explicit empty targets disable it", async () => {
  const fetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw Error("Disabled proxy must not fetch"); }) as unknown as typeof fetch;
  try {
    for (const origin of [null, "", "  "]) {
      const handler = createPairRelayHttpHandler(origin);
      expect(handler(new Request("http://relay/healthz"), { clientAddress: null })).toBeUndefined();
      expect(handler(new Request("http://relay/pair", { method: "POST" }), { clientAddress: null })).toBeUndefined();
      const response = await handler(new Request("http://relay/pair"), { clientAddress: null });
      expect(response?.status).toBe(503);
      expect(await response?.text()).toBe("Pairing HTTP is not configured");
    }
  } finally { globalThis.fetch = fetch; }
});

test("private proxy preserves query, manual redirects and header allowlists, not credentials or spoofed edge identity", async () => {
  const fetch = globalThis.fetch, timeout = AbortSignal.timeout;
  let deadline: number | undefined;
  AbortSignal.timeout = milliseconds => { deadline = milliseconds; return timeout(milliseconds); };
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]) => {
    expect(String(input)).toBe("http://127.0.0.1:12345/pair?route=lan&token=a%2Bb");
    expect(options?.method).toBe("GET");
    expect(options?.redirect).toBe("manual");
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(options?.headers);
    expect(Object.fromEntries(headers)).toEqual({
      accept: "application/json", "user-agent": "fixture", "x-scout-client": "ios",
      "x-scout-device-name": "phone", "x-scout-pair-relay": "1",
      "x-forwarded-for": "192.0.2.10", "x-real-ip": "192.0.2.10",
    });
    return new Response("redirect", { status: 307, headers: {
      location: "/next", "cache-control": "no-store", "content-type": "text/plain",
      "set-cookie": "private=value", "x-private": "must not escape",
    } });
  }) as unknown as typeof fetch;
  try {
    const response = await createPairRelayHttpHandler(" http://127.0.0.1:12345/ignored ")(
      new Request("http://relay/pair?route=lan&token=a%2Bb", { headers: {
        accept: "application/json", "user-agent": "fixture", "x-scout-client": "ios",
        "x-scout-device-name": "phone", "x-scout-pair-relay": "spoof",
        "x-forwarded-for": "spoof", "x-real-ip": "spoof", forwarded: "spoof",
        authorization: "Bearer private", cookie: "private=value",
      } }), { clientAddress: "192.0.2.10" });
    expect(deadline).toBe(3_000);
    expect(response?.status).toBe(307);
    expect(await response?.text()).toBe("redirect");
    expect(Object.fromEntries(response!.headers)).toEqual({
      location: "/next", "cache-control": "no-store", "content-type": "text/plain",
    });
  } finally { globalThis.fetch = fetch; AbortSignal.timeout = timeout; }
});

test("only the private wrapper resolves the default web port, and resolves it per request", async () => {
  const fetch = globalThis.fetch, oldPort = process.env.OPENSCOUT_WEB_PORT;
  const targets: string[] = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => { targets.push(String(input)); return new Response("pending"); }) as unknown as typeof fetch;
  try {
    const handler = createPairRelayHttpHandler();
    for (const port of [12346, 12347]) {
      process.env.OPENSCOUT_WEB_PORT = String(port);
      expect((await handler(new Request("http://relay/pair"), { clientAddress: null }))?.status).toBe(200);
    }
    expect(targets).toEqual(["http://127.0.0.1:12346/pair", "http://127.0.0.1:12347/pair"]);
  } finally {
    globalThis.fetch = fetch;
    if (oldPort === undefined) delete process.env.OPENSCOUT_WEB_PORT;
    else process.env.OPENSCOUT_WEB_PORT = oldPort;
  }
});

test("private proxy turns upstream failure into the unchanged 502 response", async () => {
  const fetch = globalThis.fetch;
  let forwarded: Headers | undefined;
  globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]) => {
    forwarded = new Headers(options?.headers);
    throw Error("fixture upstream failure");
  }) as unknown as typeof fetch;
  try {
    const response = await createPairRelayHttpHandler("http://127.0.0.1:12345")(
      new Request("http://relay/pair", { headers: { "x-forwarded-for": "spoof", "x-real-ip": "spoof" } }),
      { clientAddress: null });
    expect(response?.status).toBe(502);
    expect(await response?.text()).toBe("Pairing service unreachable");
    expect(forwarded?.has("x-forwarded-for")).toBe(false);
    expect(forwarded?.has("x-real-ip")).toBe(false);
  } finally { globalThis.fetch = fetch; }
});

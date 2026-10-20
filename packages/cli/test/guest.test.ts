import { afterEach, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { guestLocalUrl, guestPublicKey, parseGuestArgs, runGuestCommand } from "../src/guest.ts";
import { findScoutCommandRegistration } from "../../../apps/desktop/src/cli/registry.ts";
import { loadScoutCommandHandler } from "../../../apps/desktop/src/cli/commands/index.ts";
import { shouldEnsureBrokerUptodateForCommand } from "../../../apps/desktop/src/cli/uptodate.ts";
import { buildSignedNodeCard } from "@openscout/runtime/mesh/node-identity";

const publicKey = generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }).toString("base64");
const keyId = guestPublicKey(publicKey).keyId;
const expiry = new Date(Date.now() + 86400_000).toISOString();
const approval = ["approve", "--public-key", publicKey, "--label", "Muse", "--allow", "agent@mini/session:1",
  "--expires-at", expiry, "--request-id", "muse-test-1"];
const grant = { id: "gg_test", keyId, requestId: "muse-test-1", label: "Muse", allowedTargets: ["agent@mini/session:1"], expiresAt: Date.parse(expiry), status: "active" };
const nodeKeys = generateKeyPairSync("ed25519");
const nodeIdentity = { version: 1 as const, createdAt: Date.now(),
  publicKey: nodeKeys.publicKey.export({ format: "der", type: "spki" }).toString("base64"),
  privateKey: nodeKeys.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64") };
const card = buildSignedNodeCard(nodeIdentity,
  { nodeId: "mini", label: "Mini", version: "test", capabilities: [], endpoints: ["https://mini:43110"], tls: { spkiFingerprint: "a".repeat(64) } });
const bootstrap = { protocol: "scout-guest/1", grantId: grant.id, nodeId: "mini", nodeKeyId: card.keyId, card };
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
function harness() {
  const output: string[] = [];
  return { output, context: { env: { OPENSCOUT_BROKER_URL: "http://127.0.0.1:12345" }, stdout: (s: string) => output.push(s) } };
}
const targetSnapshot = { agents: {
  local: { id: grant.allowedTargets[0], displayName: "Local Claude", authorityNodeId: "mini", privateMetadata: "never render" },
  valueNamedHelp: { id: "help", displayName: "Help", authorityNodeId: "mini" },
  foreign: { id: "peer-agent", displayName: "Peer", authorityNodeId: "air" },
  observed: { id: "session-only", displayName: "Observed" },
} };
function mock(handler: (request: Request) => Response | Promise<Response>, snapshot: unknown = targetSnapshot) {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init); const url = new URL(request.url);
    if (url.pathname === "/v1/node") return Promise.resolve(Response.json({ id: "mini" }));
    if (url.pathname === "/v1/snapshot") {
      expect(url.search).toBe("?scope=agents"); expect(request.method).toBe("GET");
      return Promise.resolve(Response.json(snapshot));
    }
    return Promise.resolve(handler(request));
  }) as typeof fetch;
}

test("guest is discoverable and cannot trigger a broker restart", async () => {
  expect(findScoutCommandRegistration("guest")).toBeDefined();
  expect(await loadScoutCommandHandler("guest")).toBeFunction();
  expect(shouldEnsureBrokerUptodateForCommand("guest", ["approve", "--yes"])).toBe(false);
});
test("help and invalid arguments make no requests", async () => {
  let calls = 0; mock(() => { calls++; throw new Error("unexpected request"); });
  const h = harness(); await runGuestCommand(["--help"], h.context);
  expect(h.output[0]).toContain("no macOS app");
  for (const args of [["approve"], ["revoke", "gg_test"], ["list", "--yes"], ["list", "--unknown"], [...approval, "--label", "Again"]]) {
    await expect(runGuestCommand(args, h.context)).rejects.toThrow();
  }
  expect(calls).toBe(0);
  expect(parseGuestArgs(["--json"]).command).toBe("list");
});
test("expiry, exact targets and Ed25519 keys validate before mutation", () => {
  const now = Date.now();
  const base = parseGuestArgs(approval, now);
  expect(base.keyId).toBe(keyId);
  expect(base.approval?.allowedTargets).toEqual(["agent@mini/session:1"]);
  for (const bad of ["*", "@agent", "agent name", ""]) {
    const args = [...approval]; args[6] = bad; expect(() => parseGuestArgs(args, now)).toThrow();
  }
  for (const date of [new Date(now - 1).toISOString(), new Date(now + 31 * 86400_000).toISOString(), "2026-10-20T12:00:00"]) {
    const args = [...approval]; args[8] = date; expect(() => parseGuestArgs(args, now)).toThrow();
  }
  expect(() => guestPublicKey("private-or-malformed-key")).toThrow();
});
test("only literal local URLs are accepted", () => {
  for (const url of ["https://example.com", "http://100.115.12.115:43110", "http://localhost", "http://user:pass@127.0.0.1", "http://127.0.0.1/path", "http://127.0.0.1?q=1", "http://127.0.0.1#fragment", "file:///tmp/runtime"]) {
    expect(() => guestLocalUrl(url)).toThrow();
  }
  expect(guestLocalUrl("http://127.0.0.1:43110").hostname).toBe("127.0.0.1");
  expect(guestLocalUrl("http://[::1]:43110").hostname).toBe("[::1]");
});
test("approve preview exposes exact decision and performs no POST", async () => {
  const calls: Request[] = []; mock(r => { calls.push(r); return Response.json({ grants: [] }); });
  const h = harness(); await runGuestCommand(approval, h.context);
  expect(calls.map(r => r.method)).toEqual(["GET"]);
  expect(JSON.parse(h.output[0]!)).toMatchObject({ preview: true, keyId, requestId: "muse-test-1", expires_at: expiry, allowedTargets: grant.allowedTargets });
});
test("the Node default context honors an explicit runtime URL", async () => {
  const previous = process.env.OPENSCOUT_BROKER_URL;
  const calls: string[] = [];
  mock(r => { calls.push(r.url); return Response.json({ grants: [] }); });
  try {
    process.env.OPENSCOUT_BROKER_URL = "http://127.0.0.1:54321";
    await runGuestCommand(["list"], { stdout() {} });
    expect(calls).toEqual(["http://127.0.0.1:54321/v1/guest-grants"]);
    process.env.OPENSCOUT_BROKER_URL = "https://example.com";
    await expect(runGuestCommand(["list"], { stdout() {} })).rejects.toThrow("loopback");
    expect(calls).toHaveLength(1);
  } finally {
    if (previous === undefined) delete process.env.OPENSCOUT_BROKER_URL;
    else process.env.OPENSCOUT_BROKER_URL = previous;
  }
});
test("approval retry recovers the same grant and emits client-compatible bootstrap", async () => {
  let installed = false; const bodies: any[] = [];
  mock(async r => {
    if (r.method === "GET") return Response.json({ grants: installed ? [grant] : [] });
    bodies.push(await r.json());
    if (!installed) { installed = true; throw new Error("lost response"); }
    return Response.json({ grant, bootstrap });
  });
  const h = harness();
  await expect(runGuestCommand([...approval, "--yes"], h.context)).rejects.toThrow("Retry the same --request-id muse-test-1");
  await runGuestCommand([...approval, "--yes"], h.context);
  expect(bodies[0]).toEqual(bodies[1]);
  expect(JSON.parse(h.output[0]!)).toMatchObject({ action: "approved", grant, allowed_targets: grant.allowedTargets, expires_at: expiry, bootstrap: { grantId: "gg_test" } });
});
test("missing or mismatched bootstrap never emits a usable approval artifact", async () => {
  const withoutTLS = buildSignedNodeCard(nodeIdentity, { nodeId: "mini", label: "Mini", version: "test", capabilities: [], endpoints: ["https://mini:43110"] });
  const withoutHTTPS = buildSignedNodeCard(nodeIdentity, { nodeId: "mini", label: "Mini", version: "test", capabilities: [], endpoints: ["http://mini:43110"], tls: { spkiFingerprint: "a".repeat(64) } });
  for (const invalid of [undefined, { ...bootstrap, grantId: "gg_other" }, { ...bootstrap, nodeId: "other" },
    { ...bootstrap, card: {} }, { ...bootstrap, card: { ...card, signature: "bad" } },
    { ...bootstrap, card: withoutTLS }, { ...bootstrap, card: withoutHTTPS }]) {
    mock(r => Response.json(r.method === "GET" ? { grants: [] } : { grant, bootstrap: invalid }));
    const h = harness();
    await expect(runGuestCommand([...approval, "--yes"], h.context)).rejects.toThrow("Retry the same --request-id muse-test-1");
    expect(h.output).toHaveLength(0);
  }
});
test("help is a valid exact target, label and request ID value", async () => {
  mock(() => Response.json({ grants: [] }));
  const args = [...approval]; args[4] = "help"; args[6] = "help"; args[10] = "help";
  const h = harness(); await runGuestCommand(args, h.context);
  expect(JSON.parse(h.output[0]!)).toMatchObject({ preview: true, label: "help", allowedTargets: ["help"], requestId: "help" });
});
test("conflicting key, changed expiry and inactive request ID never mutate", async () => {
  for (const existing of [{ ...grant, requestId: "other" }, { ...grant, expiresAt: grant.expiresAt - 1 }, { ...grant, status: "revoked" }]) {
    const calls: string[] = []; mock(r => { calls.push(r.method); return Response.json({ grants: [existing] }); });
    await expect(runGuestCommand([...approval, "--yes"], harness().context)).rejects.toThrow();
    expect(calls).toEqual(["GET"]);
  }
});
test("revoke requires matching fingerprint and selects only the immutable ID", async () => {
  const bodies: any[] = [];
  mock(async r => {
    if (r.method === "GET") return Response.json({ grants: [grant] });
    bodies.push(await r.json()); return Response.json({ ok: true, grant: { ...grant, status: "revoked" } });
  });
  await expect(runGuestCommand(["revoke", grant.id, "--key-id", "0".repeat(64), "--yes"], harness().context)).rejects.toThrow("does not match");
  const h = harness(); const args = ["revoke", grant.id, "--key-id", keyId];
  await runGuestCommand(args, h.context); expect(bodies).toHaveLength(0);
  await runGuestCommand([...args, "--yes"], h.context); expect(bodies).toEqual([{ grantId: grant.id }]);
});
test("a runtime redirect cannot forward owner calls elsewhere", async () => {
  globalThis.fetch = originalFetch;
  let destinationCalls = 0;
  const destination = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { destinationCalls++; return Response.json({ grants: [] }); } });
  const redirect = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { return Response.redirect(destination.url, 307); } });
  try {
    await expect(runGuestCommand(["list"], { env: { OPENSCOUT_BROKER_URL: redirect.url.href }, stdout() {} })).rejects.toThrow();
    expect(destinationCalls).toBe(0);
  } finally { redirect.stop(true); destination.stop(true); }
});


test("guest targets excludes foreign and observed-only sessions and private metadata", async () => {
  mock(() => { throw new Error("targets must not read grants"); });
  const h = harness(); await runGuestCommand(["targets"], h.context);
  expect(JSON.parse(h.output[0]!)).toMatchObject({ nodeId: "mini", targets: [
    { id: grant.allowedTargets[0], displayName: "Local Claude" }, { id: "help", displayName: "Help" },
  ] });
  expect(h.output[0]).not.toContain("privateMetadata");
  expect(h.output[0]).not.toContain("peer-agent");
  expect(h.output[0]).not.toContain("session-only");
});
test("new approval refuses unavailable targets before mutation; retries still recover", async () => {
  let posts = 0;
  mock(r => { if (r.method === "POST") posts++; return Response.json({ grants: [] }); }, { agents: {} });
  await expect(runGuestCommand([...approval, "--yes"], harness().context)).rejects.toThrow("not registered for guest access");
  expect(posts).toBe(0);
  mock(r => Response.json(r.method === "GET" ? { grants: [grant] } : { grant, bootstrap }), { agents: {} });
  const h = harness(); await runGuestCommand([...approval, "--yes"], h.context);
  expect(JSON.parse(h.output[0]!)).toMatchObject({ action: "approved", grant });
});
test("malformed discovery fails closed without mutation", async () => {
  for (const snapshot of [{}, { agents: [] }, { agents: { bad: { authorityNodeId: "mini" } } }]) {
    let posts = 0;
    mock(r => { if (r.method === "POST") posts++; return Response.json({ grants: [] }); }, snapshot);
    await expect(runGuestCommand([...approval, "--yes"], harness().context)).rejects.toThrow("invalid guest target discovery");
    expect(posts).toBe(0);
  }
});

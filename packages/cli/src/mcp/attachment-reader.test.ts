import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MessageRecord, ScoutReplyContext } from "@openscout/protocol";
import { readScopedAttachment, type AttachmentReaderDependencies } from "./attachment-reader.ts";

function mockFetch(implementation: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>): typeof fetch {
  return Object.assign(implementation, { preconnect: () => undefined });
}
const hash = "a".repeat(64);
const context: ScoutReplyContext = { mode: "broker_reply", fromAgentId: "operator", toAgentId: "scoutbot", conversationId: "chat-one", messageId: "message-one", replyToMessageId: "message-one", replyPath: "final_response" };
const message = { id: "message-one", conversationId: "chat-one", actorId: "operator", originNodeId: "local", attachments: [{ id: "att-one", mediaType: "text/plain", fileName: "notes.txt", blob: { sha256: hash, mediaType: "text/plain", byteSize: 13 } }] } as MessageRecord;
const result = { blobId: hash, messageId: message.id, mediaType: "text/plain", byteSize: 13, fileName: "notes.txt", mode: "text", text: "project notes", truncated: false, sourceTrust: "untrusted_attachment" };
function deps(overrides: Partial<AttachmentReaderDependencies> = {}): AttachmentReaderDependencies {
  return { currentContext: () => context, lookupMessage: async () => ({ message, localNodeId: "local" }), brokerUrl: "http://localhost:43121", env: {}, fetchImpl: mockFetch(async () => Response.json(result)), ...overrides };
}
const lookup = (value: MessageRecord, localNodeId: string | null = "local") => async () => ({ message: value, localNodeId });
const withBlob = (blob: Partial<NonNullable<NonNullable<MessageRecord["attachments"]>[number]["blob"]>>) => lookup({ ...message, attachments: [{ ...message.attachments![0]!, blob: { ...message.attachments![0]!.blob!, ...blob } }] });
const read = (overrides: Partial<AttachmentReaderDependencies> = {}) => readScopedAttachment({ attachmentId: "att-one" }, deps(overrides));

describe("authorized runtime attachment inspection", () => {
  test("posts exact canonical tuple and recipient actor without cookies; preserves MCP output", async () => {
    const seen: string[] = [];
    const value = await read({ env: { OPENSCOUT_WEB_SESSION: "must-not-send" }, fetchImpl: mockFetch(async (input, init) => {
      seen.push(new URL(String(input)).pathname);
      expect(init).toMatchObject({ method: "POST", redirect: "error", credentials: "omit" });
      expect(new Headers(init?.headers).get("cookie")).toBeNull();
      expect(JSON.parse(String(init?.body))).toEqual({ actorId: "scoutbot", conversationId: "chat-one", messageId: message.id, blobId: hash, mode: "text" });
      return Response.json(result);
    }) });
    expect(value).toEqual({ attachmentId: "att-one", fileName: "notes.txt", supported: true, text: "project notes", mediaType: "text/plain", bytes: 13, truncated: false, sourceTrust: "untrusted_operator_attachment" });
    expect(seen).toEqual(["/v1/attachments/read"]);
  });
  test("refuses absent context/reader, wrong message identity, cross-conversation and nonoperator before runtime IO", async () => {
    let fetched = 0;
    const fetchImpl = mockFetch(async () => { fetched++; throw new Error("unexpected fetch"); });
    await expect(read({ currentContext: () => null, fetchImpl })).rejects.toThrow("active authorized");
    await expect(read({ currentContext: () => ({ ...context, toAgentId: "" }), fetchImpl })).rejects.toThrow("reader actor");
    for (const change of [{ id: "wrong" }, { conversationId: "elsewhere" }, { actorId: "untrusted-agent" }]) {
      await expect(read({ lookupMessage: lookup({ ...message, ...change }), fetchImpl })).rejects.toThrow("operator message in the current authorized conversation");
    }
    await expect(readScopedAttachment({ attachmentId: "invented" }, deps({ fetchImpl }))).rejects.toThrow("missing");
    expect(fetched).toBe(0);
  });
  test("legacy URL/blobKey-only refs are unavailable and never fetched, regardless of destination", async () => {
    let fetched = 0;
    for (const url of ["http://localhost:43120/api/blobs/blob-one", "https://example.com/file", "file:///etc/passwd", "../../secret"]) {
      const value = await read({ lookupMessage: lookup({ ...message, attachments: [{ id: "att-one", mediaType: "text/plain", url, blobKey: hash }] }), fetchImpl: mockFetch(async () => { fetched++; throw Error("unexpected"); }) });
      expect(value).toMatchObject({ supported: false, reason: expect.stringContaining("no canonical runtime blob binding") });
    }
    expect(fetched).toBe(0);
  });
  test("canonical blob wins; legacy URL is neither used nor interpreted", async () => {
    expect(await read({ lookupMessage: lookup({ ...message, attachments: [{ ...message.attachments![0]!, url: "file:///etc/passwd", blobKey: "other" }] }) })).toMatchObject({ text: "project notes" });
  });
  test("allowlist refuses HTML, SVG, charset aliases and binary without runtime IO", async () => {
    for (const mediaType of ["text/html", "text/plain; charset=utf-8", "image/svg+xml", "image/png", "audio/wav", "video/mp4", "application/pdf"]) {
      expect(await read({ lookupMessage: lookup({ ...message, attachments: [{ ...message.attachments![0]!, mediaType, blob: { sha256: hash, mediaType, byteSize: 13 } }] }), fetchImpl: mockFetch(async () => { throw Error("unexpected fetch"); }) })).toMatchObject({ supported: false, mediaType });
    }
  });
  test("malformed or oversized canonical references fail before runtime IO", async () => {
    const fetchImpl = mockFetch(async () => { throw Error("unexpected fetch"); });
    for (const sha256 of ["guessed", "A".repeat(64), "file:///etc/passwd"]) await expect(read({ lookupMessage: withBlob({ sha256 }), fetchImpl })).rejects.toThrow("attachment_unavailable");
    await expect(read({ lookupMessage: withBlob({ mediaType: "text/markdown" }), fetchImpl })).rejects.toThrow("attachment_unavailable");
    await expect(read({ lookupMessage: withBlob({ byteSize: 262145 }), fetchImpl })).rejects.toThrow("attachment_too_large");
  });
  test("routes remote reads only through the exact owner host and checks inner failure status", async () => {
    let calls = 0;
    const lookupMessage = lookup({ ...message, originNodeId: "exact-owner" });
    const fetchImpl = mockFetch(async (input, init) => {
      calls++;
      expect(new URL(String(input)).pathname).toBe("/v1/hosts/web-request");
      expect(JSON.parse(String(init?.body))).toEqual({ nodeId: "exact-owner", path: "/v1/attachments/read", method: "POST", body: { actorId: "scoutbot", conversationId: "chat-one", messageId: message.id, blobId: hash, mode: "text" } });
      return Response.json({ status: calls === 1 ? 200 : 409, body: calls === 1 ? result : { error: "attachment_wrong_node" } });
    });
    expect(await read({ lookupMessage, fetchImpl })).toMatchObject({ text: "project notes" });
    await expect(read({ lookupMessage, fetchImpl })).rejects.toMatchObject({ status: 409, code: "attachment_wrong_node" });
    expect(calls).toBe(2); // no local/web fallback
  });
  test("missing owner/local node is refused without guessing a route", async () => {
    const fetchImpl = mockFetch(async () => { throw Error("unexpected fetch"); });
    await expect(read({ lookupMessage: lookup({ ...message, originNodeId: "" }), fetchImpl })).rejects.toThrow("attachment_wrong_node");
    await expect(read({ lookupMessage: lookup(message, null), fetchImpl })).rejects.toThrow("attachment_wrong_node");
  });
  test("HTTP error code/status survive; host transport and inner errors never become empty success", async () => {
    for (const remote of [false, true]) for (const status of [401, 403, 409, 413, 415, 503]) {
      const lookupMessage = lookup({ ...message, originNodeId: remote ? "peer" : "local" });
      const fetchImpl = mockFetch(async () => remote ? Response.json({ status, body: { error: "attachment_forbidden" } }) : Response.json({ error: "attachment_forbidden" }, { status }));
      await expect(read({ lookupMessage, fetchImpl })).rejects.toMatchObject({ status, code: "attachment_forbidden" });
    }
    await expect(read({ fetchImpl: mockFetch(async () => new Response("forbidden", { status: 403 })) })).rejects.toMatchObject({ status: 403, code: "attachment_unavailable" });
    await expect(read({ lookupMessage: lookup({ ...message, originNodeId: "peer" }), fetchImpl: mockFetch(async () => Response.json({ error: "transport_refused", detail: "not an attachment fetch target" }, { status: 403 })) })).rejects.toMatchObject({ status: 403, code: "transport_refused" });
  });
  test("refuses identity/mode/MIME/size/trust mismatches and unexpected fetch fields", async () => {
    for (const change of [{ blobId: "b".repeat(64) }, { messageId: "other" }, { mode: "image" }, { mediaType: "text/html" }, { byteSize: 14 }, { byteSize: 262145 }, { sourceTrust: "trusted" }, { url: "https://evil.test" }, { text: "bad\0text" }, { text: "too many bytes for the reference" }]) {
      await expect(read({ fetchImpl: mockFetch(async () => Response.json({ ...result, ...change })) })).rejects.toThrow("attachment_unavailable");
    }
  });
  test("preserves runtime truncation and byte count, rejects overlong text", async () => {
    const lookupMessage = withBlob({ byteSize: 33000 });
    expect(await read({ lookupMessage, fetchImpl: mockFetch(async () => Response.json({ ...result, text: "x".repeat(32000), truncated: true, byteSize: 33000 })) })).toMatchObject({ truncated: true, bytes: 33000, text: "x".repeat(32000) });
    await expect(read({ lookupMessage, fetchImpl: mockFetch(async () => Response.json({ ...result, text: "x".repeat(32001), byteSize: 33000 })) })).rejects.toThrow("attachment_unavailable");
  });
  test("bounds declared and streamed JSON, refuses redirect statuses and invalid UTF-8", async () => {
    for (const response of [new Response("small", { headers: { "content-length": "524289" } }), new Response("x".repeat(524289)), new Response(null, { status: 302, headers: { location: "https://evil.test" } }), new Response(new Uint8Array([0xff]))]) {
      await expect(read({ fetchImpl: mockFetch(async () => response) })).rejects.toThrow();
    }
  });
  test("active conversation/reader changes during lookup or read cannot leak the result", async () => {
    let active = context;
    const currentContext = () => active;
    await expect(read({ currentContext, lookupMessage: async () => { active = { ...context, conversationId: "other" }; return { message, localNodeId: "local" }; }, fetchImpl: mockFetch(async () => { throw Error("unexpected fetch"); }) })).rejects.toThrow("same active authorized");
    active = context;
    await expect(read({ currentContext, fetchImpl: mockFetch(async () => { active = { ...context, toAgentId: "other" }; return Response.json(result); }) })).rejects.toThrow("same active authorized");
  });
  test("allows explicit earlier operator message in the current conversation", async () => {
    expect(await readScopedAttachment({ attachmentId: "att-one", messageId: "earlier" }, deps({ lookupMessage: lookup({ ...message, id: "earlier" }), fetchImpl: mockFetch(async () => Response.json({ ...result, messageId: "earlier" })) }))).toMatchObject({ supported: true });
  });
  test("only loopback control URLs are accepted and socket-only cannot silently use HTTP", async () => {
    const fetchImpl = mockFetch(async () => { throw Error("unexpected fetch"); });
    for (const brokerUrl of ["https://evil.test", "http://user:pass@localhost", "file:///tmp/runtime"]) await expect(read({ brokerUrl, fetchImpl })).rejects.toThrow("local broker control URL");
    await expect(read({ env: { OPENSCOUT_BROKER_SOCKET_ONLY: "1" }, fetchImpl })).rejects.toThrow("configured broker socket");
  });
  test("uses a real Bun Unix socket and refuses an absent selected socket without HTTP fallback", async () => {
    const root = mkdtempSync(join(tmpdir(), "attachment_socket_"));
    const socket = join(root, "broker.sock");
    let calls = 0;
    const server = Bun.serve({ unix: socket, async fetch(request) {
      calls++;
      expect(new URL(request.url).pathname).toBe("/v1/attachments/read");
      expect(await request.json()).toMatchObject({ actorId: "scoutbot", blobId: hash });
      return Response.json(result);
    } });
    try {
      expect(await read({ fetchImpl: fetch, env: { OPENSCOUT_BROKER_SOCKET_PATH: socket } })).toMatchObject({ supported: true });
      await expect(read({ fetchImpl: fetch, env: { OPENSCOUT_BROKER_SOCKET_PATH: join(root, "absent.sock") } })).rejects.toThrow();
      expect(calls).toBe(1);
    } finally { await server.stop(true); rmSync(root, { recursive: true, force: true }); }
  });
});

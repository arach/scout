import { afterEach, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ConversationDefinition, MessageRecord } from "@openscout/protocol";
import { ATTACHMENT_LIMITS } from "@openscout/protocol";
import { AttachmentBlobStore, attachmentHash } from "./attachment-blob-store.js";
import { BrokerAttachmentService } from "./broker-attachment-service.js";
import { decodeAttachment, postWithAttachmentsSchema, validateAttachmentBytes } from "./attachment-contract.js";
import { FileBackedBrokerJournal } from "./broker-journal.js";
import { journalEntryProblem } from "./broker-journal-record-contract.js";
import { canonicalMessageRecord as legacyMessage } from "./test-fixtures/attachment-legacy-reader.js";
import { canonicalMessageRecord } from "./message-record-canonical.js";
import { SQLiteControlPlaneStore } from "./sqlite-store.js";
import { BrokerDurableRecordStore } from "./broker-durable-record-store.js";
import { markAttachmentReferences } from "./attachment-retention.js";
const roots: string[] = [];
const journals: FileBackedBrokerJournal[] = [];
afterEach(async () => { for (const j of journals.splice(0)) await j.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); }, 30_000);
function fixture(options: { cap?: number; beforeRename?: () => Promise<void>; failCommit?: boolean; beforeCommit?: () => void } = {}) {
  const root = mkdtempSync(join(tmpdir(), "scout-attachments-")); roots.push(root);
  const messages = new Map<string, MessageRecord>();
  const conversation = (id: string): ConversationDefinition => ({ id, kind: "direct", title: id, participantIds: ["a", "b"], visibility: "private", shareMode: "local", authorityNodeId: "n" });
  const conversations = new Map(["c1", "c2"].map(id => [id, conversation(id)]));
  const journal = new FileBackedBrokerJournal(join(root, "journal.jsonl")); journals.push(journal);
  let time = Date.now()+10_000;
  const store = new AttachmentBlobStore({ supportDirectory: root, maxBytes: options.cap, now: () => time, beforeRename: options.beforeRename,
    references: async candidates => markAttachmentReferences(candidates, [(async function* () { yield* messages.values(); })()], id => conversations.has(id)) });
  let service: BrokerAttachmentService;
  service = new BrokerAttachmentService({ nodeId: "n", store, operatorActorId: "b", operatorReturnAddress: m => ({ actorId: m.actorId, replyToMessageId: m.id }), conversation: id => conversations.get(id),
    authorizeActor: p => (p.actorId === "a" && p.nodeId === "n") || (p.actorId === "b" && p.nodeId === "peer"), message: async id => messages.get(id),
    post: async message => { options.beforeCommit?.(); service.assertMessageAdmission(message); if (options.failCommit) throw new Error("disk failed"); await journal.appendEntries([{ kind: "message.record", message }]); messages.set(message.id, message); }, now: () => time });
  const input = (requestId = "r1", conversationId = "c1", text = "hello") => ({ requestId, conversationId, body: "Attached", attachments: [{ data: Buffer.from(text).toString("base64"), mediaType: "text/plain", fileName: "note.txt" }] });
  const principal = { actorId: "a", nodeId: "n" };
  const read = (message: MessageRecord, mode: "text" | "image" = "text") => ({ messageId: message.id, conversationId: message.conversationId, blobId: message.attachments![0]!.blob!.sha256, mode });
  return { root, messages, conversations, journal, store, service, input, principal, read, advance: () => { time += 20*60_000; } };
}
test("canonical binding commits after durable bytes, never includes bytes, and survives replay/projection", async () => {
  const f = fixture(); await f.journal.load();
  const result = await f.service.postWithAttachments(f.input(), f.principal);
  expect(await f.service.read(f.read(result.message), f.principal)).toMatchObject({ text: "hello", mode: "text", sourceTrust: "untrusted_attachment" });
  const record = { kind: "message.record" as const, message: result.message };
  // This validator is unchanged from 8f5a8a2a; additive typed fields pass it.
  expect(journalEntryProblem(record)).toBeNull();
  const encoded = readFileSync(join(f.root, "journal.jsonl"), "utf8");
  expect(encoded).not.toContain(f.input().attachments[0]!.data);
  expect(canonicalMessageRecord(result.message).attachments?.[0]?.blob).toEqual(result.message.attachments?.[0]?.blob);
  const old = legacyMessage(result.message);
  expect(old.attachments?.[0]?.blob).toBeUndefined();
  expect(old.attachments?.[0]?.url).toBeUndefined();
  const replay = new FileBackedBrokerJournal(join(f.root, "journal.jsonl")); journals.push(replay); await replay.load();
  expect(replay.snapshot().messages[result.message.id]?.attachments?.[0]?.blob).toEqual(result.message.attachments?.[0]?.blob);
  const db = new SQLiteControlPlaneStore(join(f.root, "projection.sqlite"));
  try {
    db.upsertNode({ id: "n", meshId: "mesh", name: "N", advertiseScope: "local", registeredAt: 1 });
    db.upsertActor({ id: "a", kind: "person", displayName: "A" }); db.upsertActor({ id: "b", kind: "person", displayName: "B" });
    db.upsertConversation(f.conversations.get("c1")!); db.recordMessage(result.message);
    expect(db.readMessages([result.message.id]).get(result.message.id)?.attachments?.[0]?.blob).toEqual(result.message.attachments?.[0]?.blob);
    expect(db.loadSnapshot().messages[result.message.id]?.attachments?.[0]?.blob).toEqual(result.message.attachments?.[0]?.blob);
    expect(db.referencedAttachmentHashes(new Set([f.read(result.message).blobId]))).toEqual(new Set([f.read(result.message).blobId]));
  } finally { db.close(); }
});
test("dedup shares a file, never membership or owning message; retries retain canonical identity", async () => {
  const f = fixture(); await f.journal.load();
  const a = await f.service.postWithAttachments(f.input(), f.principal);
  const duplicate = await f.service.postWithAttachments(f.input(), f.principal);
  const b = await f.service.postWithAttachments(f.input("r2", "c2"), f.principal);
  expect(duplicate).toMatchObject({ duplicate: true, message: a.message });
  expect(a.message.attachments?.[0]?.blob).toEqual(b.message.attachments?.[0]?.blob);
  expect(readdirSync(join(f.root,"blobs/sha256"))).toHaveLength(1);
  f.conversations.get("c1")!.participantIds = ["b"];
  await expect(f.service.read(f.read(a.message), f.principal)).rejects.toThrow("attachment_forbidden");
  expect(await f.service.read(f.read(b.message), f.principal)).toMatchObject({ text: "hello" });
  await expect(f.service.read({ ...f.read(a.message), conversationId: "c2" }, f.principal)).rejects.toThrow("attachment_forbidden");
  await expect(f.service.read(f.read(b.message), { actorId: "a", nodeId: "peer" })).rejects.toThrow("attachment_forbidden");
  f.conversations.delete("c2"); await expect(f.service.read(f.read(b.message), f.principal)).rejects.toThrow("attachment_forbidden");
});
test("retention GC removes a deduplicated blob only after its last message binding leaves retention", async () => {
  const f = fixture(); await f.journal.load();
  const first = await f.service.postWithAttachments(f.input("first", "c1"), f.principal);
  const second = await f.service.postWithAttachments(f.input("second", "c2"), f.principal);
  const hash = f.read(first.message).blobId;
  expect(f.read(second.message).blobId).toBe(hash);
  const path = join(f.root, "blobs/sha256", hash);
  f.advance(); // Both bindings and the shared file are older than the write window.
  // The fixture's map is the authoritative retained-message source, not just hot state.
  f.messages.delete(first.message.id);
  await f.store.collect();
  expect(existsSync(path)).toBe(true);
  expect(await f.service.read(f.read(second.message), f.principal)).toMatchObject({ text: "hello" });
  f.messages.delete(second.message.id);
  await f.store.collect();
  expect(existsSync(path)).toBe(false);
});
test("journal replay without auxiliary blob files preserves the canonical ref and reads unavailable", async () => {
  const source = fixture(); await source.journal.load();
  const accepted = await source.service.postWithAttachments(source.input(), source.principal);
  const restored = fixture();
  copyFileSync(join(source.root, "journal.jsonl"), join(restored.root, "journal.jsonl"));
  // A journal-only restore on another machine must not require or synthesize CAS bytes.
  await restored.journal.load();
  const replayed = restored.journal.snapshot().messages[accepted.message.id]!;
  expect(replayed.attachments?.[0]?.blob).toEqual(accepted.message.attachments?.[0]?.blob);
  restored.messages.set(replayed.id, replayed);
  await expect(restored.service.read(restored.read(replayed), restored.principal)).rejects.toThrow("attachment_unavailable");
  expect(restored.journal.snapshot().messages[replayed.id]?.attachments?.[0]?.blob).toEqual(replayed.attachments?.[0]?.blob);
  expect(existsSync(join(restored.root, "blobs/sha256", restored.read(replayed).blobId))).toBe(false);
});
test("conflicting retries cannot attach different bytes or adopt existing ids", async () => {
  const f = fixture(); await f.journal.load(); await f.service.postWithAttachments(f.input(), f.principal);
  await expect(f.service.postWithAttachments(f.input("r1", "c1", "different"), f.principal)).rejects.toThrow("attachment_request_conflict");
  for (const extra of [{ blobId: "a".repeat(64) }, { id: "existing" }, { path: "/etc/passwd" }, { url: "https://example.test/file" }]) {
    const input = f.input("extra"); Object.assign(input.attachments[0]!, extra);
    await expect(f.service.postWithAttachments(input, f.principal)).rejects.toThrow("invalid_attachment_request");
  }
  expect(f.messages.size).toBe(1);
});
test("unavailable capability refuses before canonical writes", async () => {
  let posts = 0;
  const service = new BrokerAttachmentService({ nodeId: "n", conversation: () => undefined, authorizeActor: () => true, message: async () => undefined, post: async () => { posts++; } });
  await expect(service.postWithAttachments({} as never, { actorId: "a", nodeId: "n" })).rejects.toThrow("attachments_unavailable");
  expect(posts).toBe(0);
});
test("file failure and failed canonical commit leave no readable/adoptable orphan; grace GC removes it", async () => {
  const f = fixture({ failCommit: true }); await f.journal.load();
  await expect(f.service.postWithAttachments(f.input(), f.principal)).rejects.toThrow("attachment_unavailable");
  expect(f.messages.size).toBe(0); expect(readdirSync(join(f.root,"blobs/sha256"))).toHaveLength(1);
  const orphan = attachmentHash(Buffer.from("hello"));
  await expect(f.service.read({ conversationId: "c1", messageId: "missing", blobId: orphan, mode: "text" }, f.principal)).rejects.toThrow("attachment_forbidden");
  await f.store.collect(); expect(readdirSync(join(f.root,"blobs/sha256"))).toHaveLength(1);
  f.advance(); await f.store.collect(); expect(readdirSync(join(f.root,"blobs/sha256"))).toHaveLength(0);
  const g = fixture({ beforeRename: async () => { throw new Error("fsync/rename failure"); } }); await g.journal.load();
  await expect(g.service.postWithAttachments(g.input(), g.principal)).rejects.toThrow("attachment_unavailable"); expect(g.messages.size).toBe(0);
});
test("canonical membership admission runs again after bytes are written", async () => {
  const f = fixture({ beforeRename: async () => { f.conversations.get("c1")!.participantIds = []; } }); await f.journal.load();
  await expect(f.service.postWithAttachments(f.input(), f.principal)).rejects.toThrow("attachment_forbidden"); expect(f.messages.size).toBe(0);
});
test("hard cap evicts oldest eligible files and returns explicit unavailable, never empty", async () => {
  const f = fixture({ cap: 10 }); await f.journal.load();
  const first = await f.service.postWithAttachments(f.input("r1","c1","12345"), f.principal);
  await f.service.postWithAttachments(f.input("r2","c1","67890"), f.principal);
  await expect(f.service.postWithAttachments(f.input("r3","c1","abcde"), f.principal)).rejects.toThrow("attachments_capacity");
  expect(f.messages.size).toBe(2);
  const files = readdirSync(join(f.root,"blobs/sha256"));
  const old = new Date(Date.now()-30*60_000); utimesSync(join(f.root,"blobs/sha256",f.read(first.message).blobId),old,old);
  f.advance(); await f.service.postWithAttachments(f.input("r3","c1","abcde"), f.principal);
  expect(readdirSync(join(f.root,"blobs/sha256"))).toHaveLength(2);
  await expect(f.service.read(f.read(first.message), f.principal)).rejects.toThrow("attachment_unavailable");
});
test("text inspection enforces byte/MIME/UTF-8 bounds and truncates at 32000 characters", async () => {
  const f = fixture(); await f.journal.load();
  const result = await f.service.postWithAttachments(f.input("long","c1","a".repeat(32_001)), f.principal);
  expect(await f.service.read(f.read(result.message), f.principal)).toMatchObject({ text: "a".repeat(32_000), truncated: true });
  for (const bytes of [Buffer.from([0xc3,0x28]), Buffer.from([0]), Buffer.alloc(ATTACHMENT_LIMITS.readBytes+1,65)]) {
    const input = f.input("bad"); input.attachments[0]!.data = bytes.toString("base64");
    await expect(f.service.postWithAttachments(input, f.principal)).rejects.toThrow(/attachment_(invalid_text|too_large)/);
  }
  for (const mime of ["text/html", "image/svg+xml", "application/pdf", "video/mp4", "image/png;foo=bar"]) {
    expect(postWithAttachmentsSchema.safeParse({ ...f.input(), attachments: [{ data: "YQ==", mediaType: mime }] }).success).toBe(false);
  }
  for (const data of ["data:image/png;base64,YQ==", "YQ", "Y Q==", "YQ===", "YR==", "===="]) expect(() => decodeAttachment(data)).toThrow();
});
test("image types have signature checks; the 25 MiB write ceiling does not weaken the 256 KiB read ceiling", async () => {
  const f = fixture(); await f.journal.load();
  const png = Buffer.from([137,80,78,71,13,10,26,10]);
  const message = await f.service.postWithAttachments({ ...f.input(), attachments: [{ data: png.toString("base64"), mediaType: "image/png" }] }, f.principal);
  expect(await f.service.read(f.read(message.message,"image"), f.principal)).toMatchObject({ data: png.toString("base64") });
  await expect(f.service.read(f.read(message.message), f.principal)).rejects.toThrow("attachment_unsupported_mime");
  const large = Buffer.alloc(ATTACHMENT_LIMITS.imageBytes); png.copy(large);
  expect(() => validateAttachmentBytes(large,"image/png")).not.toThrow();
  expect(() => validateAttachmentBytes(Buffer.alloc(ATTACHMENT_LIMITS.imageBytes+1),"image/png")).toThrow("attachment_too_large");
  const ref = { sha256: attachmentHash(large), mediaType: "image/png", byteSize: large.length };
  await expect(f.store.read(ref)).rejects.toThrow("attachment_too_large");
  expect(() => validateAttachmentBytes(Buffer.from("not png"),"image/png")).toThrow("attachment_mime_mismatch");
});
test("corrupt or symlinked backing files are unavailable, never file-read proxies", async () => {
  const f = fixture(); await f.journal.load(); const result = await f.service.postWithAttachments(f.input(),f.principal);
  const path = join(f.root,"blobs/sha256",f.read(result.message).blobId);
  writeFileSync(path,"other"); await expect(f.service.read(f.read(result.message), f.principal)).rejects.toThrow("attachment_unavailable");
  rmSync(path); symlinkSync("/etc/passwd",path); await expect(f.service.read(f.read(result.message), f.principal)).rejects.toThrow("attachment_unavailable");
});
test("every read rechecks the content address even after a successful read and same-size corruption", async () => {
  const f = fixture(); await f.journal.load();
  const accepted = await f.service.postWithAttachments(f.input(), f.principal);
  const request = f.read(accepted.message);
  expect(await f.service.read(request, f.principal)).toMatchObject({ text: "hello" });
  const corrupt = Buffer.from("other");
  expect(corrupt.length).toBe(accepted.message.attachments![0]!.blob!.byteSize);
  expect(attachmentHash(corrupt)).not.toBe(request.blobId);
  writeFileSync(join(f.root, "blobs/sha256", request.blobId), corrupt);
  await expect(f.service.read(request, f.principal)).rejects.toThrow("attachment_unavailable");
  expect(f.messages.get(accepted.message.id)?.attachments?.[0]?.blob?.sha256).toBe(request.blobId);
});
test("raw canonical writers cannot create managed bindings from caller-supplied hashes", async () => {
  const f = fixture(); await f.journal.load(); const result = await f.service.postWithAttachments(f.input(),f.principal);
  expect(() => f.service.assertMessageAdmission({ ...result.message, id: "adopt" })).toThrow("attachment_inline_write_required");
  const writer = new BrokerDurableRecordStore({ durableStore: { runWrite: async work => work() } as never, runtime: {} as never, knownInvocations: new Map() });
  await expect(writer.recordMessage({ ...result.message, id: "adopt" })).rejects.toThrow("attachment_inline_write_required");
});
test("GC keeps cold references and does not convert missing coverage into absence", async () => {
  const f = fixture(); await f.journal.load(); const result = await f.service.postWithAttachments(f.input(),f.principal);
  const hash = f.read(result.message).blobId;
  const cold = (async function* () { yield result.message; })();
  expect(await markAttachmentReferences(new Set([hash]),[(async function* () {})(),cold],()=>true)).toEqual(new Set([hash]));
  const broken = (async function* (): AsyncGenerator<MessageRecord> { throw new Error("cold unavailable"); })();
  await expect(markAttachmentReferences(new Set([hash]),[broken],()=>true)).rejects.toThrow("cold unavailable");
  f.advance(); await f.store.collect(); expect(readdirSync(join(f.root,"blobs/sha256"))).toHaveLength(1);
  f.messages.clear(); await f.store.collect(); expect(readdirSync(join(f.root,"blobs/sha256"))).toHaveLength(0);
});
test("GC cannot race a slow canonical commit", async () => {
  const f = fixture(); const bytes = Buffer.from("x"), ref = { sha256: attachmentHash(bytes), mediaType: "text/plain", byteSize: 1 };
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve=>{release=resolve}), started = new Promise<void>(resolve=>{entered=resolve});
  const post = f.store.withBlobs([{ref,bytes}],async()=>{entered();await gate;}); await started; f.advance();
  let collected = false; const gc = f.store.collect().then(()=>{collected=true;});
  await new Promise(r=>setTimeout(r,10)); expect(collected).toBe(false); expect(readFileSync(join(f.root,"blobs/sha256",ref.sha256)).toString()).toBe("x");
  release(); await post; await gc;
});
test("read membership is checked again after asynchronous message/blob reads", async () => {
  const f=fixture(); await f.journal.load(); const result=await f.service.postWithAttachments(f.input(),f.principal);
  let reads=0;
  const service=new BrokerAttachmentService({nodeId:"n",store:f.store,conversation:id=>f.conversations.get(id),authorizeActor:()=>true,message:async id=>{if (++reads===2) f.conversations.get("c1")!.participantIds=[];return f.messages.get(id);},post:async()=>{}});
  await expect(service.read(f.read(result.message),f.principal)).rejects.toThrow("attachment_forbidden");
});
test("legacy replay drops the additive binding and reports unavailable rather than fetching a URL", async () => {
  const f=fixture(); await f.journal.load(); const result=await f.service.postWithAttachments(f.input(),f.principal);
  f.messages.set(result.message.id,legacyMessage(result.message));
  await expect(f.service.read(f.read(result.message),f.principal)).rejects.toThrow("attachment_unavailable");
});
test("a full 25 MiB image writes without entering the journal; its JSON fits ordinary local ingress", async () => {
  const f=fixture(); await f.journal.load();
  const bytes=Buffer.alloc(ATTACHMENT_LIMITS.imageBytes); Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
  const input={...f.input(),attachments:[{data:bytes.toString("base64"),mediaType:"image/png"}]};
  expect(Buffer.byteLength(JSON.stringify({...input,actorId:"a"}))).toBeLessThan(ATTACHMENT_LIMITS.requestBytes);
  const accepted=await f.service.postWithAttachments(input,f.principal);
  expect(accepted.message.attachments?.[0]?.blob?.byteSize).toBe(25*1024*1024);
  expect(readFileSync(join(f.root,"journal.jsonl")).length).toBeLessThan(4096);
  await expect(f.service.read(f.read(accepted.message,"image"),f.principal)).rejects.toThrow("attachment_too_large");
}, 30_000);

const notifyImage = { data: Buffer.from([137,80,78,71,13,10,26,10]).toString("base64"), mediaType: "image/png", fileName: "screen.png" };
test("operator image notification is one durable authorized message/blob binding, not an answer", async () => {
  const f=fixture(); await f.journal.load();
  const input={requestId:"notify",conversationId:"c1",body:" Ready ",attachments:[notifyImage]};
  const result=await f.service.postOperatorNotification(input,f.principal);
  expect(result).toMatchObject({ok:true,duplicate:false,message:{actorId:"a",body:"Ready",originNodeId:"n",metadata:{
    operatorSignal:{kind:"notify",blocking:false,replyExpectation:"none"},relayTarget:"b",returnAddress:{actorId:"a",replyToMessageId:result.message.id}},
    mentions:[{actorId:"b",label:"@operator"}],audience:{reason:"direct_message",notify:["b"]}}});
  expect(result.message.replyToMessageId).toBeUndefined();
  expect(result.message.attachments?.[0]?.url).toBeUndefined();
  expect(result.message.attachments?.[0]?.blobKey).toBeUndefined();
  expect(await f.service.read(f.read(result.message,"image"),f.principal)).toMatchObject({data:notifyImage.data,mediaType:"image/png"});
  expect(readFileSync(join(f.root,"journal.jsonl"),"utf8")).not.toContain(notifyImage.data);
  expect(await f.service.postOperatorNotification(input,f.principal)).toMatchObject({duplicate:true,message:{id:result.message.id}});
  await expect(f.service.postWithAttachments({...input,body:"Ready"},f.principal)).rejects.toThrow("attachment_request_conflict");
  expect(f.messages.size).toBe(1);
});
test("operator image notification refuses impersonation, wrong node, target, replies and question metadata", async () => {
  const f=fixture(); await f.journal.load();
  const input={requestId:"notify",conversationId:"c1",body:"Ready",attachments:[notifyImage]};
  for(const principal of [{actorId:"unknown",nodeId:"n"},{actorId:"a",nodeId:"peer"},{actorId:"b",nodeId:"peer"}])
    await expect(f.service.postOperatorNotification(input,principal)).rejects.toThrow("attachment_forbidden");
  for(const change of [{replyToMessageId:"question"},{operatorSignal:{kind:"need"}},{attachments:[notifyImage,notifyImage]},{attachments:[{data:"YQ==",mediaType:"text/plain"}]},{body:" "}])
    await expect(f.service.postOperatorNotification({...input,...change},f.principal)).rejects.toThrow(/invalid_attachment/);
  for(const participants of [["a"],["a","b","other"]]) {
    f.conversations.get("c1")!.participantIds=participants;
    await expect(f.service.postOperatorNotification(input,f.principal)).rejects.toThrow("invalid_attachment_notification");
  }
  f.conversations.get("c1")!.participantIds=["a","b"]; f.conversations.get("c1")!.kind="group";
  await expect(f.service.postOperatorNotification(input,f.principal)).rejects.toThrow("invalid_attachment_notification");
  expect(f.messages.size).toBe(0);
});
test("operator membership and notification target are rechecked after durable image IO", async () => {
  for(const change of [()=>["a"],()=>["a","b","other"]]) {
    const f=fixture({beforeRename:async()=>{f.conversations.get("c1")!.participantIds=change();}}); await f.journal.load();
    await expect(f.service.postOperatorNotification({requestId:"notify",conversationId:"c1",body:"Ready",attachments:[notifyImage]},f.principal)).rejects.toThrow("invalid_attachment_notification");
    expect(f.messages.size).toBe(0);
  }
});
test("failed notification image commit never reports a recorded message", async()=>{
  const f=fixture({failCommit:true});await f.journal.load();
  await expect(f.service.postOperatorNotification({requestId:"notify",conversationId:"c1",body:"Ready",attachments:[notifyImage]},f.principal)).rejects.toThrow("attachment_unavailable");
  expect(f.messages.size).toBe(0);
});

test("serialized notification admission refuses a changed operator DM even after the last IO recheck",async()=>{
  const f=fixture({beforeCommit:()=>{f.conversations.get("c1")!.participantIds=["a"];}});await f.journal.load();
  await expect(f.service.postOperatorNotification({requestId:"notify",conversationId:"c1",body:"Ready",attachments:[notifyImage]},f.principal)).rejects.toThrow("invalid_attachment_notification");
  expect(f.messages.size).toBe(0);
});
test("notification retry cannot adopt a retained blocking signal or a different image",async()=>{
  const f=fixture();await f.journal.load();const input={requestId:"notify",conversationId:"c1",body:"Ready",attachments:[notifyImage]};
  const {message}=await f.service.postOperatorNotification(input,f.principal);
  await expect(f.service.postOperatorNotification({...input,attachments:[{...notifyImage,data:Buffer.concat([Buffer.from(notifyImage.data,"base64"),Buffer.from("different")]).toString("base64")}]},f.principal)).rejects.toThrow("attachment_request_conflict");
  message.metadata!.operatorSignal={kind:"need",blocking:true,replyExpectation:"required"};
  await expect(f.service.postOperatorNotification(input,f.principal)).rejects.toThrow("attachment_request_conflict");
  expect(f.messages.size).toBe(1);
});

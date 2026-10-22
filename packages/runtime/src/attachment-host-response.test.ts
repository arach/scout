import { expect,test } from "bun:test";
import { readAttachmentHostResponse } from "./attachment-host-response.js";
const input={conversationId:"c",messageId:"m",blobId:"a".repeat(64),mode:"text" as const};
const result={status:200,body:{blobId:input.blobId,messageId:"m",mode:"text",mediaType:"text/plain",byteSize:5,text:"hello",truncated:false,sourceTrust:"untrusted_attachment"}};
test("remote attachment responses retain identity and bounded untrusted text",async()=>{
  expect(await readAttachmentHostResponse(Response.json(result),input)).toEqual(result);
});
test("host response reader refuses redirects, oversized streams, identity changes and extra fetch fields",async()=>{
  for(const response of [new Response("",{status:302,headers:{location:"https://evil.test"}}),new Response("x".repeat(512*1024+1)),Response.json({...result,body:{...result.body,messageId:"other"}}),Response.json({...result,body:{...result.body,url:"https://evil.test"}}),Response.json({...result,body:{...result.body,text:"x".repeat(32001)}})]){
    await expect(readAttachmentHostResponse(response,input)).rejects.toThrow("attachment_unavailable");
  }
});
test("old destinations produce explicit attachment capability unavailability",async()=>{
  expect(await readAttachmentHostResponse(Response.json({status:400,body:{error:"unsupported_host_operation"}}),input)).toEqual({status:400,body:{error:"attachments_unavailable"}});
});

test.each([256 * 1024 + 1, 25 * 1024 * 1024])("authorized image host responses accept %s decoded bytes with the same binding checks", async size => {
  const { attachmentHash } = await import("./attachment-blob-store.js");
  const bytes = Buffer.alloc(size); Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
  const imageInput = { ...input, mode: "image" as const, blobId: attachmentHash(bytes) };
  const body = { blobId: imageInput.blobId, messageId: input.messageId, mode: "image", mediaType: "image/png", byteSize: size, data: bytes.toString("base64") };
  const result = await readAttachmentHostResponse(Response.json({ status: 200, body }), imageInput);
  expect(result.status).toBe(200);
  expect((result.body as typeof body).data).toBe(body.data);
  await expect(readAttachmentHostResponse(Response.json({ status: 200, body }), { ...imageInput, messageId: "other" })).rejects.toThrow("attachment_unavailable");
}, 30_000);
test("host text budget is not raised, and oversize image bodies fail before parsing or allocation", async () => {
  await expect(readAttachmentHostResponse(Response.json({ ...result, body: { ...result.body, byteSize: 256 * 1024 + 1 } }), input)).rejects.toThrow("attachment_unavailable");
  const limit = Math.ceil(25 * 1024 * 1024 / 3) * 4 + 32 * 1024;
  let reads = 0, cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { reads++; controller.enqueue(new Uint8Array(1)); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  await expect(readAttachmentHostResponse(new Response(stream, { headers: { "content-length": String(limit + 1) } }), { ...input, mode: "image" })).rejects.toThrow("attachment_unavailable");
  expect(reads).toBe(0); expect(cancelled).toBe(true);
  await expect(readAttachmentHostResponse(Response.json({ status: 200, body: { blobId: input.blobId, messageId: input.messageId, mode: "image", mediaType: "image/png", byteSize: 25 * 1024 * 1024 + 1, data: "YQ==" } }), { ...input, mode: "image" })).rejects.toThrow("attachment_unavailable");
});
test("tiny host stream fragments do not cause unbounded chunk bookkeeping", async () => {
  const json = Buffer.from(JSON.stringify(result)); let offset = 0;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { if (offset === json.length) controller.close(); else controller.enqueue(json.subarray(offset, ++offset)); } });
  expect(await readAttachmentHostResponse(new Response(stream), input)).toEqual(result);
});
test("larger image responses still reject bad MIME/signature, content hash and response mode", async () => {
  const { attachmentHash } = await import("./attachment-blob-store.js");
  const bytes = Buffer.from("not a PNG"), sha = attachmentHash(bytes);
  const imageInput = { ...input, blobId: sha, mode: "image" as const };
  const body = { blobId: sha, messageId: input.messageId, mode: "image", mediaType: "image/png", byteSize: bytes.length, data: bytes.toString("base64") };
  for (const mutation of [{}, { mediaType: "image/svg+xml" }, { blobId: "b".repeat(64) }, { mode: "text" }])
    await expect(readAttachmentHostResponse(Response.json({ status: 200, body: { ...body, ...mutation } }), imageInput)).rejects.toThrow("attachment_unavailable");
});
test("an image stream exceeding its wire budget without content-length is cancelled", async () => {
  const limit = Math.ceil(25 * 1024 * 1024 / 3) * 4 + 32 * 1024;
  const chunk = new Uint8Array(64 * 1024); let emitted = 0, cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) {
    const size = Math.min(chunk.length, limit + 1 - emitted);
    if (!size) { controller.close(); return; }
    emitted += size; controller.enqueue(chunk.subarray(0, size));
  }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  await expect(readAttachmentHostResponse(new Response(stream), { ...input, mode: "image" })).rejects.toThrow("attachment_unavailable");
  expect(emitted).toBe(limit + 1); expect(cancelled).toBe(true);
});

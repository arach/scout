import { z } from "zod";
import type { HostWebResponse } from "./host-web-request.js";
import type { ReadAttachment } from "@openscout/protocol";
import { ATTACHMENT_LIMITS, AttachmentError, decodeAttachment, imageMimes, isTextMime } from "./attachment-contract.js";
import { attachmentHash } from "./attachment-blob-store.js";
const common = { blobId: z.string().regex(/^[a-f0-9]{64}$/), messageId: z.string().min(1).max(256), mediaType: z.string(), byteSize: z.number().int().positive().max(ATTACHMENT_LIMITS.readBytes), fileName: z.string().max(200).optional() };
const resultSchema = z.discriminatedUnion("mode", [
  z.object({ ...common, mode: z.literal("image"), data: z.string().max(Math.ceil(ATTACHMENT_LIMITS.readBytes/3)*4) }).strict(),
  z.object({ ...common, mode: z.literal("text"), text: z.string().max(ATTACHMENT_LIMITS.textCharacters), truncated: z.boolean(), sourceTrust: z.literal("untrusted_attachment") }).strict(),
]);
/** Bound even a corrupt enrolled peer response before JSON parsing. Redirects
 * are refused by the existing signed host transport; this performs no fetch. */
export async function readAttachmentHostResponse(response: Response, input: ReadAttachment): Promise<HostWebResponse> {
  const limit = 512 * 1024;
  const reader = response.body?.getReader();
  try {
    if (response.status >= 300 && response.status < 400 || Number(response.headers.get("content-length")) > limit) throw new Error("invalid host response");
    const chunks: Uint8Array[] = []; let total = 0;
    if (reader) while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      total += chunk.value.byteLength; if (total > limit) throw new Error("host response too large"); chunks.push(chunk.value);
    }
    const outer = z.object({ status: z.number().int().min(200).max(599), body: z.unknown() }).strict().parse(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks))));
    if (outer.status >= 300 && outer.status < 400) throw new Error("redirect response");
    if (outer.status !== 200) {
      const error = z.object({error:z.string().min(1).max(256)}).strict().parse(outer.body);
      return {status:outer.status,body:{error:error.error === "unsupported_host_operation" ? "attachments_unavailable" : error.error}};
    }
    const body = resultSchema.parse(outer.body);
    if (body.blobId !== input.blobId || body.messageId !== input.messageId || body.mode !== input.mode) throw new Error("mismatched host response");
    if (body.mode === "image") {
      const bytes = decodeAttachment(body.data);
      if (!imageMimes.has(body.mediaType) || bytes.length !== body.byteSize || attachmentHash(bytes) !== body.blobId) throw new Error("invalid image response");
    } else if (!isTextMime(body.mediaType) || body.text.includes("\0") || Buffer.byteLength(body.text) > body.byteSize) throw new Error("invalid text response");
    return {status:200,body};
  } catch { throw new AttachmentError("attachment_unavailable"); }
  finally { await reader?.cancel().catch(()=>{}); reader?.releaseLock(); }
}

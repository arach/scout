import { z } from "zod";
import { ATTACHMENT_LIMITS } from "@openscout/protocol";
export { ATTACHMENT_LIMITS };
export const imageMimes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const textMimes = new Set(["application/json", "application/ld+json", "application/javascript", "application/typescript", "application/xml", "application/yaml", "application/x-yaml", "application/toml", "application/sql", "application/x-sh", "application/x-python-code"]);
export const isTextMime = (mime: string) => /^text\/(plain|markdown|csv|javascript|typescript|x-python|x-shellscript|x-c|x-c\+\+|x-java-source|css|xml|yaml)$/.test(mime) || textMimes.has(mime);
const id = z.string().min(1).max(256);
export const blobRefSchema = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), mediaType: z.string().refine(m => imageMimes.has(m) || isTextMime(m)), byteSize: z.number().int().positive().max(ATTACHMENT_LIMITS.imageBytes) }).strict();
export const postWithAttachmentsSchema = z.object({
  requestId: id, conversationId: id, body: z.string().max(64_000), replyToMessageId: id.optional(),
  attachments: z.array(z.object({ data: z.string().min(4).max(Math.ceil(ATTACHMENT_LIMITS.imageBytes / 3) * 4), mediaType: z.string().refine(m => imageMimes.has(m) || isTextMime(m)), fileName: z.string().min(1).max(200).refine(n => !/[\\/\x00-\x1f\x7f]/.test(n)).optional() }).strict()).min(1).max(4),
}).strict();
export const readAttachmentSchema = z.object({ conversationId: id, messageId: id, blobId: z.string().regex(/^[a-f0-9]{64}$/), mode: z.enum(["text", "image"]) }).strict();
export class AttachmentError extends Error {
  constructor(readonly code: string, readonly status = 503) { super(code); }
}
export function decodeAttachment(data: string): Buffer {
  // Buffer.from alone tolerates malformed input. No whitespace, data URLs, or padding aliases.
  const payload = data.endsWith("==") ? data.slice(0,-2) : data.endsWith("=") ? data.slice(0,-1) : data;
  if (data.length % 4 || /[^A-Za-z0-9+/]/.test(payload)) throw new AttachmentError("invalid_attachment_encoding", 400);
  const bytes = Buffer.from(data, "base64");
  if (!bytes.length || bytes.toString("base64") !== data) throw new AttachmentError("invalid_attachment_encoding", 400);
  return bytes;
}
export function validateAttachmentBytes(bytes: Uint8Array, mediaType: string): void {
  if (bytes.length > (isTextMime(mediaType) ? ATTACHMENT_LIMITS.readBytes : ATTACHMENT_LIMITS.imageBytes)) throw new AttachmentError("attachment_too_large", 413);
  const b = Buffer.from(bytes);
  if (imageMimes.has(mediaType)) {
    const valid = mediaType === "image/png" ? b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : mediaType === "image/jpeg" ? b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255
      : mediaType === "image/gif" ? ["GIF87a", "GIF89a"].includes(b.subarray(0,6).toString("ascii"))
      : b.length >= 12 && b.subarray(0,4).toString("ascii") === "RIFF" && b.subarray(8,12).toString("ascii") === "WEBP";
    if (!valid) throw new AttachmentError("attachment_mime_mismatch", 415);
  } else {
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(b); }
    catch { throw new AttachmentError("attachment_invalid_text", 415); }
    if (text.includes("\0")) throw new AttachmentError("attachment_invalid_text", 415);
  }
}

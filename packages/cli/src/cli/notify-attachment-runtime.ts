import { createHash } from "node:crypto";
import type { AttachmentUpload, MessageRecord } from "@openscout/protocol";
import { ScoutCliError } from "./errors.ts";

export const OPERATOR_ATTACHMENT_PATH = "/v1/operator/notify-with-attachment";
export function assertLocalAttachmentBroker(baseUrl: string): void {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?\/?(?![\s\S])/iu.test(baseUrl)) throw new ScoutCliError("--image requires a local broker");
}
/** One fixed local write. No redirects, cookie, pairing store or socket fallback. */
export async function postOperatorAttachment(input: {
  baseUrl: string; socketPath?: string | null; actorId: string; requestId: string; body: string; attachment: AttachmentUpload;
  fetchImpl?: typeof fetch;
}): Promise<MessageRecord> {
  assertLocalAttachmentBroker(input.baseUrl);
  const url = new URL(OPERATOR_ATTACHMENT_PATH, input.baseUrl);
  const body = JSON.stringify({ actorId: input.actorId, requestId: input.requestId, body: input.body, attachment: input.attachment });
  if (Buffer.byteLength(body) > 36 * 1024 * 1024) throw new ScoutCliError("attachment request is too large");
  let response: Response;
  try { response = await (input.fetchImpl ?? fetch)(url, { method: "POST", body, headers: { "content-type": "application/json", accept: "application/json" },
    redirect: "error", credentials: "omit", signal: AbortSignal.timeout(30_000), ...(input.socketPath ? { unix: input.socketPath } : {}) }); }
  catch { throw new ScoutCliError("operator attachment recording is unconfirmed; do not automatically retry"); }
  const reader = response.body?.getReader();
  let text: string;
  try {
    const chunks: Uint8Array[] = []; let bytes = 0;
    if (reader) while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength;
      if (bytes > 1024 * 1024) throw Error("oversize"); chunks.push(chunk.value); }
    text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch { throw new ScoutCliError("operator attachment receipt is unconfirmed; do not automatically retry"); }
  finally { await reader?.cancel().catch(() => {}); reader?.releaseLock(); }
  let result: { ok?: boolean; message?: MessageRecord; error?: unknown };
  try { result = JSON.parse(text); } catch { throw new ScoutCliError(`operator attachment receipt unavailable (HTTP ${response.status})`); }
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new ScoutCliError("operator attachment receipt is unconfirmed; do not automatically retry");
  if (response.status !== 200) throw new ScoutCliError(`operator attachment refused: HTTP ${response.status}${typeof result.error === "string" && /^[a-z_][a-z0-9_]{0,127}(?![\s\S])/.test(result.error) ? ` ${result.error}` : ""}`);
  const message = result?.message;
  const hash = createHash("sha256").update(Buffer.from(input.attachment.data, "base64")).digest("hex");
  const id = `msg.request.${createHash("sha256").update(JSON.stringify([input.actorId, input.requestId])).digest("hex")}`;
  const attachment = message?.attachments?.[0];
  const signal = message?.metadata?.operatorSignal as { kind?: unknown; blocking?: unknown; replyExpectation?: unknown } | undefined;
  if (result.ok !== true || message?.id !== id || message.actorId !== input.actorId || !message.conversationId
    || message.requestId !== input.requestId || message.body !== input.body.trim() || message.attachments?.length !== 1 || message.replyToMessageId
    || signal?.kind !== "notify" || signal.blocking !== false || signal.replyExpectation !== "none"
    || attachment?.id !== `${id}.attachment.0` || attachment?.fileName !== input.attachment.fileName || attachment?.mediaType !== input.attachment.mediaType
    || attachment?.url !== undefined || attachment?.blobKey !== undefined || attachment?.blob?.sha256 !== hash
    || attachment.blob.mediaType !== input.attachment.mediaType || attachment.blob.byteSize !== Buffer.byteLength(input.attachment.data, "base64"))
    throw new ScoutCliError("operator attachment receipt identity/binding is unconfirmed; do not automatically retry");
  return message;
}

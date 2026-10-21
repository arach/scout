import type { RuntimeHttpRequestLike, RuntimeHttpResponseLike } from "./portable-types.js";
import { z } from "zod";
import { ATTACHMENT_LIMITS } from "@openscout/protocol";
import { AttachmentError, postWithAttachmentsSchema, readAttachmentSchema } from "./attachment-contract.js";
import type { BrokerAttachmentService } from "./broker-attachment-service.js";
import { badRequest, json, readRequestBody } from "./broker-http-helpers.js";
import type { HostWebRequest, HostWebResponse } from "./host-web-request.js";
export const ATTACHMENT_READ_PATH = "/v1/attachments/read";
const actorId = z.string().min(1).max(256);
export const attachmentPostHttpSchema = postWithAttachmentsSchema.extend({ actorId }).strict();
export const attachmentReadHttpSchema = readAttachmentSchema.extend({ actorId }).strict();
const hostSchema = z.object({ path: z.literal(ATTACHMENT_READ_PATH), method: z.literal("POST"), nodeId: actorId.optional(), body: attachmentReadHttpSchema }).strict();
export type AttachmentHttpDeps = {
  service?: BrokerAttachmentService;
  /** Protected local ingress currently buffers at most 16 MiB before routing. */
  uploadRequestBytes?: number;
  nodeId: string;
  peerNode: (keyId: string) => string | undefined;
  forward?: (input: HostWebRequest & { nodeId: string }) => Promise<HostWebResponse>;
};
export function attachmentHttpError(response: RuntimeHttpResponseLike, error: unknown) {
  if (error instanceof AttachmentError) json(response, error.status, { error: error.code });
  else badRequest(response, error);
}
function local(request: RuntimeHttpRequestLike) {
  const context = request.transportContext;
  if (!context || context.transport === "remote" || context.peer || context.guest || context.scoped) throw new AttachmentError("attachment_forbidden", 403);
}
const uploads = new WeakSet<AttachmentHttpDeps>();
export async function handleAttachmentRoute(request: RuntimeHttpRequestLike, response: RuntimeHttpResponseLike, url: URL, deps: AttachmentHttpDeps): Promise<boolean> {
  const post = request.method === "POST" && url.pathname === "/v1/messages/with-attachments";
  const read = request.method === "POST" && url.pathname === ATTACHMENT_READ_PATH;
  const capability = request.method === "GET" && url.pathname === "/v1/attachments/capability";
  if (!post && !read && !capability) return false;
  let admittedUpload = false;
  try {
    local(request);
    if (!deps.service) { request.resume(); throw new AttachmentError("attachments_unavailable"); }
    if (capability) { json(response, 200, { available: true, ...ATTACHMENT_LIMITS, requestBytes: deps.uploadRequestBytes ?? ATTACHMENT_LIMITS.requestBytes }); return true; }
    if (post) {
      if (uploads.has(deps)) { request.resume(); throw new AttachmentError("attachments_busy"); }
      uploads.add(deps); admittedUpload = true;
    }
    const raw = await readRequestBody(request, { maxBytes: post ? (deps.uploadRequestBytes ?? ATTACHMENT_LIMITS.requestBytes) : 4096, requireJsonContentType: true });
    const parsed = (post ? attachmentPostHttpSchema : attachmentReadHttpSchema).safeParse(raw);
    if (!parsed.success) throw new AttachmentError("invalid_attachment_request", 400);
    const { actorId, ...input } = parsed.data;
    const principal = { actorId, nodeId: deps.nodeId };
    const result = post ? await deps.service.postWithAttachments(input as Parameters<BrokerAttachmentService["postWithAttachments"]>[0], principal)
      : await deps.service.read(input as Parameters<BrokerAttachmentService["read"]>[0], principal);
    json(response, 200, result);
  } catch (error) { attachmentHttpError(response, error); }
  finally { if (admittedUpload) uploads.delete(deps); }
  return true;
}
/** Fixed local operation on the existing host routes. No URL forwarding or web
 * credential is involved. The destination obtains node authority from the
 * verified peer key, never the request body or forwarding headers. */
export async function executeHostAttachmentRead(raw: unknown, request: RuntimeHttpRequestLike, path: string, deps: AttachmentHttpDeps): Promise<HostWebResponse> {
  try {
    const parsed = hostSchema.safeParse(raw);
    if (!parsed.success) throw new AttachmentError("invalid_attachment_request", 400);
    const input = parsed.data;
    let nodeId: string;
    if (path === "/v1/hosts/web-request") {
      local(request);
      if (!input.nodeId) throw new AttachmentError("attachment_wrong_node", 400);
      if (input.nodeId !== deps.nodeId) {
        if (!deps.forward) throw new AttachmentError("attachments_unavailable");
        return await deps.forward(input as HostWebRequest & { nodeId: string });
      }
      nodeId = deps.nodeId;
    } else {
      if (input.nodeId !== undefined || request.transportContext?.guest || request.transportContext?.scoped) throw new AttachmentError("attachment_forbidden", 403);
      if (request.transportContext?.peer?.tier !== "control") throw new AttachmentError("attachment_forbidden", 403);
      const key = request.transportContext?.peer?.keyId;
      const peerNode = key ? deps.peerNode(key) : undefined;
      if (!peerNode) throw new AttachmentError("attachment_forbidden", 403);
      nodeId = peerNode;
    }
    if (!deps.service) throw new AttachmentError("attachments_unavailable");
    const { actorId, ...read } = input.body;
    return { status: 200, body: await deps.service.read(read, { actorId, nodeId }) };
  } catch (error) {
    return { status: error instanceof AttachmentError ? error.status : 503, body: { error: error instanceof AttachmentError ? error.code : "attachment_unavailable" } };
  }
}

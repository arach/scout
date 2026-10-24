/** Retry-safe command preparation and broker submission for operator clients.
 * The broker remains the only receipt writer. Retain the prepared command and
 * requester-scoped key; an uncertain response never authorizes a new copy.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  SCOUT_SESSION_INPUT_RECEIPTS_CAPABILITY,
  type MessageAttachment,
  type ScoutDeliverRequest,
  type ScoutDeliverHttpRequest,
  type ScoutDeliverResponse,
  type ScoutSessionInputReceipt,
} from "@openscout/protocol";
import { requestScoutBrokerJson } from "./broker-api.js";

export type OutgoingAttachmentInput = {
  id?: string;
  mediaType: string;
  fileName?: string;
  blobKey?: string;
  url?: string;
};

/** Drop unusable attachments; keyed derived ids are stable across retries. */
export function normalizeOutgoingAttachments(
  attachments: OutgoingAttachmentInput[] | undefined,
  clientMessageId?: string | null,
): MessageAttachment[] | undefined {
  if (!attachments?.length) return undefined;
  const normalized: MessageAttachment[] = [];
  for (const attachment of attachments) {
    const mediaType = attachment?.mediaType?.trim();
    const url = attachment?.url?.trim();
    const blobKey = attachment?.blobKey?.trim();
    if (!mediaType || (!url && !blobKey)) continue;
    const fileName = attachment.fileName?.trim() || undefined;
    const generatedId = clientMessageId?.trim()
      ? `att-client-${createHash("sha256").update(JSON.stringify([
        clientMessageId.trim(), normalized.length, mediaType, fileName, url || undefined, blobKey || undefined,
      ])).digest("hex").slice(0, 32)}`
      : `att-${randomUUID()}`;
    normalized.push({ id: attachment.id?.trim() || generatedId, mediaType, fileName,
      url: url || undefined, blobKey: blobKey || undefined });
  }
  return normalized.length ? normalized : undefined;
}

export type PrepareScoutDeliveryInput = {
  clientMessageId?: string | null;
  /** An explicitly retained caller timestamp, never a fresh timestamp on retry. */
  createdAtMs?: number;
  /** Clock seam for unkeyed legacy sends; keyed commands do not sample it. */
  now?: number;
  command: Omit<ScoutDeliverRequest, "id" | "requestId" | "createdAt" | "attachments"> & {
    attachments?: OutgoingAttachmentInput[];
  };
};

/** No side effects. Unkeyed ordinary sends deliberately reserve no receipt. */
export function prepareScoutDelivery(input: PrepareScoutDeliveryInput): ScoutDeliverRequest {
  const key = input.clientMessageId?.trim();
  const now = input.createdAtMs ?? input.now ?? (key ? 0 : Date.now());
  const id = key
    ? `deliver-client-${createHash("sha256").update(key).digest("hex").slice(0, 32)}`
    : `deliver-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return { ...input.command, id, ...(key ? { requestId: id,
      ...(input.createdAtMs !== undefined ? { createdAt: input.createdAtMs } : {}) } : { createdAt: now }),
    attachments: normalizeOutgoingAttachments(input.command.attachments, key) };
}

export type ScoutSessionReplyInput = {
  clientMessageId: string;
  requesterId: string;
  requesterNodeId: string;
  sessionId: string;
  harness: "claude" | "codex";
  body: string;
  source: string;
};

/** Native-reply policy, shared by thin app adapters and command preparation. */
export function scoutSessionReplyTarget(sessionId: string, harness: "claude" | "codex") {
  return { kind: "session_id" as const, sessionId: sessionId.trim(), harness, forkIfLive: harness === "codex" };
}

/** Prepare plain-text continuation, never a fork or an unreceipted input. */
export function prepareScoutSessionReply(input: ScoutSessionReplyInput): ScoutDeliverRequest {
  if (!input.clientMessageId?.trim()) throw new Error("request_id_required: session input requires a stable client message id");
  if (!input.sessionId.trim() || !input.body.trim() || !["claude", "codex"].includes(input.harness)) {
    throw new Error("session_input_unsupported: requires an exact local Claude or Codex session and non-empty text");
  }
  const sessionId = input.sessionId.trim();
  return prepareScoutDelivery({ clientMessageId: input.clientMessageId, command: {
    requesterId: input.requesterId, requesterNodeId: input.requesterNodeId,
    target: scoutSessionReplyTarget(sessionId, input.harness),
    targetLabel: `session:${sessionId}`, body: input.body.trim(), intent: "consult",
    sessionDelivery: "in_place_or_resume", execution: { session: "existing" }, ensureAwake: true,
    messageMetadata: { source: input.source, clientMessageId: input.clientMessageId.trim() },
    invocationMetadata: { source: input.source },
  } });
}

export type ScoutDeliveryBroker = { baseUrl: string; socketPath?: string | null; expectedNodeId: string };
function isDeliveryResponse(value: unknown): value is ScoutDeliverResponse {
  if (!value || typeof value !== "object") return false;
  return ["delivery", "question", "rejected"].includes((value as { kind: string }).kind);
}

/** Fresh compatibility check. A saved capability snapshot cannot authorize input. */
export async function requireScoutSessionInputSupport(broker: ScoutDeliveryBroker, signal?: AbortSignal): Promise<void> {
  const current = await requestScoutBrokerJson<{ id: string; capabilities?: string[] }>(broker.baseUrl, "/v1/node", {
    socketPath: broker.socketPath, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(4_000)]) : AbortSignal.timeout(4_000),
  });
  if (current.id !== broker.expectedNodeId || !current.capabilities?.includes(SCOUT_SESSION_INPUT_RECEIPTS_CAPABILITY)) {
    throw new Error("session_input_unsupported: update the broker before submitting live session replies");
  }
}

/** Submit once. HTTP and Unix sockets use the same versioned intent fence.
 * A timeout/abort after reservation stops waiting, not the broker-owned command.
 * Durable keyed acceptance requires the daemon's configured receipt owner.
 */
export async function deliverScoutRequest(broker: ScoutDeliveryBroker, prepared: ScoutDeliverRequest,
  options: { signal?: AbortSignal; beforeEffect?: () => void } = {}): Promise<ScoutDeliverResponse> {
  if (prepared.sessionDelivery) {
    if (!prepared.requestId?.trim()) throw new Error("request_id_required: session input requires a stable request id");
    await requireScoutSessionInputSupport(broker, options.signal);
  }
  const wire: ScoutDeliverHttpRequest = { ...prepared,
    intent: prepared.sessionDelivery ? "session_input" : prepared.completion || prepared.relation ? "explicit_consult" : prepared.intent };
  const result = await requestScoutBrokerJson<ScoutDeliverResponse>(broker.baseUrl, "/v1/deliver", {
    method: "POST", body: wire, socketPath: broker.socketPath, signal: options.signal, acceptErrorJson: isDeliveryResponse,
    beforeEffect: options.beforeEffect,
  });
  if (prepared.sessionDelivery && result.kind === "delivery") {
    const target = prepared.target;
    if (target?.kind !== "session_id" || (target.harness !== "claude" && target.harness !== "codex")) {
      throw new Error("delivery_unconfirmed: broker returned acceptance for an unsupported native target");
    }
    validateScoutSessionReplyResult({ sessionId: target.sessionId, harness: target.harness }, result);
  }
  return result;
}

export type ScoutSessionReplyAcceptance = {
  conversationId?: string;
  targetSessionId?: string;
  flight?: { id: string };
  inputSubmitted?: ScoutSessionInputReceipt;
};
export type ScoutSessionReplySubmission =
  | { kind: "in_place"; receipt: ScoutSessionInputReceipt }
  | { kind: "resumed"; sessionId: string; flightId: string };

/** A submission receipt is not proof that the agent completed the turn. */
export function validateScoutSessionReplyResult(expected: Pick<ScoutSessionReplyInput, "sessionId" | "harness">,
  acceptance: ScoutSessionReplyAcceptance | Extract<ScoutDeliverResponse, { kind: "delivery" }>): ScoutSessionReplySubmission {
  const result: ScoutSessionReplyAcceptance = "kind" in acceptance ? {
    conversationId: acceptance.conversation?.id, targetSessionId: acceptance.targetSessionId,
    flight: acceptance.flight, inputSubmitted: acceptance.receipt?.inputSubmitted,
  } : acceptance;
  const receipt = result.inputSubmitted;
  if (!result.conversationId || (receipt && (receipt.kind !== "in_place" || receipt.state !== "submitted"
    || receipt.sessionId !== expected.sessionId.trim() || receipt.harness !== expected.harness))) {
    throw new Error("delivery_unconfirmed: broker did not confirm this session submission");
  }
  if (receipt) return { kind: "in_place", receipt };
  if (!result.flight?.id) throw new Error("delivery_unconfirmed: broker returned neither input receipt nor resume flight");
  return { kind: "resumed", sessionId: result.targetSessionId?.trim() || expected.sessionId.trim(), flightId: result.flight.id };
}

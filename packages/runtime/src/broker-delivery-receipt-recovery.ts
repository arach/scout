import { createHash } from "node:crypto";
import type { FlightRecord, InvocationRequest, MessageRecord, ScoutDeliverResponse } from "@openscout/protocol";
import { buildDeliveryReceipt } from "./broker-delivery-routing.js";

type DeliveryResponse = Extract<ScoutDeliverResponse, { kind: "delivery" }>;
export type DeliveryAcceptanceEnvelope = {
  version: 1;
  requesterId: string;
  requestId: string;
  response: Omit<DeliveryResponse, "message" | "flight" | "receipt" | "bindingRef">;
  receiptInput: Parameters<typeof buildDeliveryReceipt>[0];
  flight?: FlightRecord;
};
export function deliveryRequestMessageId(requesterId: string, requestId: string): string {
  return `msg-request-${createHash("sha256").update(JSON.stringify([requesterId, requestId, "deliver"])).digest("hex")}`;
}
export function deliveryRequestInvocationId(requesterId: string, requestId: string): string {
  return `inv-request-${createHash("sha256").update(JSON.stringify([requesterId, requestId, "deliver"])).digest("hex")}`;
}
export function recoverAcceptedInvocation(invocation: InvocationRequest | undefined, requesterId: string, requestId: string): DeliveryResponse | null {
  if (!invocation || invocation.id !== deliveryRequestInvocationId(requesterId, requestId) || invocation.requesterId !== requesterId) return null;
  const message = invocation.metadata?.acceptedDeliveryReceipt as MessageRecord | undefined;
  const recovered = recoverAcceptanceEnvelope(message, requesterId, requestId);
  if (!recovered || recovered.flight?.invocationId !== invocation.id || recovered.message.id !== invocation.messageId
    || recovered.message.conversationId !== invocation.conversationId || recovered.targetAgentId !== invocation.targetAgentId
    || (invocation.requesterNodeId !== undefined && recovered.message.originNodeId !== invocation.requesterNodeId)) return null;
  return recovered;
}
export function messageWithAcceptedFlight(message: MessageRecord, flight: FlightRecord): MessageRecord {
  const envelope = message.metadata?.scoutAcceptance as DeliveryAcceptanceEnvelope | undefined;
  if (envelope?.version !== 1) return message;
  // Acceptance describes the original commit, not the latest execution state.
  if (envelope.flight) {
    if (envelope.flight.id !== flight.id || envelope.flight.invocationId !== flight.invocationId
      || envelope.flight.requesterId !== flight.requesterId || envelope.flight.targetAgentId !== flight.targetAgentId) {
      throw new Error("accepted delivery receipt already belongs to a different flight");
    }
    return message;
  }
  return { ...message, metadata: { ...message.metadata, scoutAcceptance: { ...envelope, flight } } };
}
export function acceptedDeliveryResponse(message: MessageRecord, envelope: DeliveryAcceptanceEnvelope, flight: FlightRecord): DeliveryResponse {
  const { scoutAcceptance: _, ...metadata } = message.metadata ?? {};
  const bindingRef = flight.id.slice(-8);
  return { ...envelope.response, message: { ...message, metadata }, flight, bindingRef,
    receipt: { ...buildDeliveryReceipt({ ...envelope.receiptInput, bindingRef, flightId: flight.id }),
      acceptedAt: flight.startedAt ?? message.createdAt } };
}
/** Only a complete canonical transaction is positive acceptance evidence. */
export function recoverAcceptedDelivery(message: MessageRecord | undefined, requesterId: string, requestId: string): DeliveryResponse | null {
  if (!message || message.id !== deliveryRequestMessageId(requesterId, requestId)) return null;
  return recoverAcceptanceEnvelope(message, requesterId, requestId);
}

/** An invocation may witness a reused message ID; its caller validates that exact linkage. */
function recoverAcceptanceEnvelope(message: MessageRecord | undefined, requesterId: string, requestId: string): DeliveryResponse | null {
  const envelope = message?.metadata?.scoutAcceptance as DeliveryAcceptanceEnvelope | undefined;
  if (!message || typeof message.id !== "string" || !message.id || message.actorId !== requesterId
    || envelope?.version !== 1 || envelope.requesterId !== requesterId || envelope.requestId !== requestId
    || !envelope.flight || typeof envelope.flight.id !== "string" || !envelope.flight.id || envelope.flight.requesterId !== requesterId
    || envelope.flight.invocationId !== deliveryRequestInvocationId(requesterId, requestId)
    || envelope.response?.kind !== "delivery" || envelope.response.accepted !== true
    || envelope.receiptInput?.requestId !== requestId || envelope.receiptInput.requesterId !== requesterId
    || envelope.receiptInput.messageId !== message.id || envelope.receiptInput.conversationId !== message.conversationId
    || envelope.receiptInput.requesterNodeId !== message.originNodeId
    || envelope.response.conversation?.id !== message.conversationId
    || envelope.response.routeKind !== envelope.receiptInput.routeKind
    || typeof envelope.flight.targetAgentId !== "string" || !envelope.flight.targetAgentId
    || envelope.response.targetAgentId !== envelope.flight.targetAgentId
    || envelope.receiptInput.targetAgentId !== envelope.flight.targetAgentId) return null;
  return acceptedDeliveryResponse(message, envelope, envelope.flight);
}

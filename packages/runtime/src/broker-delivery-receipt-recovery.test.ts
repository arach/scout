import { describe, expect, test } from "bun:test";
import type { FlightRecord, InvocationRequest, MessageRecord } from "@openscout/protocol";
import {
  deliveryRequestInvocationId, deliveryRequestMessageId, messageWithAcceptedFlight,
  recoverAcceptedDelivery, recoverAcceptedInvocation, type DeliveryAcceptanceEnvelope,
} from "./broker-delivery-receipt-recovery.js";

function fixture(messageId = deliveryRequestMessageId("operator", "request")) {
  const invocation: InvocationRequest = {
    id: deliveryRequestInvocationId("operator", "request"), requesterId: "operator", requesterNodeId: "caller-node",
    targetAgentId: "agent", action: "consult", task: "context", ensureAwake: true, stream: false,
    createdAt: 1, messageId, conversationId: "conversation",
  };
  const flight: FlightRecord = { id: "flight-original", invocationId: invocation.id, requesterId: "operator",
    targetAgentId: "agent", state: "queued", startedAt: 2 };
  const envelope: DeliveryAcceptanceEnvelope = {
    version: 1, requesterId: "operator", requestId: "request",
    response: { kind: "delivery", accepted: true, routeKind: "dm", targetAgentId: "agent", conversation: {
      id: "conversation", kind: "direct", title: "saved authority", participantIds: ["operator", "agent"],
      visibility: "workspace", shareMode: "local", authorityNodeId: "remote-authority",
    } },
    receiptInput: { requestId: "request", requesterId: "operator", requesterNodeId: "caller-node", targetAgentId: "agent",
      targetLabel: "Original label", routeKind: "dm", conversationId: "conversation", messageId },
  };
  const message: MessageRecord = messageWithAcceptedFlight({
    id: messageId, actorId: "operator", originNodeId: "caller-node", conversationId: "conversation", class: "agent",
    body: "context", visibility: "workspace", policy: "durable", createdAt: 1,
    metadata: { scoutAcceptance: envelope },
  }, flight);
  invocation.metadata = { acceptedDeliveryReceipt: message };
  return { invocation, message, flight, envelope: message.metadata!.scoutAcceptance as DeliveryAcceptanceEnvelope };
}

describe("canonical acceptance receipt recovery", () => {
  test("only a canonical invocation witnesses an older reused message identity", () => {
    const { invocation, message } = fixture("older-client-message");
    expect(recoverAcceptedDelivery(message, "operator", "request")).toBeNull();
    const response = recoverAcceptedInvocation(invocation, "operator", "request");
    expect(response?.message.id).toBe("older-client-message");
    expect(response?.receipt.messageId).toBe("older-client-message");
    expect(response?.receipt.targetLabel).toBe("Original label");
    expect(response?.conversation.authorityNodeId).toBe("remote-authority");
    expect(response?.message.metadata?.scoutAcceptance).toBeUndefined();
  });

  test("standalone canonical message recovery validates the original invocation identity", () => {
    const { message, envelope } = fixture();
    expect(recoverAcceptedDelivery(message, "operator", "request")?.flight?.id).toBe("flight-original");
    envelope.flight!.invocationId = "different-invocation";
    expect(recoverAcceptedDelivery(message, "operator", "request")).toBeNull();
  });

  test("every requester, target, request, conversation and message linkage must agree", () => {
    const changes: Array<(value: ReturnType<typeof fixture>) => void> = [
      value => { value.invocation.id = "wrong"; },
      value => { value.invocation.messageId = "wrong"; },
      value => { value.invocation.conversationId = "wrong"; },
      value => { value.invocation.requesterId = "wrong"; },
      value => { value.invocation.requesterNodeId = "wrong"; },
      value => { value.invocation.targetAgentId = "wrong"; },
      value => { value.message.actorId = "wrong"; },
      value => { value.message.originNodeId = "wrong"; },
      value => { value.envelope.requestId = "wrong"; },
      value => { value.envelope.requesterId = "wrong"; },
      value => { value.envelope.flight!.id = ""; },
      value => { value.envelope.flight!.invocationId = "wrong"; },
      value => { value.envelope.flight!.requesterId = "wrong"; },
      value => { value.envelope.flight!.targetAgentId = "wrong"; },
      value => { value.envelope.receiptInput.requestId = "wrong"; },
      value => { value.envelope.receiptInput.requesterId = "wrong"; },
      value => { value.envelope.receiptInput.requesterNodeId = "wrong"; },
      value => { value.envelope.receiptInput.messageId = "wrong"; },
      value => { value.envelope.receiptInput.conversationId = "wrong"; },
      value => { value.envelope.receiptInput.targetAgentId = "wrong"; },
      value => { value.envelope.response.conversation.id = "wrong"; },
      value => { value.envelope.response.targetAgentId = "wrong"; },
      value => { value.envelope.response.routeKind = "channel"; },
      value => { Object.assign(value.envelope.response, { accepted: false }); },
    ];
    for (const change of changes) {
      const value = fixture("older-message"); change(value);
      expect(recoverAcceptedInvocation(value.invocation, "operator", "request")).toBeNull();
    }
  });

  test("incomplete or malformed stored envelopes fail closed without throwing", () => {
    for (const envelope of [null, {}, { version: 1 }, { version: 1, requesterId: "operator", requestId: "request", flight: {} }]) {
      const value = fixture();
      value.message.metadata!.scoutAcceptance = envelope;
      expect(recoverAcceptedInvocation(value.invocation, "operator", "request")).toBeNull();
    }
    for (const missing of ["receiptInput", "response", "flight"]) {
      const value = fixture(); delete (value.envelope as any)[missing];
      expect(recoverAcceptedInvocation(value.invocation, "operator", "request")).toBeNull();
    }
  });

  test("later flight progress cannot rewrite the original acceptance receipt", () => {
    const { message, flight } = fixture();
    const enriched = messageWithAcceptedFlight(message, { ...flight, state: "completed", output: "later result", completedAt: 99 });
    const response = recoverAcceptedDelivery(enriched, "operator", "request");
    expect(response?.flight?.state).toBe("queued");
    expect(response?.flight?.output).toBeUndefined();
    expect(() => messageWithAcceptedFlight(message, { ...flight, id: "different-flight" })).toThrow("different flight");
  });
});

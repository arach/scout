import type { AttachmentUpload, ConversationDefinition } from "@openscout/protocol";
import { AttachmentError } from "./attachment-contract.js";
import type { AttachmentPrincipal, BrokerAttachmentService } from "./broker-attachment-service.js";
import type { OperatorSignalInput } from "./broker-operator-attention-service.js";

/** Broker-only composition: no caller-selected recipient, reply, question or work. */
export function createOperatorAttachmentNotifier(options: {
  service: () => BrokerAttachmentService | undefined;
  operatorActorId: string;
  ensureOperator: () => Promise<void>;
  conversation: (requesterId: string, operatorId: string) => Promise<ConversationDefinition>;
  requester: (actorId: string) => { requesterName: string; projectRoot?: string };
  queueSignal: (input: OperatorSignalInput) => void;
}) {
  return async (input: { actorId: string; requestId: string; body: string; attachment: AttachmentUpload }, principal: AttachmentPrincipal) => {
    const service = options.service();
    if (!service) throw new AttachmentError("attachments_unavailable");
    if (input.actorId !== principal.actorId) throw new AttachmentError("attachment_forbidden", 403);
    // Check authority before creating a DM. It is checked again at canonical admission.
    service.assertLocalActor(principal);
    await options.ensureOperator();
    const conversation = await options.conversation(principal.actorId, options.operatorActorId);
    const result = await service.postOperatorNotification({ requestId: input.requestId,
      conversationId: conversation.id, body: input.body, attachments: [input.attachment] }, principal);
    if (!result.duplicate) options.queueSignal({
      signal: { kind: "notify", blocking: false, replyExpectation: "none" },
      messageId: result.message.id, conversationId: result.message.conversationId,
      requesterId: principal.actorId, requesterNodeId: principal.nodeId, body: result.message.body,
      ...options.requester(principal.actorId), createdAt: result.message.createdAt,
    });
    return result;
  };
}

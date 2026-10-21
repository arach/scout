import type { MessageBlobRef } from "./attachments.js";
import type {
  DeliveryPolicy,
  DeliveryReason,
  MetadataMap,
  ScoutId,
  VisibilityScope,
} from "./common.js";

export type MessageClass = "agent" | "log" | "system" | "status" | "artifact";

export interface MessageSpeechDirective {
  text: string;
  voice?: string;
  interruptible?: boolean;
}

export interface MessageAttachment {
  id: ScoutId;
  mediaType: string;
  fileName?: string;
  /** Typed canonical binding; absent for legacy URL-only attachments. */
  blob?: MessageBlobRef;
  blobKey?: string;
  url?: string;
  metadata?: MetadataMap;
}

export interface MessageMention {
  actorId: ScoutId;
  label?: string;
}

export interface MessageAudience {
  visibleTo?: ScoutId[];
  notify?: ScoutId[];
  invoke?: ScoutId[];
  reason?: DeliveryReason;
  /** Persist the message without scheduling any transport deliveries. */
  delivery?: "none";
}

export interface MessageRecord {
  /** Requester-scoped idempotency key for client posts. */
  requestId?: ScoutId;
  id: ScoutId;
  conversationId: ScoutId;
  actorId: ScoutId;
  originNodeId: ScoutId;
  class: MessageClass;
  body: string;
  replyToMessageId?: ScoutId;
  threadConversationId?: ScoutId;
  mentions?: MessageMention[];
  attachments?: MessageAttachment[];
  speech?: MessageSpeechDirective;
  audience?: MessageAudience;
  visibility: VisibilityScope;
  policy: DeliveryPolicy;
  createdAt: number;
  metadata?: MetadataMap;
}

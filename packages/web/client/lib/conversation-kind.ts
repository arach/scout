import type { SessionEntry } from "./types.ts";

type ConversationBacking = Partial<Pick<SessionEntry, "kind" | "sessionId" | "harnessSessionId" | "participants" | "participantIds">>;

/**
 * Backing, not operator membership or title, determines Session vs Chat.
 * Broker sessionId and harnessSessionId are aliases, not two sessions. An
 * explicit broker id wins only when the session participants agree (or are
 * absent). Multiple distinct participant session ids are ambiguous: keep them
 * in Chats rather than steering an arbitrary member. A legacy direct with only
 * a harness id is a Session. Channels/group directs remain Chats: their
 * sessionId/harnessSessionId describe the latest worker, not exclusive backing. Unresolved
 * directs and empty/incomplete records stay Chats until one backing is known.
 */
export function conversationSessionId(conversation: ConversationBacking | null | undefined): string | null {
  if (!conversation || (conversation.kind && conversation.kind !== "direct")) return null;
  const explicit = conversation.sessionId?.trim() || null;
  const members = [...new Set((conversation.participants ?? [])
    .filter((p) => p.kind === "session")
    .map((p) => p.sessionId?.trim()).filter((id): id is string => !!id))];
  if (members.length > 1) return null;
  if (explicit && members.length === 1 && explicit !== members[0] && conversation.harnessSessionId?.trim() !== members[0]) return null;
  return explicit ?? members[0] ?? (conversation.kind === "direct" ? conversation.harnessSessionId?.trim() || null : null);
}
export function classifyConversation(conversation: ConversationBacking | null | undefined): "session" | "chat" {
  return conversationSessionId(conversation) ? "session" : "chat";
}

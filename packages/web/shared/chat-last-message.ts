/**
 * The last thing said in a chat conversation, as the sidebar row shows it.
 *
 * Both servers that feed the chat client (local `/api/chat/bootstrap` and the
 * hosted Worker's space read) pick it with this one function, so a row reads
 * the same whichever served it. Import-free on purpose: the Worker pulls this
 * file in by relative path.
 *
 * Only a root message counts — replies live in threads, and the channel's own
 * feed shows roots — and status notices and deleted messages never stand in
 * for what somebody said.
 */

// A type alias, not an interface, so it stays assignable to the Worker's JSON
// value type (aliases carry an implicit index signature).
export type ChatChannelLastMessage = {
  id: string;
  actorId: string;
  /** The author as the server names them; the client may say "You" instead. */
  authorName: string;
  /** Whitespace collapsed, at most CHAT_LAST_MESSAGE_TEXT_LIMIT characters. */
  text: string;
  createdAt: number;
  /** Set only when the server knows the viewer wrote it under another id. */
  fromViewer?: true;
};

export const CHAT_LAST_MESSAGE_TEXT_LIMIT = 160;

const STATUS_CLASSES = new Set(["status", "system", "log"]);

export interface ChatLastMessageCandidate {
  id: string;
  actorId: string;
  actorName?: string | null;
  body: string;
  createdAt: number;
  class?: string | null;
  metadata?: unknown;
  replyToMessageId?: string | null;
  attachments?: ReadonlyArray<{ fileName?: string }> | null;
}

function isDeleted(metadata: unknown): boolean {
  const correction = (metadata as { chatCorrection?: { deletedAt?: unknown } } | null | undefined)?.chatCorrection;
  return typeof correction?.deletedAt === "number";
}

export function chatLastMessageText(
  body: string,
  attachments?: ReadonlyArray<{ fileName?: string }> | null,
): string {
  const said = body.replace(/\s+/gu, " ").trim();
  const text = said || (attachments?.length
    ? attachments.map((file) => file.fileName?.trim() || "Attachment").join(", ")
    : "");
  if (text.length <= CHAT_LAST_MESSAGE_TEXT_LIMIT) return text;
  return `${text.slice(0, CHAT_LAST_MESSAGE_TEXT_LIMIT - 1).trimEnd()}…`;
}

export function pickChatLastMessage(
  messages: Iterable<ChatLastMessageCandidate>,
  options: { viewerActorIds?: Iterable<string> } = {},
): ChatChannelLastMessage | null {
  let latest: ChatLastMessageCandidate | null = null;
  for (const message of messages) {
    if (message.replyToMessageId) continue;
    if (message.class && STATUS_CLASSES.has(message.class)) continue;
    if (isDeleted(message.metadata)) continue;
    if (!Number.isFinite(message.createdAt)) continue;
    if (!latest
      || message.createdAt > latest.createdAt
      || (message.createdAt === latest.createdAt && message.id > latest.id)) {
      latest = message;
    }
  }
  if (!latest) return null;
  const text = chatLastMessageText(latest.body, latest.attachments);
  if (!text) return null;
  const viewer = new Set(options.viewerActorIds ?? []);
  return {
    id: latest.id,
    actorId: latest.actorId,
    authorName: latest.actorName?.trim() || latest.actorId,
    text,
    createdAt: latest.createdAt,
    ...(viewer.has(latest.actorId) ? { fromViewer: true as const } : {}),
  };
}

import type { MessageRecord } from "@openscout/protocol";
/** Mark only the bounded candidate set, never retain the whole message graph.
 * Missing coverage throws; it must not be interpreted as an empty store. */
export async function markAttachmentReferences(candidates: ReadonlySet<string>, sources: AsyncIterable<MessageRecord>[], conversationExists: (id: string) => boolean, signal?: AbortSignal): Promise<Set<string>> {
  signal?.throwIfAborted();
  const found = new Set<string>();
  for (const source of sources) for await (const message of source) {
    signal?.throwIfAborted();
    if (!conversationExists(message.conversationId)) continue;
    for (const attachment of message.attachments ?? []) if (attachment.blob && candidates.has(attachment.blob.sha256)) found.add(attachment.blob.sha256);
  }
  return found;
}

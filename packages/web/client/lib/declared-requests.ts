import type { OperatorAttentionItem, SessionEntry } from "./types.ts";
import { isDeclaredRequest } from "../screens/requests/requests-model.ts";

/**
 * Asks addressed to the operator exist only when DECLARED: an operator need
 * (`scout ask --operator --question`), a session question, or an approval /
 * permission request. Nothing here is inferred from message text, from a
 * flight's state, or from an agent's reply to the operator's own ask.
 *
 * The source is `/api/operator-attention` (via the operator-requests store),
 * already narrowed by `isDeclaredRequest`.
 */
export type DeclaredRequestIndex = {
  byConversationId: ReadonlyMap<string, OperatorAttentionItem>;
  byAgentId: ReadonlyMap<string, OperatorAttentionItem>;
};

export const EMPTY_DECLARED_REQUEST_INDEX: DeclaredRequestIndex = {
  byConversationId: new Map(),
  byAgentId: new Map(),
};

function keepNewest(map: Map<string, OperatorAttentionItem>, key: string, item: OperatorAttentionItem): void {
  const current = map.get(key);
  if (!current || item.updatedAt > current.updatedAt) map.set(key, item);
}

export function buildDeclaredRequestIndex(
  items: readonly OperatorAttentionItem[],
): DeclaredRequestIndex {
  const byConversationId = new Map<string, OperatorAttentionItem>();
  const byAgentId = new Map<string, OperatorAttentionItem>();
  for (const item of items) {
    if (!isDeclaredRequest(item)) continue;
    const conversationId = item.conversationId?.trim();
    if (conversationId) keepNewest(byConversationId, conversationId, item);
    const agentId = item.agentId?.trim();
    if (agentId) keepNewest(byAgentId, agentId, item);
  }
  return { byConversationId, byAgentId };
}

/** The declared request living in this conversation (canonical or equivalent id). */
export function declaredRequestForSession(
  index: DeclaredRequestIndex,
  session: Pick<SessionEntry, "id" | "equivalentConversationIds">,
): OperatorAttentionItem | undefined {
  let best: OperatorAttentionItem | undefined;
  for (const id of new Set([session.id, ...(session.equivalentConversationIds ?? [])])) {
    const item = index.byConversationId.get(id);
    if (item && (!best || item.updatedAt > best.updatedAt)) best = item;
  }
  return best;
}

/**
 * The request a conversation's pinned card shows: the newest declared request
 * living in any of the conversation's ids. A reply to the operator's own ask
 * is never one — that is not in the declared source at all.
 */
export function selectDeclaredConversationRequest(
  items: readonly OperatorAttentionItem[],
  conversationIds: Iterable<string>,
): OperatorAttentionItem | null {
  const index = buildDeclaredRequestIndex(items);
  let best: OperatorAttentionItem | null = null;
  for (const id of conversationIds) {
    const item = index.byConversationId.get(id);
    if (item && (!best || item.updatedAt > best.updatedAt)) best = item;
  }
  return best;
}

export function declaredRequestForAgentIds(
  index: DeclaredRequestIndex,
  agentIds: Iterable<string>,
): OperatorAttentionItem | undefined {
  let best: OperatorAttentionItem | undefined;
  for (const agentId of agentIds) {
    const item = index.byAgentId.get(agentId);
    if (item && (!best || item.updatedAt > best.updatedAt)) best = item;
  }
  return best;
}

/**
 * Approval vs ask comes from the declaration itself — the item's kind or its
 * declared permission source — never from the wording of the text.
 */
export function isDeclaredApproval(item: OperatorAttentionItem): boolean {
  return item.kind === "approval"
    || item.kind === "configuration"
    || item.id.startsWith("tmux-host-permission:")
    || item.sourceLabel === DECLARED_PERMISSION_SOURCE_LABEL;
}

/** The sourceLabel the server stamps on a need declared with `--permission`. */
export const DECLARED_PERMISSION_SOURCE_LABEL = "Permission request";

/** Rail badge wording: ASK · APPROVAL. */
export function declaredRequestLabel(item: OperatorAttentionItem): "Ask" | "Approval" {
  return isDeclaredApproval(item) ? "Approval" : "Ask";
}

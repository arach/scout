import { useState } from "react";
import { api } from "../../lib/api.ts";
import { receiveRequests, refreshRequests } from "../../lib/operator-requests-store.ts";
import type { OperatorAttentionAction, OperatorAttentionItem, OperatorAttentionState } from "../../lib/types.ts";

/**
 * The two backed decisions on a request: send one of a question's offered
 * answers as the operator's reply, or approve/deny a pairing approval. Shared
 * by the Requests page and Scoutbot so both answer the same way.
 */
export function useRequestActions(item: OperatorAttentionItem, onOpen: (action: OperatorAttentionAction) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const answer = async (option: string) => {
    if (busy || sent || !item.answer) return;
    setBusy(true); setError(null);
    try {
      const { conversationId, replyToMessageId } = item.answer;
      await api("/api/send", { method: "POST", body: JSON.stringify({ body: option, conversationId, replyToMessageId }) });
      setSent(option);
      void refreshRequests();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Answer failed; open the conversation and reply there."); }
    finally { setBusy(false); }
  };
  const act = async (action: OperatorAttentionAction) => {
    if (action.kind === "open" && action.route) { onOpen(action); return; }
    if (busy || !item.approval || (action.kind !== "approve" && action.kind !== "deny")) return;
    setBusy(true); setError(null);
    try {
      const { sessionId, turnId, blockId, version } = item.approval;
      receiveRequests(await api<OperatorAttentionState>("/api/operator-attention/approvals/decide", {
        method: "POST", body: JSON.stringify({ sessionId, turnId, blockId, version, decision: action.kind }),
      }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Decision failed; refresh and try again."); }
    finally { setBusy(false); }
  };
  return { busy, error, sent, answer, act };
}

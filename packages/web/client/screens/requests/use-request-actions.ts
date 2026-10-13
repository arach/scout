import { useRef, useState } from "react";
import { api } from "../../lib/api.ts";
import { receiveRequests, refreshRequests } from "../../lib/operator-requests-store.ts";
import type { OperatorAttentionAction, OperatorAttentionItem, OperatorAttentionState } from "../../lib/types.ts";
import { failedDelivery, type RequestDelivery } from "./request-delivery.ts";

export type { RequestDelivery };

/**
 * Backed decisions: question replies, pairing approvals, and broker-managed
 * live-process permission decisions. Shared
 * by the Requests page and Scoutbot so both answer the same way.
 */
export function useRequestActions(item: OperatorAttentionItem, onOpen: (action: OperatorAttentionAction) => void) {
  const inFlight = useRef(false);
  const recorded = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<RequestDelivery | null>(null);
  const answer = async (option: string) => {
    if (inFlight.current || recorded.current || busy || sent || !item.answer) return;
    inFlight.current = true;
    setBusy(true); setError(null); setDelivery({ state: "sending", label: option });
    try {
      const { conversationId, replyToMessageId } = item.answer;
      await api("/api/send", { method: "POST", body: JSON.stringify({ body: option, conversationId, replyToMessageId }) });
      recorded.current = true;
      setSent(option); setDelivery({ state: "delivered", label: option });
      void refreshRequests();
    } catch (cause) {
      const fallback = "Answer failed; open the conversation and reply there.";
      setError(cause instanceof Error ? cause.message : fallback);
      setDelivery(failedDelivery(option, cause, fallback));
      void refreshRequests();
    }
    finally { inFlight.current = false; setBusy(false); }
  };
  const act = async (action: OperatorAttentionAction) => {
    if (action.kind === "open" && action.route) { onOpen(action); return; }
    if (item.permission && (action.kind === "approve" || action.kind === "deny")) {
      if (inFlight.current || recorded.current || busy || sent) return;
      const decision = action.kind === "deny" ? "deny" : action.value;
      if (decision !== "once" && decision !== "project" && decision !== "deny") return;
      inFlight.current = true;
    setBusy(true); setError(null); setDelivery({ state: "sending", label: action.label });
      try {
        receiveRequests(await api<OperatorAttentionState>("/api/operator-attention/permissions/decide", {
          method: "POST", body: JSON.stringify({ requestId: item.permission.requestId, version: item.permission.version, decision }),
        }));
        recorded.current = true;
        setSent(action.label); setDelivery({ state: "delivered", label: action.label });
      } catch (cause) {
        const fallback = "Decision delivery failed. Open the live session before retrying.";
        setError(cause instanceof Error ? cause.message : fallback);
        setDelivery(failedDelivery(action.label, cause, fallback));
        void refreshRequests();
      }
      finally { inFlight.current = false; setBusy(false); }
      return;
    }
    if (inFlight.current || recorded.current || busy || sent || !item.approval || (action.kind !== "approve" && action.kind !== "deny")) return;
    inFlight.current = true;
    setBusy(true); setError(null); setDelivery({ state: "sending", label: action.label });
    try {
      const { sessionId, turnId, blockId, version } = item.approval;
      receiveRequests(await api<OperatorAttentionState>("/api/operator-attention/approvals/decide", {
        method: "POST", body: JSON.stringify({ sessionId, turnId, blockId, version, decision: action.kind }),
      }));
      recorded.current = true;
      setDelivery({ state: "delivered", label: action.label });
    } catch (cause) {
      const fallback = "Decision failed; refresh and try again.";
      setError(cause instanceof Error ? cause.message : fallback);
      setDelivery(failedDelivery(action.label, cause, fallback));
      void refreshRequests();
    }
    finally { inFlight.current = false; setBusy(false); }
  };
  return { busy, error, sent, delivery, answer, act };
}

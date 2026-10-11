import type { OperatorAttentionAction, OperatorAttentionItem } from "../../lib/types.ts";

/** A live item keeps its place when severity, age, or badge state changes. */
export function stableRequestItems(previous: readonly OperatorAttentionItem[], incoming: readonly OperatorAttentionItem[]): OperatorAttentionItem[] {
  const byId = new Map(incoming.map((item) => [item.id, item]));
  const result: OperatorAttentionItem[] = [];
  for (const item of previous) {
    const current = byId.get(item.id);
    if (current) { result.push(current); byId.delete(item.id); }
  }
  return [...result, ...byId.values()];
}

export function requestsCountState(count: number) {
  const value = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return { count: value, attention: value > 0 };
}

/**
 * Requests lists only what the broker declared as waiting on the operator:
 * approvals, questions addressed to them, and permission prompts (including a
 * harness prompt observed in a terminal). Work items,
 * delivery failures and inferred session states never count (operator rule:
 * inferred "needs you" is usually wrong).
 */
export function isDeclaredRequest(item: OperatorAttentionItem): boolean {
  if (item.id.startsWith("tmux-host-permission:")) return true; // a harness permission prompt on screen
  return item.kind === "approval" || item.kind === "question" || item.kind === "configuration";
}

export function requestKind(item: OperatorAttentionItem): string {
  if (item.kind === "approval") return "Approval";
  if (item.kind === "configuration" || item.id.startsWith("tmux-host-permission:") || /permission/i.test(item.sourceLabel)) return "Permission request";
  // The attention API also includes failures, which are not answerable asks.
  if (item.kind === "ask" || (item.kind === "session" && /action|error|failure/i.test(item.sourceLabel))) return "Notice";
  return "Ask";
}

/** No invented answer/permission decision buttons: only backed approval decisions and source links. */
export function requestActions(item: OperatorAttentionItem): OperatorAttentionAction[] {
  return item.actions.filter((action) => {
    if (action.kind === "open") return Boolean(action.route);
    return item.kind === "approval" && Boolean(item.approval)
      && (action.kind === "approve" || action.kind === "deny");
  });
}

export function requestActionLabel(action: OperatorAttentionAction): string {
  if (action.kind === "open" && action.route
    && (action.route.view === "conversation" || action.route.view === "messages"
      || (action.route.view === "follow" && action.route.preferredView === "chat"))) return "Open conversation";
  return action.label;
}

export function requestUpdatedAge(updatedAt: number, now: number): string {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return "Update time unavailable";
  const minutes = Math.floor(Math.max(0, now - updatedAt) / 60_000);
  if (minutes < 60) return `updated ${minutes}m ago`;
  if (minutes < 48 * 60) return `updated ${Math.floor(minutes / 60)}h ago`;
  return `updated ${Math.floor(minutes / 1440)}d ago`;
}

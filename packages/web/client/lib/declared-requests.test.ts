import { describe, expect, test } from "bun:test";

import {
  buildDeclaredRequestIndex,
  declaredRequestForAgentIds,
  declaredRequestForSession,
  declaredRequestLabel,
  isDeclaredApproval,
  selectDeclaredConversationRequest,
} from "./declared-requests.ts";
import type { OperatorAttentionItem } from "./types.ts";

function item(overrides: Partial<OperatorAttentionItem> & Pick<OperatorAttentionItem, "id" | "kind">): OperatorAttentionItem {
  return {
    title: "Which database should the export target?",
    summary: null,
    detail: null,
    agentId: "agent-1",
    agentName: "Agent One",
    conversationId: "chn-1",
    updatedAt: 1_000,
    severity: "warning",
    sourceLabel: "Question",
    actions: [],
    ...overrides,
  };
}

describe("declared requests", () => {
  test("only declared kinds become requests — work items, asks and session notices never do", () => {
    const index = buildDeclaredRequestIndex([
      // The operator's own dispatch handed back for review.
      item({ id: "work_item:work-1", kind: "work_item", conversationId: "chn-review", sourceLabel: "Work item" }),
      item({ id: "ask:inv-1", kind: "ask", conversationId: "chn-ask", sourceLabel: "Ask delivery" }),
      item({ id: "session:x", kind: "session", conversationId: "chn-session", sourceLabel: "Session" }),
      item({ id: "need:m1", kind: "question", conversationId: "chn-need" }),
    ]);
    expect([...index.byConversationId.keys()]).toEqual(["chn-need"]);
  });

  test("a conversation with only the agent's reply to the operator's ask pins nothing", () => {
    const items = [item({ id: "work_item:work-replied", kind: "work_item", conversationId: "chn-8d91", sourceLabel: "Work item" })];
    expect(selectDeclaredConversationRequest(items, ["chn-8d91"])).toBeNull();
  });

  test("resolves a session's declared request through its equivalent conversation ids", () => {
    const index = buildDeclaredRequestIndex([
      item({ id: "need:old", kind: "question", conversationId: "chn-a", updatedAt: 1_000 }),
      item({ id: "need:new", kind: "question", conversationId: "chn-b", updatedAt: 2_000 }),
    ]);
    expect(declaredRequestForSession(index, { id: "chn-a", equivalentConversationIds: ["chn-b"] })?.id).toBe("need:new");
    expect(declaredRequestForSession(index, { id: "chn-z" })).toBeUndefined();
    expect(declaredRequestForAgentIds(index, ["agent-1"])?.id).toBe("need:new");
    expect(selectDeclaredConversationRequest(
      [item({ id: "need:a", kind: "question", conversationId: "chn-a" })],
      new Set(["chn-x", "chn-a"]),
    )?.id).toBe("need:a");
  });

  test("approval comes from the declaration, never the wording", () => {
    // Words like "approve" or "permission" in a plain question stay an ask.
    const wordy = item({ id: "need:m2", kind: "question", title: "Should I approve the permission gate and proceed?" });
    expect(isDeclaredApproval(wordy)).toBe(false);
    expect(declaredRequestLabel(wordy)).toBe("Ask");

    expect(isDeclaredApproval(item({ id: "approval:1", kind: "approval", sourceLabel: "codex approval" }))).toBe(true);
    expect(isDeclaredApproval(item({ id: "need:m3", kind: "question", sourceLabel: "Permission request" }))).toBe(true);
    expect(declaredRequestLabel(item({ id: "approval:2", kind: "approval" }))).toBe("Approval");
  });
});

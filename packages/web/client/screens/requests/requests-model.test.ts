import { describe, expect, test } from "bun:test";
import type { OperatorAttentionItem } from "../../lib/types.ts";
import { isDeclaredRequest, requestActions, requestActionLabel, requestKind, requestsCountState, requestUpdatedAge, stableRequestItems } from "./requests-model.ts";
const item = (id: string, overrides: Partial<OperatorAttentionItem> = {}): OperatorAttentionItem => ({
  id, kind: "question", title: "Question", summary: null, detail: null, agentId: null, agentName: null,
  conversationId: null, updatedAt: 60_000, severity: "info", sourceLabel: "question", actions: [], ...overrides,
});

describe("Requests projection", () => {
  test("zero and invalid counts are neutral; only positive counts request orange", () => {
    expect(requestsCountState(0)).toEqual({ count: 0, attention: false });
    expect(requestsCountState(-1)).toEqual({ count: 0, attention: false });
    expect(requestsCountState(NaN)).toEqual({ count: 0, attention: false });
    expect(requestsCountState(3)).toEqual({ count: 3, attention: true });
  });
  test("live rows hold their place despite incoming severity sorting", () => {
    const a = item("a"); const b = item("b"); const litA = item("a", { severity: "critical" });
    expect(stableRequestItems([a, b], [b, litA, item("c")]).map(row => row.id)).toEqual(["a", "b", "c"]);
    expect(stableRequestItems([a, b], [b, litA])[0]).toBe(litA);
    expect(stableRequestItems([a, b], [b]).map(row => row.id)).toEqual(["b"]);
  });
  test("only real source links and backed pairing decisions are offered", () => {
    const actions = [{ kind: "approve", label: "Approve" }, { kind: "deny", label: "Deny" },
      { kind: "copy", label: "Copy", value: "command" }, { kind: "dismiss", label: "Dismiss" },
      { kind: "open", label: "Open", route: { view: "conversation", conversationId: "c" } },
      { kind: "open", label: "Broken link" }] as OperatorAttentionItem["actions"];
    expect(requestActions(item("q", { actions })).map(action => action.kind)).toEqual(["open"]);
    expect(requestActionLabel(actions[4]!)).toBe("Open conversation");
    const approval = { sessionId: "s", sessionName: "session", adapterType: "codex", turnId: "t", blockId: "b", version: 1,
      risk: "low", title: "Run?", description: "command", detail: null, actionKind: "command", actionStatus: "pending" } as const;
    expect(requestActions(item("p", { kind: "approval", approval, actions })).map(action => action.kind)).toEqual(["approve", "deny", "open"]);
  });
  test("source terminology and timestamps do not fabricate waiting duration", () => {
    expect(requestKind(item("a", { kind: "approval" }))).toBe("Approval");
    expect(requestKind(item("p", { sourceLabel: "permission" }))).toBe("Permission request");
    expect(requestKind(item("q"))).toBe("Ask");
    expect(requestKind(item("failure", { kind: "ask" }))).toBe("Notice");
    expect(requestUpdatedAge(60_000, 240_000)).toBe("updated 3m ago");
    expect(requestUpdatedAge(0, 240_000)).toBe("Update time unavailable");
    expect(requestUpdatedAge(0 + 1, 1 + 5 * 3_600_000)).toBe("updated 5h ago");
    expect(requestUpdatedAge(1, 1 + 4 * 86_400_000)).toBe("updated 4d ago");
  });
});

test("only declared kinds are requests", () => {
  const kinds = ["approval", "question", "configuration", "work_item", "ask", "session"] as const;
  const declared = kinds.filter((kind) => isDeclaredRequest({ id: `x:${kind}`, kind } as never));
  expect(declared).toEqual(["approval", "question", "configuration"]);
});

test("declared permission decisions retain the exact native scopes", () => {
  const permission = item("permission:p", { sourceLabel: "Permission request",
    permission: { requestId: "p", version: "v", sessionId: "s", projectRoot: "/p" },
    actions: [{ kind: "approve", label: "Allow once", value: "once" }, { kind: "approve", label: "Allow for project", value: "project" }, { kind: "deny", label: "Deny", value: "deny" }],
  });
  expect(isDeclaredRequest(permission)).toBe(true); expect(requestKind(permission)).toBe("Permission request");
  expect(requestActions(permission).map(action => action.value)).toEqual(["once", "project", "deny"]);
});

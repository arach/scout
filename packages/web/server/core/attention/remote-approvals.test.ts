import { describe, expect, test } from "bun:test";

import type { ScoutRemoteApprovalNode } from "../broker/service.ts";
import { parseRemoteApprovalSessionId, remoteApprovalItems } from "./operator-attention-state.ts";

const approval = {
  sessionId: "s1",
  sessionName: "fix tests",
  adapterType: "claude-code",
  turnId: "t1",
  blockId: "b1",
  version: 2,
  risk: "high" as const,
  title: "Approve Command",
  description: "rm -rf build",
  detail: "rm -rf build",
  actionKind: "command",
};

function node(state: ScoutRemoteApprovalNode["state"]): ScoutRemoteApprovalNode {
  return { nodeId: "mini-openscout", label: "mini", state, approvals: [approval], truncated: false, updatedAt: 5 };
}

describe("remote approvals", () => {
  test("live approvals become answerable items labelled with their machine", () => {
    const [item] = remoteApprovalItems([node("live")]);
    expect(item).toMatchObject({
      id: "remote:mini-openscout:approval:s1:t1:b1:v2",
      kind: "approval",
      severity: "critical",
      sourceLabel: "claude-code approval · mini",
      approval: { sessionId: "remote:mini-openscout:s1", version: 2 },
    });
    expect(item!.actions.map((action) => action.kind)).toEqual(["approve", "deny"]);
  });

  test("a stale link shows nothing to answer", () => {
    expect(remoteApprovalItems([node("stale"), node("not_shared")])).toEqual([]);
  });

  test("the origin machine travels in the sessionId, never inferred", () => {
    expect(parseRemoteApprovalSessionId("remote:mini-openscout:s1")).toEqual({ nodeId: "mini-openscout", sessionId: "s1" });
    expect(parseRemoteApprovalSessionId("remote:a%3Ab:s:1")).toEqual({ nodeId: "a:b", sessionId: "s:1" });
    expect(parseRemoteApprovalSessionId("s1")).toBeNull();
    expect(parseRemoteApprovalSessionId("remote::s1")).toBeNull();
  });
});

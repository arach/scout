import { expect, mock, test } from "bun:test";
// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const React = await import("../../../node_modules/react/index.js");
// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const runtime = await import("../../../node_modules/react/jsx-runtime.js");
// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const devRuntime = await import("../../../node_modules/react/jsx-dev-runtime.js");
// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const { renderToStaticMarkup } = await import("../../../node_modules/react-dom/server.node.js");
mock.module("react", () => React);
mock.module("react/jsx-runtime", () => runtime);
mock.module("react/jsx-dev-runtime", () => devRuntime);
import type { OperatorAttentionItem } from "../../lib/types.ts";
const { RequestsScreen } = await import("./RequestsScreen.tsx");
const { receiveRequests } = await import("../../lib/operator-requests-store.ts");
const render = (items: OperatorAttentionItem[]) => {
  receiveRequests({ generatedAt: 1, totals: { all: items.length, approvals: 0, configuration: 0, collaboration: items.length }, items });
  return renderToStaticMarkup(React.createElement(RequestsScreen, { navigate: () => {} }));
};
const ask: OperatorAttentionItem = { id: "question:1", kind: "question", title: "Review first?", summary: "Plan stage 2", detail: "Real detail", agentId: "a", agentName: "fab",
  conversationId: "c", updatedAt: 60_000, severity: "warning", sourceLabel: "Question", actions: [
    { kind: "open", label: "Open", route: { view: "conversation", conversationId: "c" } },
    { kind: "dismiss", label: "Dismiss" },
    { kind: "approve", label: "Fake approval" },
  ] };

test("Open draws source text and only backed links; no invented answer or decision", () => {
  const markup = render([ask]);
  for (const text of ["Ask", "fab", "Review first?", "Real detail", "Open conversation"]) expect(markup).toContain(text);
  expect(markup).not.toContain("Fake approval");
  expect(markup).not.toContain(">Dismiss<");
  expect(markup).not.toContain(">Answer<");
  expect(markup).not.toMatch(/\bwaiting \d+m\b/);
  expect(markup).not.toContain(">History<");
});
test("empty Open does not fabricate a history or settled-today section", () => {
  const markup = render([]);
  expect(markup).toContain("No open requests");
  expect(markup).not.toContain("Settled today");
  expect(markup).not.toContain(">History<");
  expect(markup).toContain('data-attention="false"');
});
test("permission observation opens its real terminal instead of unbacked Allow once", () => {
  const markup = render([{ ...ask, id: "tmux-host-permission:a:s", kind: "session", sourceLabel: "Claude terminal prompt",
    actions: [{ kind: "open", label: "Open terminal", route: { view: "terminal" } }] }]);
  expect(markup).toContain("Permission request");
  expect(markup).toContain("Open terminal");
  expect(markup).not.toContain("Allow once");
});
test("a declared question offers its own options as one-tap answers", () => {
  const markup = render([{ ...ask, id: "need:m1", answer: { conversationId: "chn-1", replyToMessageId: "m1", options: ["Looks right", "Needs work"] } }]);
  expect(markup).toContain(">Looks right<");
  expect(markup).toContain(">Needs work<");
  expect(markup).toContain("Open conversation");
});

test("managed permissions render backed decisions without a redesign", () => {
  const markup = render([{ ...ask, id: "permission:p", sourceLabel: "Permission request", title: "Permission request",
    permission: { requestId: "p", version: "v", sessionId: "s", projectRoot: "/p" },
    actions: [{ kind: "approve", label: "Allow once", value: "once" }, { kind: "approve", label: "Allow for project", value: "project" }, { kind: "deny", label: "Deny", value: "deny" }],
  }]);
  for (const label of ["Allow once", "Allow for project", "Deny"]) expect(markup).toContain(label);
  expect(markup).not.toContain("Needs you");
});

import { expect, mock, test } from "bun:test";
// @ts-expect-error Tests bypass this package's type-only React path aliases.
const React = await import("../../../node_modules/react/index.js");
// @ts-expect-error Tests bypass this package's type-only React path aliases.
const jsx = await import("../../../node_modules/react/jsx-runtime.js");
// @ts-expect-error Tests bypass this package's type-only React path aliases.
const jsxDev = await import("../../../node_modules/react/jsx-dev-runtime.js");
// @ts-expect-error Tests load the React DOM runtime directly.
const { renderToStaticMarkup } = await import("../../../node_modules/react-dom/server.node.js");
mock.module("react", () => React);
mock.module("react/jsx-runtime", () => jsx);
mock.module("react/jsx-dev-runtime", () => jsxDev);
const { SessionSteerComposer, SessionSteeredList, steerShortcut, unobservedSteers } = await import("./SessionSteer.tsx");
const defaults = { draft: "change this", onChange: () => {}, submit: () => {}, working: false, busy: false, available: true, reason: "Ready" };
const render = (props = {}) => renderToStaticMarkup(React.createElement(SessionSteerComposer, { ...defaults, ...props }));

test("idle composer uses the Codex rounded-box hooks and a bottom-right Steer arrow", () => {
  const html = render();
  expect(html).toContain('class="s-session-composer-box"');
  expect(html).toContain('placeholder="Ask for follow-up changes"');
  expect(html).toContain('class="s-session-composer-tools"');
  expect(html).toContain('aria-label="Steer"');
  expect(html).not.toContain("disabled");
  for (const absent of ["Ask through Scout", "Delivery mode", "Undo", "Apply", "Queue", "Attach", "branch"]) expect(html).not.toContain(absent);
});
test.each(["More than one live process holds this session.", "No verified remote path.", "Checking the live session…"])("disabled composer shows one reason: %s", (reason) => {
  const html = render({ available: false, reason });
  expect(html).toContain(reason); expect(html).toContain('class="s-session-steer-reason"');
  expect(html).toMatch(/<textarea[^>]*disabled/u);
  expect(html).toMatch(/<button[^>]*disabled/u);
  expect(html).not.toContain("Ask through Scout");
});
test("while working, the primary control becomes the backed Stop and a draft can Steer", () => {
  const html = render({ working: true, interrupt: () => {} });
  expect(html).toContain('aria-label="Stop"'); expect(html).toContain(">Steer</button>");
  expect(html).not.toContain('aria-label="Steer"');
});
test("unsupported Interrupt is omitted; it is never a fake stop button", () => {
  const html = render({ working: true });
  expect(html).not.toContain('aria-label="Stop"'); expect(html).toContain(">Steer</button>");
});
test("busy and empty states cannot send; busy Stop is disabled too", () => {
  expect(render({ draft: "  " })).toMatch(/<button[^>]*disabled/u);
  const busy = render({ busy: true, working: true, interrupt: () => {} });
  expect(busy).toMatch(/aria-label="Stop"[^>]*disabled/u);
  expect(busy).toMatch(/<textarea[^>]*disabled/u);
});
test("a failed send leaves its draft visible with the error", () => {
  const html = render({ error: "Binding changed." });
  expect(html).toContain("change this</textarea>"); expect(html).toContain("Binding changed. Your draft has been kept.");
});
test("mid-turn accepted input is shown above the composer without claiming harness consumption", () => {
  const pending = [{ id: "a", text: "steer now", duringTurn: true, observedIds: ["old"] }];
  const html = render({ working: true, pending });
  expect(html).toContain("Steered · awaiting transcript"); expect(html.indexOf("steer now")).toBeLessThan(html.indexOf("<form"));
  expect(unobservedSteers(pending, [{ id: "old", text: "steer now" }])).toEqual(pending);
  expect(unobservedSteers(pending, [{ id: "new", text: "steer now" }])).toEqual([]);
});
test("Enter steers, Shift+Enter adds a line, and IME composition never sends", () => {
  let sent = 0, prevented = 0;
  const event = (extra = {}) => ({ key: "Enter", preventDefault: () => prevented++, ...extra }) as Parameters<typeof steerShortcut>[0];
  steerShortcut(event(), () => sent++);
  steerShortcut(event({ shiftKey: true }), () => sent++);
  steerShortcut(event({ nativeEvent: { isComposing: true } }), () => sent++);
  expect(sent).toBe(1); expect(prevented).toBe(1);
});
test("inspector exposes accepted/refused audit metadata and explicit loading/error/empty states", () => {
  const list = (props: object) => renderToStaticMarkup(React.createElement(SessionSteeredList, props));
  expect(list({ entries: null })).toContain("Loading…");
  expect(list({ entries: [] })).toContain("No steering recorded.");
  expect(list({ entries: null, error: "Audit unavailable." })).toContain("Audit unavailable.");
  const entry = { id: "one", at: "2026-10-11T00:00:00Z", operator: "Arach", machine: "here", serverHost: "mini", outcome: "accepted", reason: "Input accepted", textLength: 10, textSha256: "abc", target: { host: "tmux", address: "%8", pid: 100 } };
  const html = list({ entries: [entry, { ...entry, id: "two", outcome: "refused", target: null }] });
  expect(html).toContain("Steered · Arach"); expect(html).toContain("Refused · Arach");
  expect(html).toContain("PID 100"); expect(html).toContain("SHA-256"); expect(html).toContain("10 characters");
});

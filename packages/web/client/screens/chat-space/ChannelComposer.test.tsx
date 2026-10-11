/**
 * The composer's polish is only polish if the boundary still shows and every
 * control in the toolbar is real. These tests pin both: the structure a person
 * sees (roomy field, quiet toolbar, round send) and the promise the surface
 * makes (no affordance that does nothing, formatting the feed can paint,
 * no send that fires on an empty draft).
 */

import { describe, expect, mock, test } from "bun:test";

// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const React = await import("../../../node_modules/react/index.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxRuntime = await import("../../../node_modules/react/jsx-runtime.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxDevRuntime = await import("../../../node_modules/react/jsx-dev-runtime.js");
// @ts-expect-error Bun tests load React DOM's runtime entrypoint directly to avoid local TS path aliases.
const ReactDomServer = await import("../../../node_modules/react-dom/server.node.js");
const { createElement } = React;
const { renderToStaticMarkup } = ReactDomServer;

mock.module("react", () => React);
mock.module("react/jsx-runtime", () => ReactJsxRuntime);
mock.module("react/jsx-dev-runtime", () => ReactJsxDevRuntime);

import type { ChannelMemberReception, ChannelMemberView } from "./chat-api.ts";

const { ChannelComposer, mentionInsertion } = await import("./ChannelComposer.tsx");

const NOW = new Date(2026, 8, 16, 14, 0, 0, 0).getTime();

const reception = (overrides: Partial<ChannelMemberReception> = {}): ChannelMemberReception => ({
  state: "ready_to_receive",
  routeKind: "persistent",
  listening: true,
  summary: "Ready to receive",
  detail: "Attached to session ses-1 over a persistent route.",
  evidenceAt: NOW - 120_000,
  attachedSessionId: "ses-1",
  redeemedAt: NOW - 3_600_000,
  ...overrides,
});

const maya: ChannelMemberView = {
  actorId: "actor-maya",
  kind: "person",
  displayName: "Maya",
  reception: reception({ routeKind: "none", listening: false, state: "waiting_for_agent" }),
};

const codex: ChannelMemberView = {
  actorId: "actor-codex",
  kind: "agent",
  displayName: "Codex",
  harness: "codex",
  owner: { actorId: "actor-maya", displayName: "Maya" },
  reception: reception(),
};

const composer = (overrides: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(ChannelComposer, {
      members: [maya, codex],
      draft: "",
      onDraftChange: () => {},
      askTargetId: null,
      onAskTargetChange: () => {},
      onSend: () => {},
      sending: false,
      error: null,
      placeholder: "Message #build",
      ...overrides,
    }),
  );

describe("ChannelComposer toolbar", () => {
  test("is a roomy field over a quiet toolbar, closed by a round send", () => {
    const html = composer();
    expect(html).toContain('class="chat-composer" data-variant="channel"');
    expect(html).toContain('class="chat-composer-input"');
    expect(html).toContain('class="chat-composer-tools"');
    expect(html).toContain('class="chat-composer-send"');
    // The send is the only filled control; the toolbar carries no button box.
    expect(html).not.toContain("btn--primary");
  });

  test("carries no affordance that does nothing", () => {
    const html = composer().toLowerCase();
    expect(html).toContain("attach a file");
    // Emoji is wired: it types at the caret from the reaction set.
    expect(html).toContain('aria-label="insert emoji"');
    // Recording is offered only where the browser can record; the server
    // render has no MediaRecorder, so no clip control is drawn.
    for (const absent of ["record", "microphone", "voice"]) {
      expect(html).not.toContain(absent);
    }
    expect(html).toContain('aria-label="run a shortcut"');
    expect(html).toContain('aria-label="hide formatting"');
    expect(html).toContain('aria-label="bold ⌘b"');
  });

  test("the send does not fire on an empty draft without files, and wakes on text", () => {
    expect(composer({ draft: "" })).toContain(
      '<button type="button" class="chat-composer-send" disabled=""',
    );
    expect(composer({ draft: "   \n  " })).toContain(
      '<button type="button" class="chat-composer-send" disabled=""',
    );
    const ready = composer({ draft: "ship it" });
    expect(ready).toContain('class="chat-composer-send"');
    expect(ready).not.toContain('class="chat-composer-send" disabled=""');
  });

  test("an icon-only control still says what it is", () => {
    const html = composer();
    expect(html).toContain('aria-label="Mention a member"');
    expect(html).toContain('title="Mention a member"');
    expect(html).toContain('aria-label="Send to the channel"');
  });

  test("sending is visible on the send itself, and nothing else claims it", () => {
    const html = composer({ draft: "ship it", sending: true });
    expect(html).toContain("chat-composer-spin");
    expect(html).toContain('aria-label="Sending…"');
    expect(html).toContain('class="chat-composer-send" disabled=""');
    // The field and the tools go with it — no half-editable composer.
    expect(html).toMatch(/class="chat-composer-input"[^>]*aria-disabled="true"/u);
    expect(html).toMatch(/class="chat-composer-tool chat-composer-tool--icon" disabled=""/u);
  });

  test("a send failure gets its own line instead of squeezing the toolbar", () => {
    const html = composer({ draft: "ship it", error: "That did not send." });
    expect(html).toContain('<p class="chat-send-error" role="alert">That did not send.</p>');
  });
});

describe("ChannelComposer routing boundary", () => {
  test("a recovered target that is no longer present cannot silently become a channel post", () => {
    const html = composer({ draft: "Run the release", askTargetId: "departed-agent" });
    expect(html).toContain("The selected agent is unavailable");
    expect(html).toContain("Post to channel instead");
    expect(html).toContain('class="chat-composer-send" disabled=""');
  });
  test("untargeted: the ask selector reads as an invitation, not a warning", () => {
    const html = composer();
    expect(html).toContain("Ask an agent");
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-expanded="false"');
    // Nothing is asked yet, so nothing is claimed about tracked work.
    expect(html).not.toContain("Creates a tracked request");
    expect(html).not.toContain("chat-ask-target");
  });

  test("targeted: the armed control names the agent and the hint states the boundary", () => {
    const html = composer({ draft: "check the build", askTargetId: "actor-codex" });
    // The agent is named once, on the control that armed it — not again in a
    // banner chip beside it.
    expect(html).toContain('data-armed="true"');
    // The control is an icon (the agent's face); its tooltip names who.
    expect(html).toContain('title="Change agent — currently asking Maya&#x27;s Codex"');
    expect(html).toContain("Creates a tracked request for Maya&#x27;s Codex");
    expect(html).toContain("reply lands in this thread");
    expect(html).toContain("Change agent");
    // Send carries the mode, says where it is going, and the target stays clearable.
    expect(html).toContain('data-mode="ask"');
    expect(html).toContain("aria-label=\"Ask Maya&#x27;s Codex — creates a tracked request\"");
    // Enter-to-send is assumed, not captioned.
    expect(html).not.toContain("newline");
    expect(html).toContain("Clear ask target");
  });

  test("thread: agent selection is available while ordinary replies remain explicit", () => {
    const html = composer({ variant: "thread", placeholder: "Reply in thread…" });
    expect(html).toContain('data-variant="thread"');
    expect(html).toContain("Ask an agent");
    expect(html).not.toContain("Change agent");
    expect(html).not.toContain("chat-enter");
    // Mentioning a member is still real in a thread: the feed highlights it.
    expect(html).toContain('aria-label="Mention a member"');
    expect(html).toContain('aria-label="Send reply"');
  });
});

test("thread asks keep their target and block a departed agent", () => {
  const targeted = composer({ variant: "thread", draft: "Check this reply", askTargetId: "actor-codex" });
  expect(targeted).toContain('data-mode="ask"');
  expect(targeted).toContain("Creates a tracked request");
  const unavailable = composer({ variant: "thread", draft: "Check this reply", askTargetId: "departed" });
  expect(unavailable).toContain("Post reply instead");
  expect(unavailable).toContain('class="chat-composer-send" disabled=""');
});

describe("mentionInsertion", () => {
  test("an empty draft just gets the @", () => {
    expect(mentionInsertion("", 0)).toEqual({ next: "@", caret: 1 });
  });

  test("mid-word, it supplies the space the token needs to be recognised", () => {
    expect(mentionInsertion("hi", 2)).toEqual({ next: "hi @", caret: 4 });
  });

  test("after whitespace, it adds none of its own", () => {
    expect(mentionInsertion("hi ", 3)).toEqual({ next: "hi @", caret: 4 });
    expect(mentionInsertion("hi\n", 3)).toEqual({ next: "hi\n@", caret: 3 + 1 });
  });

  test("it types at the caret, not at the end", () => {
    expect(mentionInsertion("hi there", 2)).toEqual({ next: "hi @ there", caret: 4 });
  });

  test("a caret outside the draft is clamped, never used to slice past the end", () => {
    expect(mentionInsertion("hi", 99)).toEqual({ next: "hi @", caret: 4 });
    expect(mentionInsertion("hi", -1)).toEqual({ next: "@hi", caret: 1 });
  });
});

test("an empty agent request explains the required instructions", () => {
  const html = composer({ askTargetId: codex.actorId, draft: "  " });
  expect(html).toContain("Add instructions for the agent before sending.");
  expect(html).toMatch(/class="chat-composer-send"[^>]*disabled=""/);
  expect(composer({ askTargetId: codex.actorId, draft: "Review this file" })).not.toContain("Add instructions for the agent before sending.");
});

const { FORMATS, formatShortcut } = await import("./composer-formats.tsx");
import { filterShortcuts } from "./composer-shortcuts.ts";
describe("approved composer", () => {
 test("ten marks in order, above the one-line editor", () => {
  const html = composer();
  let previous = -1;
  for (const format of FORMATS) { const at = html.indexOf(`aria-label="${format.label}"`); expect(at).toBeGreaterThan(previous); previous = at; }
  expect(previous).toBeLessThan(html.indexOf('class="chat-composer-input"'));
 });
 test("slash opens and filters; SOON commands are disabled", () => {
  const html = composer({ draft: "/", onInvite: () => {}, onDirect: () => {} });
  expect(html).toContain('aria-label="Shortcuts"');
  expect(html).toContain('SOON');
  expect(html).toMatch(/disabled=""[^>]*class="chat-shortcut-row"/);
  expect(composer({ draft: "/in" })).toContain('/invite');
  expect(composer({ draft: "/in" })).not.toContain('/topic');
  expect(filterShortcuts('/ask @codex question').map(command => command.name)).toEqual(['/ask']);
 });
 test("Slack modifier grammar", () => {
  expect(formatShortcut({ metaKey: true, ctrlKey: false, shiftKey: true, altKey: true, key: 'c', code: 'KeyC' })).toBe('block');
  expect(formatShortcut({ metaKey: true, ctrlKey: false, shiftKey: true, altKey: false, key: '&', code: 'Digit7' })).toBe('ol');
 });
});

test("mic stays on the right next to send; the editor opens at one line", async () => {
 const source = await Bun.file(new URL('./ChannelComposer.tsx', import.meta.url)).text();
 const right = source.slice(source.indexOf('<span className="chat-composer-right">'));
 expect(right.indexOf('aria-label="Record an audio clip"')).toBeGreaterThan(0);
 expect(right.indexOf('aria-label="Record an audio clip"')).toBeLessThan(right.indexOf('className="chat-composer-send"'));
 const css = await Bun.file(new URL('./chat-space.css', import.meta.url)).text();
 expect(css).toContain('min-height: 42px;');
 expect(css).toContain('line-height: 22px;');
});

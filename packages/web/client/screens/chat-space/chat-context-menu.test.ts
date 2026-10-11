import { describe, expect, test } from "bun:test";

import {
  bindChatContextMenu,
  chatContextMenuEntries,
  contextMenuStaysNative,
  controlFromButton,
  markElementForInspect,
  type ChatContextSnapshot,
} from "./chat-context-menu.ts";

const blank: ChatContextSnapshot = {
  selection: "",
  field: null,
  linkHref: null,
  media: null,
  messageText: null,
  controls: [],
  channel: null,
  activateLabel: null,
};

function labels(snapshot: ChatContextSnapshot): string[] {
  return chatContextMenuEntries(snapshot).flatMap((entry) => entry.kind === "action" ? [entry.label] : ["—"]);
}

describe("context menu gesture", () => {
  test("option-click and shift-click stay with the browser", () => {
    expect(contextMenuStaysNative({ altKey: true, shiftKey: false })).toBe(true);
    expect(contextMenuStaysNative({ altKey: false, shiftKey: true })).toBe(true);
    expect(contextMenuStaysNative({ altKey: false, shiftKey: false })).toBe(false);
  });
});

describe("control labels", () => {
  test("turns message buttons into menu rows", () => {
    expect(controlFromButton("Reply in thread to Arach", false)?.label).toBe("Reply in thread");
    expect(controlFromButton("Save message privately", false)?.label).toBe("Save message");
    expect(controlFromButton("Remove from saved messages", false)?.label).toBe("Remove from saved");
    expect(controlFromButton("Pin for everyone in channel", false)?.label).toBe("Pin to channel");
    expect(controlFromButton("Unpin from channel", false)?.label).toBe("Unpin from channel");
    expect(controlFromButton("Edit message", false)?.label).toBe("Edit message");
    expect(controlFromButton("Delete message", false)).toMatchObject({ label: "Delete message", tone: "danger" });
    expect(controlFromButton("React with 👍", false)?.label).toBe("React 👍");
    expect(controlFromButton("React with 👍", true)?.label).toBe("Remove 👍");
    expect(controlFromButton("More emoji", false)).toBeNull();
    expect(controlFromButton("More actions", false)).toBeNull();
    expect(controlFromButton("Fewer emoji", false)).toBeNull();
    expect(controlFromButton("Open Arach's member card", false)?.label).toBe("View member");
    expect(controlFromButton("❤️ 1 from You, including you. Remove your reaction.", true)).toMatchObject({
      id: "react:❤️",
      label: "Remove ❤️",
    });
    expect(controlFromButton("🔥 2 from Ada. React with 🔥.", false)?.label).toBe("React 🔥");
  });
});

describe("chatContextMenuEntries", () => {
  test("a message lists its actions, then Inspect", () => {
    expect(labels({
      ...blank,
      messageText: "Hello there",
      controls: [
        { id: "delete", label: "Delete message", group: "delete", tone: "danger" },
        { id: "reply", label: "Reply in thread", group: "reply" },
        { id: "open-thread", label: "Open thread", group: "thread" },
        { id: "react:👍", label: "React 👍", group: "react" },
        { id: "save", label: "Save message", group: "save" },
        { id: "permalink", label: "Copy link", group: "permalink" },
        { id: "edit", label: "Edit message", group: "edit" },
      ],
    })).toEqual([
      "Reply in thread",
      "Copy message",
      "Copy link",
      "Save message",
      "React 👍",
      "Edit message",
      "Delete message",
      "—",
      "Inspect",
    ]);
  });

  test("keeps Open thread when the message cannot start a reply", () => {
    expect(labels({
      ...blank,
      messageText: "Note",
      controls: [{ id: "open-thread", label: "Open thread", group: "thread" }],
    })).toEqual(["Open thread", "Copy message", "—", "Inspect"]);
  });

  test("a partial selection is its own Copy", () => {
    expect(labels({ ...blank, selection: "there", messageText: "Hello there" })[0]).toBe("Copy");
  });

  test("selecting the whole message does not add a second Copy", () => {
    expect(labels({ ...blank, selection: "", messageText: "Hello there" })).not.toContain("Copy");
  });

  test("a text field offers editing, not message actions", () => {
    expect(labels({
      ...blank,
      field: { selected: true, locked: false },
      messageText: "Hello there",
      controls: [{ id: "reply", label: "Reply in thread", group: "reply" }],
    })).toEqual(["Cut", "Copy", "Paste", "Select all", "—", "Inspect"]);
    expect(labels({ ...blank, field: { selected: false, locked: true } })).toEqual(["Select all", "—", "Inspect"]);
  });

  test("a link and the same image share one address", () => {
    const href = "https://example.com/a.png";
    expect(labels({ ...blank, linkHref: href, media: { src: href, kind: "image" } })).toEqual([
      "Open link",
      "Copy link address",
      "—",
      "Inspect",
    ]);
  });

  test("a different image is listed beside the link", () => {
    expect(labels({
      ...blank,
      linkHref: "https://example.com/post",
      media: { src: "https://cdn.example.com/a.png", kind: "image" },
    })).toContain("Open image");
  });

  test("a channel row can open, copy its name, and copy its link", () => {
    expect(labels({
      ...blank,
      channel: { label: "#intro-check", href: "http://chat.local/chat?channel=chn-1", current: false },
    })).toEqual(["Open", "Copy name", "Copy link", "—", "Inspect"]);
    expect(labels({
      ...blank,
      channel: { label: "#intro-check", href: "http://chat.local/chat?channel=chn-1", current: true },
    })).not.toContain("Open");
  });

  test("empty space is still Inspect", () => {
    expect(labels(blank)).toEqual(["Inspect"]);
    expect(chatContextMenuEntries(blank).at(-1)).toMatchObject({ shortcut: "Opt" });
  });

  test("a button outside a message uses its own name", () => {
    expect(labels({ ...blank, activateLabel: "Invite someone" })).toEqual(["Invite someone", "—", "Inspect"]);
  });
});

describe("bindChatContextMenu", () => {
  test("reads a message and marks the node for Inspect", () => {
    if (typeof document === "undefined") return;
    const turn = document.createElement("article");
    turn.className = "chat-turn";
    turn.innerHTML = `
      <div class="chat-turn-body">Hello there</div>
      <button type="button" aria-label="Reply in thread to Arach">reply</button>
      <button type="button" aria-label="Save message privately">save</button>
      <button type="button" aria-label="More emoji">more</button>
      <button type="button" aria-label="React with 👍" aria-pressed="false">👍</button>
      <button type="button" class="chat-reaction" aria-label="👍 1 from Ada. React with 👍.">1</button>
      <button type="button" aria-label="Delete message">delete</button>
      <a href="https://example.com/note">note</a>
    `;
    document.body.append(turn);
    const link = turn.querySelector("a")!;
    const bound = bindChatContextMenu(link, "");
    expect(bound.entries.map((entry) => entry.kind === "action" ? entry.label : "—")).toEqual([
      "Open link",
      "Copy link address",
      "Reply in thread",
      "Copy message",
      "Save message",
      "React 👍",
      "Delete message",
      "—",
      "Inspect",
    ]);
    expect(bound.entries.find((entry) => entry.kind === "action" && entry.id === "delete")).toMatchObject({ tone: "danger" });
    let clicked = "";
    turn.querySelector<HTMLButtonElement>("[aria-label='Reply in thread to Arach']")!.onclick = () => { clicked = "reply"; };
    bound.run("reply");
    expect(clicked).toBe("reply");
    bound.run("inspect");
    expect(link.getAttribute("data-scout-inspect")).toBe("true");
    markElementForInspect(turn);
    expect(turn.getAttribute("data-scout-inspect")).toBe("true");
    turn.remove();
  });
});

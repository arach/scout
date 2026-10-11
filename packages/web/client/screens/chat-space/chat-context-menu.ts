import { copyTextToClipboard } from "../../lib/clipboard.ts";
import { insertTextAtCaret } from "./chat-rich-text.ts";

/**
 * Right-click menu for Scout Chat.
 *
 * The page cannot open the browser's element inspector. Option-click and
 * Shift-click are left to the browser, and Inspect marks the node and tells a
 * host hook when one exists (`window.inspect` or `webkit.messageHandlers.scoutInspect`).
 */

export type ChatMenuEntry =
  | { kind: "separator" }
  | { kind: "action"; id: string; label: string; shortcut?: string; tone?: "danger" };

export type ChatControlGroup =
  | "reply"
  | "thread"
  | "permalink"
  | "save"
  | "pin"
  | "react"
  | "edit"
  | "delete"
  | "other";

export type ChatContextControl = {
  id: string;
  label: string;
  group: ChatControlGroup;
  tone?: "danger";
};

export type ChatContextSnapshot = {
  selection: string;
  field: { selected: boolean; locked: boolean } | null;
  linkHref: string | null;
  media: { src: string; kind: "image" | "video" | "audio" } | null;
  messageText: string | null;
  controls: ChatContextControl[];
  channel: { label: string; href: string; current: boolean } | null;
  activateLabel: string | null;
};

const GROUP_ORDER: ChatControlGroup[] = [
  "reply", "thread", "permalink", "save", "pin", "react", "edit", "delete", "other",
];

export function contextMenuStaysNative(input: { altKey: boolean; shiftKey: boolean }): boolean {
  return input.altKey || input.shiftKey;
}

export function controlFromButton(ariaLabel: string, pressed: boolean): ChatContextControl | null {
  const label = ariaLabel.trim();
  if (!label || label === "More emoji" || label === "Fewer emoji" || label === "More actions") return null;
  if (label.startsWith("React with ")) {
    const emoji = label.slice("React with ".length).trim();
    if (!emoji) return null;
    return {
      id: `react:${emoji}`,
      label: pressed ? `Remove ${emoji}` : `React ${emoji}`,
      group: "react",
    };
  }
  if (label.startsWith("Reply in thread")) return { id: "reply", label: "Reply in thread", group: "reply" };
  if (label.startsWith("Open thread")) return { id: "open-thread", label: "Open thread", group: "thread" };
  if (label.startsWith("Copy link to this message")) return { id: "copy-message-link", label: "Copy link", group: "permalink" };
  if (label === "Save message privately") return { id: "save", label: "Save message", group: "save" };
  if (label === "Remove from saved messages") return { id: "unsave", label: "Remove from saved", group: "save" };
  if (label === "Pin for everyone in channel") return { id: "pin", label: "Pin to channel", group: "pin" };
  if (label === "Unpin from channel") return { id: "unpin", label: "Unpin from channel", group: "pin" };
  if (label === "Edit message") return { id: "edit", label: "Edit message", group: "edit" };
  if (label === "Delete message") return { id: "delete", label: "Delete message", group: "delete", tone: "danger" };
  if (label.endsWith("Remove your reaction.")) {
    const emoji = label.slice(0, label.indexOf(" ")).trim();
    if (!emoji) return null;
    return { id: `react:${emoji}`, label: `Remove ${emoji}`, group: "react" };
  }
  const addReaction = label.match(/\. React with (.+)\.$/u);
  if (addReaction?.[1]) {
    const emoji = addReaction[1].trim();
    return { id: `react:${emoji}`, label: `React ${emoji}`, group: "react" };
  }
  if (label.startsWith("Open ") && label.endsWith("'s member card")) {
    return { id: "member", label: "View member", group: "other" };
  }
  return { id: `button:${label}`, label: clipLabel(label), group: "other" };
}

export function chatContextMenuEntries(snapshot: ChatContextSnapshot): ChatMenuEntry[] {
  if (snapshot.field) {
    const items: ChatMenuEntry[] = [];
    if (snapshot.field.selected) {
      if (!snapshot.field.locked) items.push(action("cut", "Cut", "⌘X"));
      items.push(action("copy", "Copy", "⌘C"));
    }
    if (!snapshot.field.locked) items.push(action("paste", "Paste", "⌘V"));
    items.push(action("select-all", "Select all", "⌘A"));
    return withInspect(items);
  }

  const items: ChatMenuEntry[] = [];
  if (snapshot.selection) items.push(action("copy-selection", "Copy", "⌘C"));
  if (snapshot.linkHref) {
    items.push(action("open-link", "Open link"));
    items.push(action("copy-link", "Copy link address"));
  }
  if (snapshot.media && snapshot.media.src !== snapshot.linkHref) {
    const name = snapshot.media.kind;
    items.push(action("open-media", `Open ${name}`));
    items.push(action("copy-media", `Copy ${name} address`));
  }

  const onMessage = snapshot.messageText !== null || snapshot.controls.length > 0;
  if (snapshot.channel && !onMessage) {
    if (!snapshot.channel.current) items.push(action("open-channel", "Open"));
    items.push(action("copy-channel-name", "Copy name"));
    items.push(action("copy-channel-link", "Copy link"));
  } else if (snapshot.activateLabel && !onMessage) {
    items.push(action("activate", snapshot.activateLabel));
  }

  const controls = orderedControls(snapshot.controls);
  const reply = controls.filter((control) => control.group === "reply" || control.group === "thread");
  const rest = controls.filter((control) => control.group !== "reply" && control.group !== "thread");
  for (const control of reply) items.push(controlAction(control));
  if (snapshot.messageText) items.push(action("copy-message", "Copy message"));
  for (const control of rest) items.push(controlAction(control));
  return withInspect(items);
}

export function bindChatContextMenu(target: Element, selectionText: string): {
  entries: ChatMenuEntry[];
  run: (id: string) => void;
} {
  const bound = collectChatContext(target, selectionText);
  const entries = chatContextMenuEntries(bound.snapshot);
  return {
    entries,
    run(id: string) {
      bound.run(id);
    },
  };
}

function collectChatContext(target: Element, selectionText: string) {
  const field = editingField(target);
  const turn = field ? null : target.closest("article.chat-turn");
  const row = field || turn ? null : target.closest<HTMLElement>("[data-channel-id]");
  const link = field ? null : linkHref(target);
  const media = field ? null : mediaSource(target);
  const messageText = turn ? messageBodyText(turn) : null;
  const controls = turn ? controlsIn(turn) : [];
  const channel = row ? channelSnapshot(row) : null;
  const activate = !field && !turn && !row ? activatable(target) : null;
  const fieldState = field ? fieldSelection(field) : null;
  const selection = field ? "" : selectionText.trim();
  const actions = new Map<string, () => void>();

  if (field && fieldState) {
    const locked = fieldIsLocked(field);
    if (fieldState.text.length > 0 && !locked) actions.set("cut", () => cutField(field, fieldState));
    if (fieldState.text.length > 0) actions.set("copy", () => { void copyTextToClipboard(fieldState.text); });
    if (!locked) actions.set("paste", () => { void pasteField(field, fieldState); });
    actions.set("select-all", () => selectAll(field));
  }
  if (selection) actions.set("copy-selection", () => { void copyTextToClipboard(selectionText); });
  if (link) {
    actions.set("open-link", () => openHref(link));
    actions.set("copy-link", () => { void copyTextToClipboard(link); });
  }
  if (media && media.src !== link) {
    actions.set("open-media", () => openHref(media.src));
    actions.set("copy-media", () => { void copyTextToClipboard(media.src); });
  }
  if (channel && !turn) {
    actions.set("open-channel", () => { if (row instanceof HTMLElement) row.click(); });
    actions.set("copy-channel-name", () => { void copyTextToClipboard(channel.label); });
    actions.set("copy-channel-link", () => { void copyTextToClipboard(channel.href); });
  }
  if (activate) actions.set("activate", () => activate.click());
  for (const control of controls) {
    actions.set(control.id, () => control.button.click());
  }
  if (messageText) actions.set("copy-message", () => { void copyTextToClipboard(messageText); });
  actions.set("inspect", () => markElementForInspect(target));

  const snapshot: ChatContextSnapshot = {
    selection: selection && selection !== (messageText ?? "") ? selection : "",
    field: field ? { selected: (fieldState?.text.length ?? 0) > 0, locked: fieldIsLocked(field) } : null,
    linkHref: link,
    media,
    messageText,
    controls: controls.map(({ id, label, group, tone }) => ({ id, label, group, tone })),
    channel,
    activateLabel: activate ? accessibleName(activate) : null,
  };
  return { snapshot, run: (id: string) => actions.get(id)?.() };
}

const inspectTimers = new WeakMap<Element, number>();

export function markElementForInspect(element: Element): void {
  element.setAttribute("data-scout-inspect", "true");
  if (element instanceof HTMLElement) {
    element.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  const view = element.ownerDocument.defaultView;
  const previous = inspectTimers.get(element);
  if (previous !== undefined) view?.clearTimeout(previous);
  const timer = view?.setTimeout(() => {
    element.removeAttribute("data-scout-inspect");
    inspectTimers.delete(element);
  }, 1600);
  if (timer !== undefined) inspectTimers.set(element, timer);
  notifyInspectHost(element);
}

function notifyInspectHost(element: Element): void {
  const host = element.ownerDocument.defaultView as (Window & {
    inspect?: (node: Element) => void;
    webkit?: { messageHandlers?: { scoutInspect?: { postMessage: (body: unknown) => void } } };
  }) | null;
  if (!host) return;
  try {
    if (typeof host.inspect === "function") host.inspect(element);
  } catch {
    // The page cannot open DevTools. The mark still shows which node was chosen.
  }
  try {
    host.webkit?.messageHandlers?.scoutInspect?.postMessage({
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
    });
  } catch {
    // No native handler is registered.
  }
}

function orderedControls(controls: ChatContextControl[]): ChatContextControl[] {
  const hasReply = controls.some((control) => control.group === "reply");
  return controls
    .filter((control) => !(hasReply && control.group === "thread"))
    .map((control, index) => ({ control, index }))
    .sort((left, right) => GROUP_ORDER.indexOf(left.control.group) - GROUP_ORDER.indexOf(right.control.group) || left.index - right.index)
    .map(({ control }) => control);
}

function controlsIn(turn: Element): Array<ChatContextControl & { button: HTMLButtonElement }> {
  const seen = new Map<string, number>();
  const controls: Array<ChatContextControl & { button: HTMLButtonElement }> = [];
  for (const button of turn.querySelectorAll<HTMLButtonElement>("button")) {
    if (button.disabled || button.closest(".chat-reaction-sheet")) continue;
    const aria = button.getAttribute("aria-label")?.trim() ?? "";
    const named = aria
      ? controlFromButton(aria, button.getAttribute("aria-pressed") === "true")
      : controlFromText(button.innerText || button.textContent || "");
    if (!named) continue;
    // The reaction chip and the picker both toggle the same emoji.
    if (named.group === "react" && seen.has(named.id)) continue;
    const count = seen.get(named.id) ?? 0;
    seen.set(named.id, count + 1);
    const id = count === 0 ? named.id : `${named.id}:${count}`;
    controls.push({ ...named, id, button });
  }
  return controls;
}

function controlFromText(text: string): ChatContextControl | null {
  const label = text.replace(/\s+/g, " ").trim();
  if (!label || label.length > 40) return null;
  return { id: `text:${label}`, label, group: "other" };
}

function editingField(target: Element): HTMLElement | null {
  const field = target.closest("textarea, input, [contenteditable='true'], [contenteditable='']");
  if (!(field instanceof HTMLElement)) return null;
  if (field instanceof HTMLInputElement) {
    const textual = ["text", "search", "url", "email", "password", "tel", "number", ""];
    if (!textual.includes(field.type)) return null;
  }
  return field;
}

function fieldIsLocked(field: HTMLElement): boolean {
  if (field.getAttribute("aria-disabled") === "true") return true;
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    return field.disabled || field.readOnly;
  }
  return field.getAttribute("contenteditable") === "false";
}

function fieldSelection(field: HTMLElement): { text: string; input: { start: number; end: number } | null; range: Range | null } {
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    const start = field.selectionStart ?? 0;
    const end = field.selectionEnd ?? start;
    return { text: field.value.slice(start, end), input: { start, end }, range: null };
  }
  const selection = field.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.anchorNode || !field.contains(selection.anchorNode)) {
    return { text: "", input: null, range: null };
  }
  return { text: selection.toString(), input: null, range: selection.getRangeAt(0).cloneRange() };
}

function cutField(field: HTMLElement, state: { text: string; input: { start: number; end: number } | null; range: Range | null }): void {
  void copyTextToClipboard(state.text);
  restoreField(field, state);
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    const start = state.input?.start ?? 0;
    const end = state.input?.end ?? start;
    field.setRangeText("", start, end, "end");
    field.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  try {
    state.range?.deleteContents();
    field.dispatchEvent(new InputEvent("input", { bubbles: true }));
  } catch {
    // The selection no longer points at the field.
  }
}

async function pasteField(field: HTMLElement, state: { input: { start: number; end: number } | null; range: Range | null }): Promise<void> {
  let text = "";
  try {
    text = await navigator.clipboard.readText();
  } catch {
    return;
  }
  if (!text) return;
  restoreField(field, state);
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    const start = field.selectionStart ?? state.input?.start ?? field.value.length;
    const end = field.selectionEnd ?? state.input?.end ?? start;
    field.setRangeText(text, start, end, "end");
    field.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  insertTextAtCaret(field, text);
  field.dispatchEvent(new InputEvent("input", { bubbles: true }));
}

function selectAll(field: HTMLElement): void {
  field.focus();
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    field.select();
    return;
  }
  const range = field.ownerDocument.createRange();
  range.selectNodeContents(field);
  const selection = field.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function restoreField(field: HTMLElement, state: { input: { start: number; end: number } | null; range: Range | null }): void {
  field.focus();
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    if (state.input) field.setSelectionRange(state.input.start, state.input.end);
    return;
  }
  if (!state.range) return;
  const selection = field.ownerDocument.getSelection();
  selection?.removeAllRanges();
  try {
    selection?.addRange(state.range);
  } catch {
    // The range was detached by a re-render.
  }
}

function linkHref(target: Element): string | null {
  const anchor = target.closest("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  const raw = anchor.getAttribute("href")?.trim();
  if (!raw) return null;
  return safeHref(anchor.href || raw, anchor.baseURI);
}

function mediaSource(target: Element): { src: string; kind: "image" | "video" | "audio" } | null {
  const image = target instanceof HTMLImageElement ? target : target.closest("img");
  if (image instanceof HTMLImageElement) {
    const src = safeHref(image.currentSrc || image.getAttribute("src") || "", image.baseURI);
    return src ? { src, kind: "image" } : null;
  }
  const video = target.closest("video");
  if (video instanceof HTMLVideoElement) {
    const src = safeHref(video.currentSrc || video.getAttribute("src") || "", video.baseURI);
    return src ? { src, kind: "video" } : null;
  }
  const audio = target.closest("audio");
  if (audio instanceof HTMLAudioElement) {
    const src = safeHref(audio.currentSrc || audio.getAttribute("src") || "", audio.baseURI);
    return src ? { src, kind: "audio" } : null;
  }
  return null;
}

function messageBodyText(turn: Element): string | null {
  const body = turn.querySelector(".chat-turn-body");
  if (!(body instanceof HTMLElement)) return null;
  const text = (body.innerText || body.textContent || "").trim();
  return text || null;
}

function channelSnapshot(row: HTMLElement): { label: string; href: string; current: boolean } | null {
  const id = row.dataset.channelId?.trim();
  const label = (row.getAttribute("aria-label") || row.dataset.channelId || "").trim();
  if (!id || !label) return null;
  const view = row.ownerDocument.defaultView;
  if (!view) return null;
  const url = new URL(view.location.href);
  url.searchParams.set("channel", id);
  url.searchParams.delete("message");
  return { label, href: url.toString(), current: row.getAttribute("aria-current") === "true" };
}

function activatable(target: Element): HTMLElement | null {
  const control = target.closest<HTMLElement>("button, [role='button']");
  if (!control || control.closest("a[href]")) return null;
  return accessibleName(control) ? control : null;
}

function accessibleName(element: HTMLElement): string {
  const aria = element.getAttribute("aria-label")?.trim();
  if (aria) return clipLabel(aria);
  const title = element.getAttribute("title")?.trim();
  if (title) return clipLabel(title);
  return clipLabel((element.innerText || element.textContent || "").replace(/\s+/g, " ").trim());
}

function safeHref(href: string, base: string): string | null {
  if (!href.trim()) return null;
  try {
    const url = new URL(href, base || "http://localhost/");
    if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "mailto:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function openHref(href: string): void {
  const safe = safeHref(href, href);
  if (!safe) return;
  window.open(safe, "_blank", "noopener,noreferrer");
}

function clipLabel(label: string): string {
  return label.length > 48 ? `${label.slice(0, 45)}…` : label;
}

function action(id: string, label: string, shortcut?: string, tone?: "danger"): ChatMenuEntry {
  return { kind: "action", id, label, ...(shortcut ? { shortcut } : {}), ...(tone ? { tone } : {}) };
}

function controlAction(control: ChatContextControl): ChatMenuEntry {
  return action(control.id, control.label, undefined, control.tone);
}

function withInspect(items: ChatMenuEntry[]): ChatMenuEntry[] {
  if (items.length > 0) items.push({ kind: "separator" });
  items.push(action("inspect", "Inspect", "Opt"));
  return items;
}

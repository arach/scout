/* Glass mode in the Mac app (html.scout-glass): the native window owns the
   command bar. ⌘K is caught natively before the page sees it. The rest can
   only be judged here, in the page:
     ":"  outside a field opens the bar to go somewhere.
     "/"  outside a field opens the bar to find a conversation, unless the page already uses "/"
          (Tail, Search and the tables focus their own filter with it).
     Esc  in a field the page leaves alone drops focus, so ":" and "/" work next.
          Outside a field it goes back after the page has had a chance to handle it.
     ⇧Esc in a terminal goes back; plain Esc still belongs to the terminal.
     "i"  outside a field goes back into the last field Esc left (or the
          page's first box), unless the page uses "i" itself (Lanes, Ops).
   Native side: ScoutWebEmbedView glassKeysMessageHandler → ScoutRootView. */

import { isEditableTarget, isTerminalInputTarget as isTerminal } from "./keyboard-nav-core.ts";

type GlassKeysHost = { webkit?: { messageHandlers?: { scoutGlassKeys?: { postMessage: (message: unknown) => void } } } };

function isEditable(target: EventTarget | null): boolean {
  return isEditableTarget(target) || isTerminal(target);
}

function isShown(el: HTMLElement): boolean {
  return el.isConnected && el.getClientRects().length > 0;
}

function firstBox(doc: Document): HTMLElement | null {
  const boxes = doc.querySelectorAll<HTMLElement>(
    "textarea, [contenteditable='true'], input:not([type]), input[type='text'], input[type='search']",
  );
  for (const box of boxes) {
    if (isShown(box) && !isTerminal(box) && !(box as HTMLInputElement).disabled) return box;
  }
  return null;
}

export function installGlassKeys(win: Window = window): () => void {
  let left: HTMLElement | null = null;
  const glass = () => win.document.documentElement.classList.contains("scout-glass");
  const host = () => (win as unknown as GlassKeysHost).webkit?.messageHandlers?.scoutGlassKeys;
  const bare = (event: KeyboardEvent) => !event.metaKey && !event.ctrlKey && !event.altKey;
  const overlayEscapes = new WeakSet<KeyboardEvent>();
  let disposed = false;
  const back = (event: KeyboardEvent) => {
    const handler = host();
    if (!handler) return;
    event.preventDefault();
    event.stopPropagation();
    try { handler.postMessage({ kind: "back" }); } catch { /* The host went away. */ }
  };
  const open = (event: KeyboardEvent, mode: "go" | "find") => {
    const handler = host();
    if (!handler) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      handler.postMessage({ kind: "glass-bar", mode });
    } catch {
      // The host went away; nothing to open.
    }
  };

  // ":" first, ahead of the page.
  const onCapture = (event: KeyboardEvent) => {
    if (!glass() || !bare(event) || event.repeat || event.isComposing) return;
    if (event.key === "Escape") {
      // Remember overlays before their Escape handler removes them. That key
      // must not also navigate the underlying page, even if it wasn't prevented.
      const overlays = win.document.querySelectorAll<HTMLElement>(
        "dialog[open], [role='dialog'], [role='alertdialog'], [role='menu'], [aria-modal='true'], .s-herdr-lightbox",
      );
      if ([...overlays].some(isShown)) overlayEscapes.add(event);
      if (event.shiftKey && isTerminal(event.target) && !overlayEscapes.has(event)) back(event);
    } else if (event.key === ":" && !isEditable(event.target)) {
      open(event, "go");
    }
  };
  // "/" and Esc after the page, so its own uses win.
  const onBubble = (event: KeyboardEvent) => {
    if (!glass() || event.defaultPrevented || !bare(event) || event.repeat || event.isComposing) return;
    if (event.key === "/" && !isEditable(event.target)) {
      open(event, "find");
    } else if (event.key === "Escape" && !event.shiftKey && !isTerminal(event.target)) {
      // Page-level window listeners may have been installed after this one.
      // Defer until the whole key dispatch finishes so their cancellation wins.
      win.queueMicrotask(() => {
        if (disposed || !glass() || event.defaultPrevented || event.cancelBubble || overlayEscapes.has(event)) return;
        if (isEditable(event.target)) {
          if (win.document.activeElement !== event.target) return;
          left = event.target as HTMLElement;
          left.blur();
        } else {
          back(event);
        }
      });
    } else if (event.key === "i" && !event.shiftKey && !isEditable(event.target)) {
      const box = left && isShown(left) ? left : firstBox(win.document);
      if (!box) return;
      event.preventDefault();
      box.focus();
    }
  };
  // Tell the window when a box takes or drops the keyboard, so its corner
  // can say INSERT.
  let inserting = false;
  let inTerminal = false;
  const reportInsert = () => {
    if (disposed || !glass()) return;
    const active = win.document.activeElement;
    const terminal = isTerminal(active);
    const on = isEditable(active);
    if (on === inserting && terminal === inTerminal) return;
    inserting = on;
    inTerminal = terminal;
    try {
      host()?.postMessage({ kind: "insert", on, terminal });
    } catch {
      // The host went away.
    }
  };
  const onFocusChange = () => win.setTimeout(reportInsert, 0);

  win.addEventListener("keydown", onCapture, true);
  win.addEventListener("keydown", onBubble);
  win.addEventListener("focusin", onFocusChange);
  win.addEventListener("focusout", onFocusChange);
  win.addEventListener("focus", onFocusChange);
  onFocusChange();
  return () => {
    disposed = true;
    win.removeEventListener("keydown", onCapture, true);
    win.removeEventListener("keydown", onBubble);
    win.removeEventListener("focusin", onFocusChange);
    win.removeEventListener("focusout", onFocusChange);
    win.removeEventListener("focus", onFocusChange);
  };
}

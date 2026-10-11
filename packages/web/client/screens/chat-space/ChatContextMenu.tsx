import { useEffect, useRef, type ReactNode } from "react";

import { ContextMenuProvider, useContextMenu, type MenuItem } from "../../components/ContextMenu.tsx";
import { bindChatContextMenu, contextMenuStaysNative, type ChatMenuEntry } from "./chat-context-menu.ts";

/** The same rows a right-click builds, so the hover bar can open them too. */
export function messageMenuItems(target: Element, selection = ""): MenuItem[] {
  const bound = bindChatContextMenu(target, selection);
  return bound.entries.flatMap((entry): MenuItem[] => entry.kind === "separator"
    ? [entry]
    : [{
      kind: "action",
      label: entry.label,
      ...(entry.shortcut ? { shortcut: entry.shortcut } : {}),
      ...(entry.tone ? { tone: entry.tone } : {}),
      onSelect: () => bound.run(entry.id),
    }]);
}

/**
 * Right-click anywhere in Scout Chat. Option-click and Shift-click keep the
 * browser menu, which is the way into Inspect Element.
 */
export function ChatContextMenu({ children }: { children: ReactNode }) {
  return (
    <ContextMenuProvider>
      <ChatContextMenuHost>{children}</ChatContextMenuHost>
    </ContextMenuProvider>
  );
}

function ChatContextMenuHost({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const openMenu = useContextMenu();

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".s-context-menu")) {
        event.preventDefault();
        return;
      }
      const root = rootRef.current;
      if (!root || !(target instanceof Node) || !root.contains(target)) return;
      if (contextMenuStaysNative(event)) return;
      if (event.defaultPrevented) return;
      const element = target instanceof Element ? target : target.parentElement;
      if (!element) return;
      const items = messageMenuItems(element, window.getSelection?.()?.toString() ?? "");
      if (!items.some((item) => item.kind === "action")) return;
      openMenu(event, items);
    };
    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, [openMenu]);

  return (
    <div ref={rootRef} className="chat-context-host">
      {children}
    </div>
  );
}

export type { ChatMenuEntry };

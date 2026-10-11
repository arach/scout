import { isAtChatTail } from "./chat-reading-position.ts";

/** Same order the read lane uses, so the cursor and the unread set agree. */
function compareReadMessages(left: { id: string; createdAt: number }, right: { id: string; createdAt: number }): number {
  return left.createdAt - right.createdAt || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

/**
 * A message counts once a readable slice of it is inside the scroller.
 * A one-pixel peek does not. A tall message counts once a line of it shows.
 */
export function messageSliceIsSeen(
  box: { top: number; bottom: number },
  frame: { top: number; bottom: number },
): boolean {
  const visible = Math.min(box.bottom, frame.bottom) - Math.max(box.top, frame.top);
  if (!(visible > 0)) return false;
  if (visible >= 24) return true;
  const height = box.bottom - box.top;
  return height > 0 && visible / height >= 0.5;
}

/** Ids of messages the reader has reached in this scroller, oldest first. */
export function seenMessageIdsInScroller(scroller: HTMLElement): string[] {
  const frame = scroller.getBoundingClientRect();
  if (frame.width <= 0 || frame.height <= 0) return [];
  const nodes = Array.from(scroller.querySelectorAll<HTMLElement>("[data-message-id]"));
  const ids = new Set<string>();
  for (const node of nodes) {
    const id = node.dataset.messageId;
    if (!id) continue;
    if (messageSliceIsSeen(node.getBoundingClientRect(), frame)) ids.add(id);
  }
  // Caught up at the tail: the last message counts even when it sits in the
  // last few pixels of padding.
  if (isAtChatTail(scroller.scrollTop, scroller.scrollHeight, scroller.clientHeight)) {
    const last = nodes.at(-1)?.dataset.messageId;
    if (last) ids.add(last);
  }
  return [...ids];
}

/**
 * The newest message actually reached. The read cursor moves forward to it
 * and no further, so anything still below the screen stays unread. Null when
 * nothing new was seen, or when the saved cursor is not in this page and a
 * guess could move it backwards.
 */
export function readCursorForSeenMessages(input: {
  messages: { id: string; createdAt: number }[];
  seenIds: ReadonlySet<string>;
  lastReadMessageId: string | null;
  /** Unread ids from the lane, used when the saved cursor itself is not on this page. */
  unreadMessageIds?: readonly string[];
}): string | null {
  const ordered = [...input.messages].sort(compareReadMessages);
  const indexOf = new Map(ordered.map((message, index) => [message.id, index]));
  const seenIndexes = [...input.seenIds].flatMap((id) => {
    const index = indexOf.get(id);
    return index === undefined ? [] : [index];
  });
  if (seenIndexes.length === 0) return null;
  const latestIndex = Math.max(...seenIndexes);
  const latest = ordered[latestIndex]!;
  if (latest.id === input.lastReadMessageId) return null;

  const boundaryIndex = input.lastReadMessageId ? indexOf.get(input.lastReadMessageId) : undefined;
  if (input.lastReadMessageId && boundaryIndex !== undefined) {
    return latestIndex > boundaryIndex ? latest.id : null;
  }
  if (!input.lastReadMessageId) return latest.id;

  // The saved message is off this page. The lane's unread ids are the only
  // proof of which way is forward, so a seen message behind them is not a
  // place to put the cursor.
  const unreadIndexes = (input.unreadMessageIds ?? []).flatMap((id) => {
    const index = indexOf.get(id);
    return index === undefined ? [] : [index];
  });
  if (unreadIndexes.length === 0 || latestIndex < Math.min(...unreadIndexes)) return null;
  return latest.id;
}

import { useEffect, useRef, type RefObject } from "react";
import { seenMessageIdsInScroller } from "./chat-seen-read.ts";

const SEEN_READ_DWELL_MS = 800;

/**
 * After the reader rests on a scroller, report the message ids on screen.
 * Scrolling resets the wait, so a flick through history does not mark it read.
 */
export function useReportSeenMessages(
  scroller: RefObject<HTMLElement | null>,
  active: boolean,
  version: string,
  onSeen: (seenIds: string[]) => void,
) {
  const report = useRef(onSeen);
  report.current = onSeen;
  useEffect(() => {
    const node = scroller.current;
    if (!active || !node) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        if (document.visibilityState !== "visible") return;
        report.current(seenMessageIdsInScroller(node));
      }, SEEN_READ_DWELL_MS);
    };
    schedule();
    node.addEventListener("scroll", schedule, { passive: true });
    document.addEventListener("visibilitychange", schedule);
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    resize?.observe(node);
    return () => {
      if (timer) clearTimeout(timer);
      node.removeEventListener("scroll", schedule);
      document.removeEventListener("visibilitychange", schedule);
      resize?.disconnect();
    };
  }, [active, scroller, version]);
}

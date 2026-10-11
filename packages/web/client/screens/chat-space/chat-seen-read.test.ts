import { describe, expect, test } from "bun:test";
import { messageSliceIsSeen, readCursorForSeenMessages } from "./chat-seen-read.ts";

const messages = [
  { id: "a", createdAt: 1 },
  { id: "b", createdAt: 2 },
  { id: "c", createdAt: 3 },
];

describe("messageSliceIsSeen", () => {
  const frame = { top: 0, bottom: 100 };

  test("a line of a tall message counts, and a sliver does not", () => {
    expect(messageSliceIsSeen({ top: 70, bottom: 400 }, frame)).toBe(true);
    expect(messageSliceIsSeen({ top: 96, bottom: 400 }, frame)).toBe(false);
  });

  test("half of a short message counts", () => {
    expect(messageSliceIsSeen({ top: 90, bottom: 110 }, frame)).toBe(true);
  });

  test("a message entirely outside the frame does not count", () => {
    expect(messageSliceIsSeen({ top: -40, bottom: -1 }, frame)).toBe(false);
    expect(messageSliceIsSeen({ top: 120, bottom: 160 }, frame)).toBe(false);
  });
});

describe("readCursorForSeenMessages", () => {
  test("stops at the newest message on screen", () => {
    expect(readCursorForSeenMessages({
      messages,
      seenIds: new Set(["a", "b"]),
      lastReadMessageId: null,
    })).toBe("b");
  });

  test("does not rewind, and does not guess past a cursor missing from the page", () => {
    expect(readCursorForSeenMessages({
      messages,
      seenIds: new Set(["a"]),
      lastReadMessageId: "b",
    })).toBeNull();
    expect(readCursorForSeenMessages({
      messages,
      seenIds: new Set(["c"]),
      lastReadMessageId: "gone",
    })).toBeNull();
    expect(readCursorForSeenMessages({
      messages,
      seenIds: new Set(["b", "c"]),
      lastReadMessageId: "gone",
      unreadMessageIds: ["b", "c"],
    })).toBe("c");
    expect(readCursorForSeenMessages({
      messages,
      seenIds: new Set(["a"]),
      lastReadMessageId: "gone",
      unreadMessageIds: ["b", "c"],
    })).toBeNull();
  });

  test("advances past the saved cursor and stays put when already there", () => {
    expect(readCursorForSeenMessages({
      messages,
      seenIds: new Set(["b", "c"]),
      lastReadMessageId: "a",
    })).toBe("c");
    expect(readCursorForSeenMessages({
      messages,
      seenIds: new Set(["c"]),
      lastReadMessageId: "c",
    })).toBeNull();
  });
});

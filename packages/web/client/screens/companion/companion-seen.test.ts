import { describe, expect, test } from "bun:test";
import { isSeenAsk } from "./companion-seen.ts";
import { askStatus } from "./companion-model.ts";

describe("isSeenAsk", () => {
  const seen = new Map([["w1", 1_000]]);
  test("a dismissed ask stays seen until it moves", () => {
    expect(isSeenAsk(seen, "w1", "question", 1_000)).toBe(true);
    expect(isSeenAsk(seen, "w1", "blocked", 900)).toBe(true);
    expect(isSeenAsk(seen, "w1", "question", 1_001)).toBe(false);
  });
  test("only asks and blockers can be seen", () => {
    expect(isSeenAsk(seen, "w1", "working", 500)).toBe(false);
    expect(isSeenAsk(seen, "w2", "question", 500)).toBe(false);
  });
});

describe("askStatus", () => {
  test("a review request reads as one", () => {
    expect(askStatus("review", "question")).toBe("Ready for review");
    expect(askStatus("waiting", "question")).toBe("Asks you");
    expect(askStatus("review", "waiting")).toBeNull();
  });
});

describe("selectSurfaced with dismissals", () => {
  test("dismissed asks do not take a slot from a live ask", async () => {
    const { selectSurfaced, MAX_SURFACED } = await import("./companion-model.ts");
    const now = 10_000_000;
    const rows = Array.from({ length: MAX_SURFACED + 1 }, (_, i) => ({
      id: `w${i}`, title: `w${i}`, state: "review", ownerId: "a1", ownerName: "A", nextMoveOwnerId: "operator",
      updatedAt: now - (i + 1) * 1_000, lastMeaningfulAt: now - (i + 1) * 1_000, conversationId: null, attention: null,
    }));
    const seen = new Map(rows.slice(0, MAX_SURFACED).map((row) => [row.id, row.updatedAt]));
    const out = selectSurfaced(rows as never, {
      scopes: [{ kind: "agent", id: "a1" }] as never, agents: [{ id: "a1" }], pinnedIds: new Set(), now, seenAsks: seen,
    });
    const live = out.filter((item) => item.needsOperator).map((item) => item.workId);
    expect(live).toEqual([`w${MAX_SURFACED}`]);
  });
});

import { expect, test } from "bun:test";
import { emptyHistoryRotationPlan } from "./history-rotation.js";
import { publishHistoryRotationPages } from "./history-rotation-publication.js";

test("publication collects all bounded pages before giving eviction proof", async () => {
  const plan = emptyHistoryRotationPlan(); plan.messageIds = new Set(["first", "second", "third"]);
  const seen: string[][] = [];
  const result = await publishHistoryRotationPages(plan, async remaining => {
    seen.push([...remaining.messageIds]);
    const id = [...remaining.messageIds][0]!;
    const published = emptyHistoryRotationPlan(); published.messageIds.add(id);
    return { publication: { partition: id, records: [], payloadBytes: 1 }, published, blocked: [] };
  });
  expect(seen).toEqual([["first", "second", "third"], ["second", "third"], ["third"]]);
  expect([...result.published.messageIds]).toEqual([...plan.messageIds]);
  expect(result.publications).toHaveLength(3);
  expect(plan.messageIds.size).toBe(3);
});
test("unpublished or blocked records never become eviction proof and cannot spin", async () => {
  const plan = emptyHistoryRotationPlan(); plan.messageIds.add("blocked"); let calls = 0;
  const result = await publishHistoryRotationPages(plan, async remaining => {
    calls++;
    return { publication: null, published: remaining, blocked: [{ kind: "message", id: "blocked", reason: "unavailable" }] };
  });
  expect(calls).toBe(1); expect(result.published.messageIds.size).toBe(0);
  expect(result.blocked[0]?.reason).toBe("unavailable");
});
test("a failed later publication fails closed before the caller can mark eviction", async () => {
  const plan = emptyHistoryRotationPlan(); plan.messageIds = new Set(["first", "second"]); let calls = 0;
  await expect(publishHistoryRotationPages(plan, async () => {
    if (++calls === 2) throw new Error("disk full");
    const published = emptyHistoryRotationPlan(); published.messageIds.add("first");
    return { publication: { partition: "first", records: [], payloadBytes: 1 }, published, blocked: [] };
  })).rejects.toThrow("disk full");
  expect(plan.messageIds.size).toBe(2);
});

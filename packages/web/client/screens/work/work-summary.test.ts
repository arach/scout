import { describe, expect, test } from "bun:test";
import type { WorkDetail } from "../../lib/types.ts";
import { lastMilestone, workMilestones } from "./work-summary.ts";

function detail(timeline: Partial<WorkDetail["timeline"][number]>[], lastMeaningfulSummary: string | null = null): WorkDetail {
  return {
    timeline: timeline.map((item, index) => ({
      id: `t${index}`, kind: "collaboration_event", at: index, actorId: null, actorName: null, title: null,
      summary: null, detailKind: "progressed", flightId: null, messageId: null, conversationId: null, ...item,
    })),
    lastMeaningfulSummary,
    lastMeaningfulAt: 99,
  } as unknown as WorkDetail;
}

describe("workMilestones", () => {
  test("keeps written milestones oldest first, without the opening or the echoed final reply", () => {
    const work = detail([
      { detailKind: "created", summary: "Review the API", at: 1 },
      { summary: "write-path-reviewed: progress replaced wholesale", at: 3 },
      { summary: "Started: own work resolved by label", at: 2 },
      { summary: "[ask:f-1] Done: full report saved", at: 5 },
      { kind: "flight_completed", summary: "session replied.", at: 4 },
    ]);
    expect(workMilestones(work).map((m) => m.text)).toEqual([
      "Started: own work resolved by label",
      "write-path-reviewed: progress replaced wholesale",
    ]);
    expect(lastMilestone(work)?.text).toBe("write-path-reviewed: progress replaced wholesale");
  });

  test("falls back to the final reply, without its routing tag", () => {
    expect(lastMilestone(detail([], "[ask:f-1] Done: shipped"))?.text).toBe("Done: shipped");
  });
});

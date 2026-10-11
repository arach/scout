import { expect, test } from "bun:test";
import type { AgentLane } from "../agent-lanes-model.ts";
import type { ObserveEvent } from "../../../lib/types.ts";
import { activityPreview } from "./activity-preview.ts";

const now = 1800000000000;
const event = (id: string, at: number, text: string, kind: ObserveEvent["kind"] = "message"): ObserveEvent => ({ id, at, text, kind, t: 0 });
const lane = (events: ObserveEvent[]) => ({ id: "quiet", current: false, agent: { state: "idle" }, facts: { turn: { phase: "complete" }, currentTask: "An older task" }, observe: { events } } as AgentLane);

test("idle and completed agents retain their latest activity even days later", () => {
  const at = now - 3 * 86400000;
  expect(activityPreview(lane([event("last", at, "Finished the texture improvements.")]), now)[0]).toMatchObject({ at, text: "Finished the texture improvements.", label: "Update" });
});
test("chronology wins over input order, task fallback and duplicate deliveries", () => {
  const events = [event("a", now - 60000, "Previous update"), event("b", now - 10000, "Latest update"), event("a", now - 60000, "Previous update")];
  expect(activityPreview(lane(events), now).map(item => item.text)).toEqual(["Latest update", "Previous update"]);
});
test("future, empty metadata and startup events do not replace real history", () => {
  const events = [event("a", now - 3600000, "Last real update"), event("b", now + 120001, "Future"), event("c", now, "<environment_context>hidden</environment_context>"), event("d", now, "Started", "boot")];
  expect(activityPreview(lane(events), now)).toHaveLength(1);
  expect(activityPreview(lane(events), now)[0]?.text).toBe("Last real update");
});
test("session-relative history resolves to wall time without a recent-only cutoff", () => {
  const item = lane([{ id: "relative", text: "Saved changes", kind: "message", t: 30 }]);
  item.observe!.metadata = { session: { sessionStart: now - 7200000 } };
  expect(activityPreview(item, now)[0]?.at).toBe(now - 7170000);
});
test("historical tools do not expose command arguments or claim current work", () => {
  const item = { ...event("command", now - 3600000, "secret output", "tool"), tool: "bash", arg: "private command" };
  expect(activityPreview(lane([item]), now)[0]?.text).toBe("Command execution");
});
test("missing history uses an explicitly untimed last task, or an honest empty state", () => {
  expect(activityPreview(lane([]), now)[0]).toMatchObject({ label: "Last reported task", text: "An older task", at: null });
  const empty = lane([]); empty.facts = undefined;
  expect(activityPreview(empty, now)[0]?.text).toBe("No activity has been recorded for this agent yet.");
});

test("small remote clock skew remains visible, matching the shared age formatter", () => {
  expect(activityPreview(lane([event("skew", now + 90000, "Latest remote update")]), now)[0]).toMatchObject({ text: "Latest remote update", at: now + 90000 });
});

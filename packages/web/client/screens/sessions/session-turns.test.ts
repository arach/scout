import { expect, test } from "bun:test";
import type { ObserveData, ObserveEvent } from "../../lib/types.ts";
import { observedSessionTurns, observedStepCount, observedTurnDuration, sessionWorkLabel, observedFileEdits } from "./session-turns.ts";
const event = (id: string, t: number, kind: ObserveEvent["kind"], extra = {}): ObserveEvent => ({ id, t, kind, text: id, ...extra });
test("observed requests delimit turn summaries and retain tool blocks with diffs", () => {
  const diff = { add: 1, del: 1, preview: "-old\n+new" };
  const data: ObserveData = { files: [], events: [event("ask1", 0, "ask"), event("edit", 12, "tool", { tool: "edit", arg: "src/main.ts", diff }), event("done", 360, "message"), event("ask2", 361, "ask"), event("think", 362, "think")] };
  const turns = observedSessionTurns(data, true);
  expect(turns).toHaveLength(2); expect(turns.map((t) => t.working)).toEqual([false, true]);
  expect(turns[0].steps[0].diff).toEqual(diff); expect(turns[0].messages[0].id).toBe("done");
  expect(observedStepCount(turns[0])).toBe(1); expect(turns[0].fileCount).toBe(1);
  expect(observedTurnDuration(turns[0])).toBe("6m 0s");
});
test.each([
  ["bash", "bun test", "Ran bun test"], ["read", "src/a.ts", "Read src/a.ts"],
  ["edit", "src/a.ts", "Edited src/a.ts"], ["grep", "needle", "Searched needle"],
])("Codex work rows use the actual %s argument", (tool, arg, label) => {
  expect(sessionWorkLabel(event("x", 0, "tool", { tool, arg }))).toBe(label);
});
test("file counts are observed diff evidence, never made-up zeros", () => {
  const counts = observedFileEdits([event("a", 1, "tool", { tool: "edit", arg: "src/a.ts", diff: { add: 3, del: 2, preview: "" } }),
    event("b", 2, "tool", { tool: "edit", arg: "src/a.ts", diff: { add: 1, del: 0, preview: "" } }),
    event("c", 3, "tool", { tool: "write", arg: "src/c.ts" })]);
  expect(counts.get("src/a.ts")).toEqual({ add: 4, del: 2 });
  expect(counts.has("src/c.ts")).toBe(false);
});
test("incomplete leading context is not given an invented prompt", () => {
  const turns = observedSessionTurns({ files: [], events: [event("tool", 0, "tool"), event("result", 1, "tool", { tool: "res" })] }, false);
  expect(turns[0].prompt).toEqual([]); expect(observedStepCount(turns[0])).toBe(1);
  expect(observedSessionTurns({ files: [], events: [] }, false)).toEqual([]);
});
test("agent questions are not requester prompts or turn boundaries", () => {
  const turns = observedSessionTurns({ files: [], events: [event("tool", 0, "tool"), event("question", 60, "ask", { to: "human" }), event("done", 70, "message")] }, false);
  expect(turns).toHaveLength(1); expect(turns[0].boundary).toBe("window");
  expect(turns[0].prompt).toEqual([]); expect(turns[0].messages.map((e) => e.id)).toEqual(["question", "done"]);
});
test("shell command prose is not a file inventory", () => {
  const turns = observedSessionTurns({ files: [], events: [event("command", 0, "tool", { tool: "exec_command", arg: "printf 'many words about a workflow'", detail: "this is not a file path" })] }, false);
  expect(turns[0].fileCount).toBe(0);
});

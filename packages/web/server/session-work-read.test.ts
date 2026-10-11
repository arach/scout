import { beforeEach, describe, expect, test } from "bun:test";

import type { ObserveData } from "../shared/api/observe.ts";
import {
  parseSessionWorkRead,
  readSessionWork,
  resetSessionWorkReadCache,
  sessionWorkDigest,
} from "./session-work-read.ts";
import { promptFromTranscriptLine } from "./session-prompts.ts";

function data(events: ObserveData["events"]): ObserveData {
  return {
    events,
    files: [
      { path: "views/crew-lineup.tsx", state: "modified", touches: 3, lastT: 40 },
      { path: "lib/crew-registry.ts", state: "read", touches: 1, lastT: 10 },
    ],
    live: true,
  };
}

const EVENTS: ObserveData["events"] = [
  { id: "x1", t: 5, kind: "tool", tool: "exec", arg: "cat crew-lineup.tsx", text: "exec" },
  { id: "m1", t: 12, kind: "message", text: "Switching to eye plates." },
];

const PROMPTS = [
  { text: "Make a dozen more crew, bold colors.", at: 1_000 },
  { text: "Correction: expressive means room for the eyes, not colors.", at: 9_000 },
];

const REPLY = JSON.stringify({
  now: "Rendering eye-plate heads. Two of twelve staged.",
  steering: [{ text: "Room for the eyes, not colors", askIndex: 1, supersedes: "bold colors" }, { text: "bad", askIndex: 9 }],
  shape: { goal: "A dozen crew", must: ["eye plate"], mustNot: [], deliver: null },
});

describe("session prompts", () => {
  test("keeps operator prompts and mid-turn messages, drops scaffolding", () => {
    const lines = [
      { type: "user", timestamp: "2026-10-09T04:00:00Z", message: { content: "Make it nicer" } },
      { type: "user", isMeta: true, message: { content: "meta" } },
      { type: "user", message: { content: "<command-name>/clear</command-name>" } },
      { type: "user", message: { content: [{ type: "tool_result", content: "x" }] } },
      { type: "attachment", attachment: { type: "queued_command", prompt: "not an ask", origin: { kind: "human" }, timestamp: "2026-10-09T04:01:00Z" } },
      { type: "response_item", timestamp: "2026-10-09T04:02:00Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Port the world view" }] } },
      { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>…" }] } },
      { type: "user", message: { content: "Hi<system-reminder>noise</system-reminder>" } },
    ].map((line) => promptFromTranscriptLine(JSON.stringify(line)));
    expect(lines.filter(Boolean).map((prompt) => prompt!.text)).toEqual(["Make it nicer", "not an ask", "Port the world view", "Hi"]);
    expect(lines[0]!.at).toBe(Date.parse("2026-10-09T04:00:00Z"));
  });
});

describe("session work read", () => {
  beforeEach(() => resetSessionWorkReadCache());

  test("digest carries prompts in full, tallies tools, never raw output", () => {
    const digest = sessionWorkDigest(data(EVENTS), PROMPTS);
    expect(digest.turn).toBe(2);
    expect(digest.body.prompts.map((p) => p.askIndex)).toEqual([0, 1]);
    expect(digest.body.tools).toEqual({ exec: 1 });
    expect(digest.body.filesChanged).toEqual(["edit views/crew-lineup.tsx (3×)"]);
    expect(digest.body.filesRead).toBe(1);
    expect(digest.body.latestAgentMessage).toBe("Switching to eye plates.");
  });

  test("parse keeps valid steering and maps ask times", () => {
    const read = parseSessionWorkRead(`noise ${REPLY} noise`, [1_000, 9_000]);
    expect(read.steering).toEqual([
      { text: "Room for the eyes, not colors", askIndex: 1, at: 9_000, supersedes: "bold colors" },
      { text: "bad", askIndex: null, at: null, supersedes: null },
    ]);
    expect(read.shape.goal).toBe("A dozen crew");
    expect(read.shape.deliver).toBeNull();
    expect(parseSessionWorkRead('{"now":"x","shape":{"goal":"null"}}', []).shape.goal).toBeNull();
  });

  test("first call is pending, then ready; same turn does not call again", async () => {
    let calls = 0;
    const complete = async () => {
      calls += 1;
      return { text: REPLY, model: "test-mini" };
    };
    const first = await readSessionWork("s1", data(EVENTS), PROMPTS, { complete });
    expect(first.status).toBe("pending");
    const second = await readSessionWork("s1", data(EVENTS), PROMPTS, { complete, wait: true });
    expect(second.status).toBe("ready");
    await readSessionWork("s1", data(EVENTS), PROMPTS, { complete });
    expect(calls).toBe(1);
  });

  test("a new prompt re-reads and serves the previous read as stale meanwhile", async () => {
    let calls = 0;
    const complete = async () => {
      calls += 1;
      return { text: REPLY, model: "test-mini" };
    };
    await readSessionWork("s1", data(EVENTS), PROMPTS, { complete, wait: true });
    const next = [...PROMPTS, { text: "Also add sleepy eyes.", at: 20_000 }];
    const moved = await readSessionWork("s1", data(EVENTS), next, { complete });
    expect(moved.status).toBe("ready");
    expect(moved.status === "ready" && moved.stale).toBe(true);
    expect(calls).toBe(2);
  });

  test("model failure is unavailable with the reason", async () => {
    const complete = async () => {
      throw new Error("no key");
    };
    const result = await readSessionWork("s2", data(EVENTS), PROMPTS, { complete, wait: true });
    expect(result).toEqual({ status: "unavailable", detail: "no key", turn: 2 });
  });
});

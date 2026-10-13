import { describe, expect, test } from "bun:test";

import {
  approvalsForFirstTask,
  EMPTY_FIRST_TASK_STORE,
  firstTaskCandidates,
  firstTaskStorageKey,
  firstTaskExecutionTarget,
  updateFirstTaskScopedState,
  readFirstTaskStore,
  writeFirstTaskStore,
  firstTaskPresentation,
  firstTaskReadiness,
  isTerminalPhase,
  parseFirstTaskStore,
  phaseForFlightState,
  pickFirstTaskResult,
  stepIndexForPhase,
  suggestedFirstTask,
  type FirstTaskObservations,
  type FirstTaskScopedState,
  type FirstTaskRuntime,
} from "./first-task.ts";
import type { Agent } from "../lib/types.ts";

function agent(overrides: Partial<Agent> & { id: string }): Agent {
  return {
    name: overrides.id,
    agentClass: "general",
    harness: "claude",
    state: "available",
    projectRoot: "/Users/me/dev/app",
    project: "app",
    updatedAt: 1,
    retiredFromFleet: false,
    staleLocalRegistration: false,
    ...overrides,
  } as Agent;
}

const claudeReady: FirstTaskRuntime = { id: "claude", label: "Claude Code", state: "ready", loginCommand: "claude login", detail: "" };
const codexMissingLogin: FirstTaskRuntime = { id: "codex", label: "Codex", state: "installed", loginCommand: "codex login", detail: "" };

function observed(overrides: Partial<FirstTaskObservations> = {}): FirstTaskObservations {
  return {
    apiOnline: true,
    brokerReachable: true,
    agentsLoaded: true,
    agents: [agent({ id: "app-claude" })],
    runtimes: [claudeReady, codexMissingLogin],
    projectRoot: "/Users/me/dev/app",
    ...overrides,
  };
}

describe("first-task readiness", () => {
  test("ready only with a reachable broker and a signed-in runtime", () => {
    const readiness = firstTaskReadiness(observed());
    expect(readiness.kind).toBe("ready");
    if (readiness.kind === "ready") expect(readiness.candidates.map((c) => c.agent.id)).toEqual(["app-claude"]);
  });

  test("an unreachable broker blocks sending, whatever the roster says", () => {
    expect(firstTaskReadiness(observed({ brokerReachable: false })).kind).toBe("broker_unreachable");
  });

  test("unknown broker health cannot authorize sending", () => {
    expect(firstTaskReadiness(observed({ brokerReachable: null })).kind).toBe("verification_unavailable");
  });

  test("an offline web API is offline once known, checking before", () => {
    expect(firstTaskReadiness(observed({ apiOnline: false, agentsLoaded: true })).kind).toBe("scout_offline");
    expect(firstTaskReadiness(observed({ apiOnline: false, agentsLoaded: false })).kind).toBe("checking");
  });

  test("an unread runtime catalog stays checking instead of guessing", () => {
    expect(firstTaskReadiness(observed({ runtimes: null })).kind).toBe("checking");
  });

  test("no addressable agent asks for setup", () => {
    expect(firstTaskReadiness(observed({ agents: [] })).kind).toBe("no_agent");
    // Observed sessions, retired agents and the operator are not task targets.
    expect(firstTaskReadiness(observed({
      agents: [
        agent({ id: "native:claude:abc" }),
        agent({ id: "old", retiredFromFleet: true }),
        agent({ id: "me", agentClass: "operator" }),
        agent({ id: "scoutbot" }),
      ],
    })).kind).toBe("no_agent");
  });

  test("agents without a signed-in runtime name the exact login", () => {
    const readiness = firstTaskReadiness(observed({
      agents: [agent({ id: "app-codex", harness: "codex" }), agent({ id: "lib-codex", harness: "codex" })],
    }));
    expect(readiness.kind).toBe("runtime_not_ready");
    if (readiness.kind === "runtime_not_ready") {
      expect(readiness.login).toEqual([{ label: "Codex", command: "codex login" }]);
    }
  });

  test("a harness the catalog does not list is unverified, not ready", () => {
    const readiness = firstTaskReadiness(observed({ agents: [agent({ id: "pi-agent", harness: "pi" })] }));
    expect(readiness.kind).toBe("runtime_not_ready");
  });

  test("ready agents in the set-up project rank first", () => {
    const ranked = firstTaskCandidates(
      [
        agent({ id: "other", projectRoot: "/Users/me/dev/other", updatedAt: 99 }),
        agent({ id: "codex-here", harness: "codex", updatedAt: 100 }),
        agent({ id: "here", projectRoot: "/Users/me/dev/app/", updatedAt: 1 }),
      ],
      [claudeReady, codexMissingLogin],
      "/Users/me/dev/app",
    );
    expect(ranked.map((c) => c.agent.id)).toEqual(["here", "other", "codex-here"]);
  });
});

describe("first-task lifecycle", () => {
  test("broker flight states map to what the operator is told", () => {
    expect(phaseForFlightState("queued")).toBe("accepted");
    expect(phaseForFlightState("waking")).toBe("starting");
    expect(phaseForFlightState("running")).toBe("running");
    expect(phaseForFlightState("waiting")).toBe("awaiting_input");
    expect(phaseForFlightState("completed")).toBe("completed");
    expect(phaseForFlightState("failed")).toBe("failed");
    expect(phaseForFlightState("cancelled")).toBe("cancelled");
    expect(phaseForFlightState("something-new")).toBe("unknown");
    expect(phaseForFlightState(null)).toBe("unknown");
  });

  test("only finished phases are terminal", () => {
    expect(isTerminalPhase("completed")).toBe(true);
    expect(isTerminalPhase("failed")).toBe(true);
    expect(isTerminalPhase("awaiting_input")).toBe(false);
    expect(isTerminalPhase("unknown")).toBe(false);
  });

  test("awaiting input sits on the running step; unknown marks nothing", () => {
    expect(stepIndexForPhase("awaiting_input")).toBe(stepIndexForPhase("running"));
    expect(stepIndexForPhase("unknown")).toBe(-1);
    expect(stepIndexForPhase("failed")).toBe(-1);
  });

  test("the suggestion is read-only and names the project", () => {
    const text = suggestedFirstTask("app");
    expect(text).toContain("app");
    expect(text.toLowerCase()).toContain("read-only");
    expect(text).toContain("Do not change");
  });
});

describe("first-task persistence", () => {
  test("a stored task survives a reload", () => {
    const raw = JSON.stringify({
      skippedAt: null,
      dismissedAt: null,
      task: {
        flightId: "f-1", conversationId: "dm-1", messageId: "m-1", agentId: "a", agentName: "A",
        body: "look", sentAt: 10, lastPhase: "running",
      },
    });
    const store = parseFirstTaskStore(raw);
    expect(store.task?.flightId).toBe("f-1");
    expect(store.task?.lastPhase).toBe("running");
    expect(firstTaskPresentation(store)).toBe("card");
  });

  test("corrupt or partial storage resets instead of throwing", () => {
    expect(parseFirstTaskStore("{not json")).toEqual(EMPTY_FIRST_TASK_STORE);
    expect(parseFirstTaskStore(JSON.stringify({ task: { flightId: "f" } })).task).toBeNull();
    expect(parseFirstTaskStore(JSON.stringify({
      task: { flightId: "f", conversationId: "c", agentId: "a", sentAt: 1, lastPhase: "bogus" },
    })).task?.lastPhase).toBe("unknown");
  });

  test("skip collapses to a resume chip; a sent task keeps the card; dismiss hides", () => {
    expect(firstTaskPresentation({ ...EMPTY_FIRST_TASK_STORE, skippedAt: 5 })).toBe("resume_chip");
    const task = parseFirstTaskStore(JSON.stringify({
      task: { flightId: "f", conversationId: "c", agentId: "a", sentAt: 1, lastPhase: "running" },
    })).task;
    expect(firstTaskPresentation({ skippedAt: 5, dismissedAt: null, task })).toBe("card");
    expect(firstTaskPresentation({ skippedAt: null, dismissedAt: 9, task })).toBe("hidden");
  });
});

describe("first-task result and approvals", () => {
  const task = { agentId: "a", messageId: "m-ask", flightId: "f-1", sentAt: 100, conversationId: "dm-1" };

  test("a reply to the ask wins over later chatter", () => {
    const result = pickFirstTaskResult([
      { id: "x", actorId: "a", body: "later", createdAt: 300, replyToMessageId: null },
      { id: "y", actorId: "a", body: "answer", createdAt: 400, replyToMessageId: "m-ask" },
    ], task);
    expect(result?.id).toBe("y");
  });

  test("uncorrelated messages from the same agent never count", () => {
    const result = pickFirstTaskResult([
      { id: "old", actorId: "a", body: "earlier", createdAt: 50, replyToMessageId: null },
      { id: "mine", actorId: "operator", body: "ask", createdAt: 100, replyToMessageId: null },
      { id: "first", actorId: "a", body: "first", createdAt: 150, replyToMessageId: null },
      { id: "second", actorId: "a", body: "second", createdAt: 200, replyToMessageId: null },
    ], task);
    expect(result).toBeNull();
    expect(pickFirstTaskResult([], task)).toBeNull();
  });

  test("session-level approvals cannot establish ask ownership", () => {
    const approval = (id: string, extra: Record<string, unknown>) => ({
      id,
      kind: "approval",
      title: id,
      approval: { sessionId: `s-${id}`, turnId: "t", blockId: "b", version: 1 },
      ...extra,
    });
    const items = [
      approval("by-agent", { agentId: "a" }),
      approval("by-dm", { conversationId: "dm-1" }),
      { ...approval("by-session", {}), approval: { sessionId: "flight-session", turnId: "t", blockId: "b", version: 2 } },
      approval("someone-else", { agentId: "b" }),
      { id: "not-approval", kind: "ask", title: "q", agentId: "a" },
    ];
    expect(approvalsForFirstTask(items, task, ["flight-session"]).map((item) => item.id))
      .toEqual([]);
  });
});


describe("overlapping task isolation", () => {
  const task = { agentId: "a", messageId: "ask-1", flightId: "flight-1", invocationId: "inv-1", workId: "work-1", sentAt: 100, conversationId: "dm" };
  const reply = (id: string, createdAt: number, replyToMessageId: string | null, metadata = {}) => ({ id, actorId: "a", body: id, createdAt, replyToMessageId, metadata });
  test("conflicting request or flight ids reject even with another matching id", () => {
    expect(pickFirstTaskResult([
      reply("other-request", 101, "ask-2", { flightId: "flight-1" }),
      reply("other-flight", 102, "ask-1", { flightId: "flight-2" }),
      reply("overlap", 103, "ask-2", { flightId: "flight-2" }),
      reply("changed-attempt", 104, "ask-1", { invocationId: "inv-2" }),
      reply("changed-work", 105, "ask-1", { collaborationRecordId: "work-2" }),
    ], task)).toBeNull();
  });
  test("completed acceptance does not mask a later correlated answer regardless of API ordering", () => {
    const acceptance = reply("accepted", 101, "ask-1", { flightId: "flight-1" });
    const final = reply("final", 200, "ask-1", { flightId: "flight-1" });
    expect(pickFirstTaskResult([final, acceptance], task)?.id).toBe("final");
    expect(pickFirstTaskResult([acceptance, final], task)?.id).toBe("final");
    expect(pickFirstTaskResult([{ ...reply("status", 300, "ask-1"), class: "status" }, final], task)?.id).toBe("final");
  });
  test("previous or shared current sessions never authorize an approval", () => {
    const item = { id: "approval", kind: "approval", title: "Tool", agentId: "a", conversationId: "dm", approval: { sessionId: "old", turnId: "t", blockId: "b", version: 1 } };
    expect(approvalsForFirstTask([item], task, ["new"])).toEqual([]);
    expect(approvalsForFirstTask([{ ...item, approval: { ...item.approval, sessionId: "new" } }], task, ["new"])).toEqual([]);
  });
  test("catalog failure has a recoverable blocked state", () => {
    expect(firstTaskReadiness(observed({ catalogFailed: true, runtimes: null })).kind).toBe("verification_unavailable");
  });
  test("storage cannot cross broker/operator identities or load legacy/unknown authority", () => {
    const entries = new Map<string, string>();
    const previous = globalThis.window;
    globalThis.window = { localStorage: { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value) } } as any;
    try {
      const store = { ...EMPTY_FIRST_TASK_STORE, skippedAt: 5 };
      writeFirstTaskStore(store, "broker-a/operator-a");
      expect(readFirstTaskStore("broker-a/operator-a").skippedAt).toBe(5);
      expect(readFirstTaskStore("broker-a/operator-b")).toEqual(EMPTY_FIRST_TASK_STORE);
      expect(readFirstTaskStore("broker-b/operator-a")).toEqual(EMPTY_FIRST_TASK_STORE);
      entries.set("scout:solo:first-task:v1", JSON.stringify(store));
      expect(readFirstTaskStore(null)).toEqual(EMPTY_FIRST_TASK_STORE);
      expect(firstTaskStorageKey(null)).toBeNull();
      writeFirstTaskStore({ ...store, skippedAt: null }, "broker-a/operator-a");
      expect(readFirstTaskStore("broker-a/operator-a").skippedAt).toBeNull();
    } finally { globalThis.window = previous; }
  });
});


describe("card-to-execution routing", () => {
  test("authoritative fresh execution actor receives the correlated reply, not the selected card", () => {
    const selectedCard = "project-codex-card";
    const response = { targetAgentId: "fresh-codex-worker", flight: { targetAgentId: "fresh-codex-worker" } };
    const task = { agentId: firstTaskExecutionTarget(response), messageId: "card-ask", flightId: "fresh-flight", sentAt: 1 };
    expect(task.agentId).not.toBe(selectedCard);
    const answer = { id: "answer", actorId: "fresh-codex-worker", body: "Actual answer", createdAt: 2, replyToMessageId: "card-ask", metadata: { flightId: "fresh-flight" } };
    expect(pickFirstTaskResult([answer], task)?.id).toBe("answer");
    expect(pickFirstTaskResult([{ ...answer, actorId: selectedCard }], task)).toBeNull();
    expect(pickFirstTaskResult([{ ...answer, metadata: { flightId: "another-flight" } }], task)).toBeNull();
    expect(pickFirstTaskResult([{ ...answer, replyToMessageId: "another-ask" }], task)).toBeNull();
  });
  test("missing or conflicting execution authority never guesses the selected card", () => {
    expect(firstTaskExecutionTarget({ flight: { targetAgentId: "resolved-worker" } })).toBe("resolved-worker");
    expect(() => firstTaskExecutionTarget({})).toThrow("no execution target");
    expect(() => firstTaskExecutionTarget({ targetAgentId: "one", flight: { targetAgentId: "two" } })).toThrow("conflicting execution targets");
  });
});


test("reobserving the same flight phase preserves React state identity and performs no storage writes", () => {
  const task = parseFirstTaskStore(JSON.stringify({ task: { flightId: "f", conversationId: "c", agentId: "a", sentAt: 1, lastPhase: "running" } })).task!;
  const initial = { identity: "owner-a", store: { ...EMPTY_FIRST_TASK_STORE, task } };
  let state: FirstTaskScopedState = initial;
  let writes = 0;
  const persist = () => { writes++; };
  const observe = (phase: "running" | "completed") => updateFirstTaskScopedState(state, "owner-a", current => current.task && current.task.lastPhase !== phase ? { ...current, task: { ...current.task, lastPhase: phase } } : current, persist);
  for (let i = 0; i < 100; i++) state = observe("running");
  expect(state).toBe(initial); expect(writes).toBe(0);
  state = observe("completed");
  const changed = state;
  expect(changed).not.toBe(initial); expect(writes).toBe(1);
  for (let i = 0; i < 100; i++) state = observe("completed");
  expect(state).toBe(changed); expect(writes).toBe(1);
  const switched = updateFirstTaskScopedState(state, "owner-b", current => current, persist);
  expect(switched.identity).toBe("owner-b");
  expect(switched.store).toBe(EMPTY_FIRST_TASK_STORE);
  expect(switched.store.task).toBeNull();
  expect(writes).toBe(2);
});

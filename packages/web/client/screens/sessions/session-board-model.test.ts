import { expect, test } from "bun:test";
import type { Agent, OperatorAttentionItem, SessionEntry, TailDiscoveredTranscript } from "../../lib/types.ts";
import { attentionForSession, buildSessionBoardRows, matchesSessionFilter, sessionOrigin, stableSessionOrder } from "./session-board-model.ts";
const conversation = (patch: Partial<SessionEntry> = {}): SessionEntry => ({ id: "c1", kind: "direct", title: "Build Sessions", participantIds: ["requester", "worker"],
  participants: [{ actorId: "requester", kind: "agent", agentId: "requester", displayName: "Release agent", label: "Release agent" }],
  agentId: "worker", agentName: "Worker", harness: "codex", sessionId: "sess.1", harnessSessionId: "provider-1", harnessLogPath: null,
  currentBranch: "main", preview: null, messageCount: 1, lastMessageAt: 1, workspaceRoot: "/repo", ...patch });
const input = () => ({ conversations: [conversation()], transcripts: [], agents: [] as Agent[], events: [], attention: [], now: 100 });
test("agent-started single-session conversations are included without operator participation", () => {
  const rows = buildSessionBoardRows(input()); expect(rows).toHaveLength(1);
  expect(rows[0].origin).toEqual({ kind: "agent", label: "started by Release agent" });
  expect(rows[0].selection.sessionRef).toBe("session:codex:provider-1");
  expect(matchesSessionFilter(rows[0], { scope: "from_agents" })).toBe(true);
});
test("unbacked rooms are not session rows", () => {
  expect(buildSessionBoardRows({ ...input(), conversations: [conversation({ kind: "channel", sessionId: null })] })).toEqual([]);
});
test("observed sessions without any conversation remain sessions", () => {
  const transcript = { source: "codex", sessionId: "native-1", transcriptPath: "/tmp/native-1.jsonl", cwd: "/repo", project: "repo", harness: "unattributed", mtimeMs: 1, size: 1 } as TailDiscoveredTranscript;
  const rows = buildSessionBoardRows({ ...input(), conversations: [], transcripts: [transcript] });
  expect(rows).toHaveLength(1); expect(rows[0].working).toBe(false);
  expect(rows[0].selection.sessionRef).toBe("session:codex:native-1");
  expect(rows[0].origin.kind).toBe("unknown");
});
test("filtering is a set; live activity changes don't move existing seats", () => {
  const rows = buildSessionBoardRows(input());
  const second = { ...rows[0], key: "second" }; const third = { ...rows[0], key: "third" };
  expect(stableSessionOrder([rows[0].key, "second"], [third, second, rows[0]])).toEqual([rows[0].key, "second", "third"]);
  expect(matchesSessionFilter(rows[0], { scope: "all", project: "/other" })).toBe(false);
  expect(matchesSessionFilter(rows[0], { scope: "all", machine: "local" })).toBe(true);
  expect(matchesSessionFilter(rows[0], { scope: "working" })).toBe(false);
  expect(matchesSessionFilter({ ...rows[0], asks: true }, { scope: "working_asks" })).toBe(true);
});
test("approval matching uses exact session, never the agent's other active session", () => {
  const item = { id: "approval", agentId: "worker", conversationId: "c1", approval: { sessionId: "old" } } as OperatorAttentionItem;
  expect(attentionForSession([item], ["current"], "c1")).toEqual([]);
  expect(attentionForSession([item], ["old"])).toEqual([item]);
});
test("initiating ask is stronger evidence than membership; unknown origins stay unknown", () => {
  expect(sessionOrigin({ requester: { requesterId: "operator", requesterName: "Art" }, conversation: conversation() }).label).toBe("started by you");
  expect(sessionOrigin({ requester: { requesterId: "agent-2", requesterName: "Agent 2" } }).label).toBe("started by Agent 2");
  expect(sessionOrigin({ conversation: conversation({ kind: "channel" }) }).kind).toBe("unknown");
});
test("native questions use exact follow routes, not agent identity", () => {
  const item = { id: "question", kind: "question", conversationId: null, actions: [{ kind: "open", route: { view: "follow", sessionId: "session:codex:native" } }] } as OperatorAttentionItem;
  expect(attentionForSession([item], ["native"])).toEqual([item]);
  expect(attentionForSession([item], ["other"])).toEqual([]);
  expect(attentionForSession([item], ["session:claude:native"])).toEqual([]);
});
test("remote approvals remain scoped to their originating machine and payload", () => {
  const remote = { id: "remote-approval", approval: { sessionId: "remote:peer%3A2:native" } } as OperatorAttentionItem;
  const local = { id: "local-approval", approval: { sessionId: "native" } } as OperatorAttentionItem;
  expect(attentionForSession([remote, local], ["native"], null, "peer:2", "here")).toEqual([remote]);
  expect(attentionForSession([remote, local], ["native"], null, "here", "here")).toEqual([local]);
  expect(attentionForSession([remote], ["native"])).toEqual([]);
  expect(attentionForSession([remote], ["native"], null, "elsewhere")).toEqual([]);
});
test("Observe runtime and provider aliases both receive the exact inline request", () => {
  const approval = { id: "pairing-approval", approval: { sessionId: "pairing-session-1" } } as OperatorAttentionItem;
  const native = { id: "native-question", actions: [{ kind: "open", route: { view: "follow", sessionId: "provider-session" } }] } as OperatorAttentionItem;
  expect(attentionForSession([approval, native], ["provider-session", "pairing-session-1"], null, "here", "here")).toEqual([approval, native]);
});

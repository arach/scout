import { formatSessionRouteRef, parseSessionRouteRef, sessionHarnessMatches } from "../../../shared/session-route-ref.ts";
import { classifyConversation, conversationSessionId } from "../../lib/conversation-kind.ts";
import { isAgentBusy } from "../../lib/agent-state.ts";
import type { Agent, ObserveData, OperatorAttentionItem, SessionEntry, TailDiscoveredTranscript, TailEvent } from "../../lib/types.ts";
import { buildLaneFacts, nativeObserveData, nativeSessionAgent, type AgentLane } from "../ops/agent-lanes-model.ts";
import type { SessionFilter, SessionSelection } from "./slot-deck.ts";

export type SessionOrigin = { kind: "you" | "agent" | "unknown"; label: string };
export type SessionBoardRow = {
  key: string;
  selection: SessionSelection;
  sessionId: string;
  title: string;
  harness: string | null;
  project: string | null;
  branch: string | null;
  model: string | null;
  machine: string | null;
  machineName: string | null;
  working: boolean;
  asks: boolean;
  origin: SessionOrigin;
  conversation: SessionEntry | null;
  lane: AgentLane | null;
};

export function sessionOrigin(input: {
  conversation?: SessionEntry | null;
  requester?: { requesterId: string; requesterName: string } | null;
  parentSessionId?: string | null;
  agents?: readonly Agent[];
  operatorName?: string | null;
}): SessionOrigin {
  const { conversation, requester, agents = [], operatorName } = input;
  const by = (id: string, name?: string): SessionOrigin => id === "operator" || id === operatorName
    ? { kind: "you", label: "started by you" }
    : { kind: "agent", label: `started by ${name || agents.find((a) => a.id === id)?.name || (/^session[-:]/.test(id) ? "another session" : id)}` };
  if (requester) return by(requester.requesterId, requester.requesterName);
  if (input.parentSessionId) return by(input.parentSessionId, agents.find((a) => a.harnessSessionId === input.parentSessionId)?.name);
  const members = conversation?.participants?.filter((p) => p.kind !== "session" && p.agentId !== conversation.agentId && p.actorId !== conversation.agentId) ?? [];
  // Membership alone cannot establish the initiator of a room. These are only
  // single-session direct lines; a unique non-target member is the requester.
  if (conversation?.kind === "direct" && members.length === 1) return by(members[0].actorId, members[0].displayName);
  const ids = conversation?.kind === "direct" ? conversation.participantIds.filter((id) => id !== conversation.agentId && !id.startsWith("session:")) : [];
  if (ids?.length === 1) return by(ids[0]);
  return { kind: "unknown", label: "Start origin not recorded" };
}

/** Attention keeps its exact decision payload. Remote ids are namespaced and
 * only match a slot explicitly scoped to that machine; agent identity is never
 * enough to select an approval from the agent's other sessions. */
export function attentionForSession(items: readonly OperatorAttentionItem[], refs: readonly string[], conversationId?: string | null, machineId?: string | null, localNodeId?: string | null): OperatorAttentionItem[] {
  const parsed = refs.map(parseSessionRouteRef).filter((ref) => ref !== null);
  const matches = (value: string) => {
    let ref = value;
    if (value.startsWith("remote:")) {
      const split = value.indexOf(":", 7);
      if (split < 0 || !machineId) return false;
      try { if (decodeURIComponent(value.slice(7, split)) !== machineId) return false; } catch { return false; }
      ref = value.slice(split + 1);
    } else if (machineId && machineId !== localNodeId) return false;
    const candidate = parseSessionRouteRef(ref);
    return !!candidate && parsed.some((wanted) => wanted.refId === candidate.refId
      && (!wanted.harness || !candidate.harness || sessionHarnessMatches(wanted.harness, candidate.harness)));
  };
  return items.filter((item) => {
    if (item.approval) return matches(item.approval.sessionId);
    // Native questions have no conversation; the follow action is the backing.
    const sessionRoutes = (item.actions ?? []).flatMap((action) => action.route && "sessionId" in action.route && action.route.sessionId ? [action.route.sessionId] : []);
    return sessionRoutes.length ? sessionRoutes.some(matches) : Boolean(conversationId && item.conversationId === conversationId);
  });
}

export function buildSessionBoardRows(input: {
  conversations: readonly SessionEntry[];
  transcripts: readonly TailDiscoveredTranscript[];
  events: TailEvent[];
  agents: Agent[];
  attention: readonly OperatorAttentionItem[];
  now: number;
  operatorName?: string | null;
  localNodeId?: string | null;
}): SessionBoardRow[] {
  const rows = new Map<string, SessionBoardRow>();
  const { agents, attention, now } = input;
  const eventsById = new Map<string, TailEvent[]>();
  for (const event of input.events) {
    const events = eventsById.get(event.sessionId) ?? []; events.push(event); eventsById.set(event.sessionId, events);
  }
  const keyOf = (harness: string | null, id: string, machine?: string | null) => `${machine ?? "local"}:${harness ?? ""}:${id}`;
  for (const conversation of input.conversations) {
    if (classifyConversation(conversation) !== "session") continue;
    const id = conversation.harnessSessionId?.trim() || conversationSessionId(conversation)!;
    const agent = agents.find((a) => a.id === conversation.agentId && a.harnessSessionId === id);
    const machine = conversation.executionNodeId || agent?.homeNodeId || input.localNodeId || null;
    const key = keyOf(conversation.harness, id, machine);
    const working = Boolean(agent && isAgentBusy(agent.state));
    rows.set(key, {
      key, sessionId: id, selection: { sessionRef: formatSessionRouteRef(conversation.harness, id)!, ...(machine ? { machineId: machine } : {}) },
      title: conversation.title || conversation.preview || id, harness: conversation.harness,
      project: conversation.workspaceRoot, branch: conversation.currentBranch, model: conversation.model ?? agent?.model ?? null,
      machine, machineName: conversation.executionNodeName ?? agent?.homeNodeName ?? null,
      working, asks: attentionForSession(attention, [id, conversation.sessionId ?? ""], conversation.id, machine, input.localNodeId).length > 0,
      origin: sessionOrigin({ conversation, agents, operatorName: input.operatorName }), conversation,
      lane: agent ? { id, agent, source: "scout", observe: null, lastActiveAt: conversation.lastMessageAt ?? 0, current: working } : null,
    });
  }
  for (const transcript of input.transcripts) {
    const id = transcript.sessionId?.trim() || transcript.transcriptPath.split("/").at(-1)?.replace(/\.jsonl$/u, "");
    if (!id) continue;
    const agent = agents.find((a) => a.harnessSessionId === id && a.harness === transcript.source);
    const machine = agent?.homeNodeId ?? input.localNodeId ?? null;
    const key = keyOf(transcript.source, id, machine);
    const previous = rows.get(key);
    const events = eventsById.get(id) ?? [];
    const lastActiveAt = transcript.lastEventAt ?? transcript.mtimeMs;
    // Reuse the lane's observed-turn facts; transcript mtime is not proof of work.
    const native = agent ?? nativeSessionAgent(transcript, lastActiveAt, false, events);
    const observe: ObserveData = nativeObserveData(transcript, events, false);
    const facts = buildLaneFacts(transcript, events, native, [], observe);
    const working = agent ? isAgentBusy(agent.state) : facts.turn?.phase === "started" && now - lastActiveAt < 30 * 60_000;
    const lane: AgentLane = { id, agent: native, source: agent ? "scout" : "native", observe, facts, lastActiveAt, current: working };
    rows.set(key, {
      key, sessionId: id, selection: previous?.selection ?? { sessionRef: formatSessionRouteRef(transcript.source, id)!, ...(machine ? { machineId: machine } : {}) },
      title: previous?.title ?? facts.currentTask ?? native.name, harness: transcript.source,
      project: transcript.cwd, branch: previous?.branch ?? facts.branch ?? null, model: previous?.model ?? facts.model ?? null,
      machine, machineName: previous?.machineName ?? agent?.homeNodeName ?? null, working,
      asks: previous?.asks || attentionForSession(attention, [id], null, machine, input.localNodeId).length > 0,
      origin: previous?.origin.kind !== "unknown" && previous?.origin ? previous.origin
        : sessionOrigin({ parentSessionId: facts.parentSessionId, agents, operatorName: input.operatorName }),
      conversation: previous?.conversation ?? null, lane,
    });
  }
  return [...rows.values()];
}

export function matchesSessionFilter(row: SessionBoardRow, filter: SessionFilter): boolean {
  if (filter.project && row.project !== filter.project) return false;
  if (filter.machine && (row.machine ?? "local") !== filter.machine) return false;
  if (filter.harness && row.harness !== filter.harness) return false;
  switch (filter.scope) {
    case "working": return row.working;
    case "asks": return row.asks;
    case "working_asks": return row.working || row.asks;
    case "from_agents": return row.origin.kind === "agent";
    default: return true;
  }
}

/** Existing rows keep their seats across activity/engagement; newcomers append. */
export function stableSessionOrder(previous: readonly string[], rows: readonly SessionBoardRow[]): string[] {
  const keys = new Set(rows.map((r) => r.key));
  const ordered = previous.filter((key) => keys.has(key)); const known = new Set(ordered);
  return [...ordered, ...rows.filter((r) => !known.has(r.key)).map((r) => r.key)];
}

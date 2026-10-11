import { formatSessionRouteRef, parseSessionRouteRef } from "../../../shared/session-route-ref.ts";
import type { SessionRefObservePayload } from "./SessionRefScreen.tsx";
import type { Agent, SessionEntry } from "../../lib/types.ts";
import { isAgentInTurn } from "../../lib/agent-state.ts";
import { api } from "../../lib/api.ts";
import type { SessionSteerAvailability, SessionSteerReceipt } from "../../../shared/api/session-steer.ts";

export type SessionDeliveryTarget = {
  sessionId: string;
  sessionRef?: string | null;
  machineId?: string | null;
  blockedReason?: string | null;
  interruptLocal?: boolean;
  agentId?: string | null;
  projectPath?: string | null;
  harness?: string | null;
  model?: string | null;
};
export function sessionSteerPath(target: SessionDeliveryTarget): string {
  return `/api/session-ref/${encodeURIComponent(target.sessionRef ?? "")}/steer?machine=${encodeURIComponent(target.machineId ?? "")}`;
}
export function sessionDeliveryAvailability(target: SessionDeliveryTarget, live?: SessionSteerAvailability | null) {
  const reason = target.blockedReason || (!target.sessionRef || !target.sessionId ? "Waiting for a resolved session identity." : !target.machineId ? "The session's machine is not verified." : null);
  return reason ? { available: false, reason } : live ?? { available: false, reason: "Checking the live session…" };
}
export async function sendSessionDraft(target: SessionDeliveryTarget, body: string): Promise<SessionSteerReceipt> {
  if (target.blockedReason || !target.sessionRef || !target.machineId || !target.sessionId) throw new Error(sessionDeliveryAvailability(target).reason);
  // Exactly one input request. Never /sessions (start/resume), /send, or ask.
  return api<SessionSteerReceipt>(sessionSteerPath(target), { method: "POST", body: JSON.stringify({ text: body }) });
}

/** One read at a time; stop makes late responses from a previous slot inert. */
export function sessionSteerPoll<T>(read: () => Promise<T>, receive: (value: T) => void, failed: () => void) {
  let stopped = false, reading = false;
  return {
    async refresh() {
      if (stopped || reading) return;
      reading = true;
      try { const value = await read(); if (!stopped) receive(value); }
      catch { if (!stopped) failed(); }
      finally { reading = false; }
    },
    stop() { stopped = true; },
  };
}
/** The existing interrupt endpoint addresses the active agent, not history.
 * Never offer it on a pinned older session or an unbound observed process. */
export function sessionInterruptAgent(target: SessionDeliveryTarget, agent: Agent | null | undefined): Agent | null {
  return !target.blockedReason && target.interruptLocal !== false && agent && target.agentId === agent.id && agent.harnessSessionId === target.sessionId
    && isAgentInTurn(agent.state) && !agent.staleLocalRegistration && !agent.retiredFromFleet
    && agent.terminalSurface?.backend === "tmux" ? agent : null;
}

/** Route wrappers and conversation ids are read identities, never execution ids.
 * Until Observe resolves, including a delayed/failed second lookup, fail closed.
 * Host session-ref reads are not proxy-supported. Don't steer a local lookalike
 * for a machine-scoped pin; a node must be observed and an exact owner known. */
export function sessionTargetFromObserve(observe: SessionRefObservePayload | null | undefined, conversation: SessionEntry | null, machineId?: string, localNodeId?: string | null, owner?: Agent): SessionDeliveryTarget {
  const meta = observe?.data.metadata?.session;
  const sessionId = parseSessionRouteRef(meta?.externalSessionId || observe?.sessionId)?.refId ?? "";
  const agentId = observe?.agentId ?? conversation?.agentId ?? null;
  const ownerNode = observe?.kind === "agent" && owner?.id === agentId && owner?.harnessSessionId === sessionId ? owner.homeNodeId : null;
  const observedNode = meta?.nodeId ?? ownerNode ?? (observe?.kind === "history" || observe?.kind === "tail" ? localNodeId : null);
  const blockedReason = !observe || !sessionId ? "Waiting for a resolved session identity; no delivery will be attempted."
    : machineId && observedNode !== machineId ? "The selected machine is not verified by this Observe source. Open the session on that machine; this slot is read-only."
    : (machineId || observedNode) && (machineId || observedNode) !== localNodeId && !agentId ? "Machine-scoped history has no exact registered owner for this web delivery path."
    : null;
  return { sessionId, sessionRef: formatSessionRouteRef(meta?.adapterType ?? conversation?.harness, sessionId), machineId: machineId || observedNode || localNodeId,
    agentId, blockedReason, interruptLocal: !machineId || machineId === localNodeId, projectPath: meta?.cwd ?? conversation?.workspaceRoot,
    harness: meta?.adapterType ?? conversation?.harness, model: meta?.model ?? conversation?.model };
}

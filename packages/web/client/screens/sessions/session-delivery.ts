import { parseSessionRouteRef } from "../../../shared/session-route-ref.ts";
import type { SessionRefObservePayload } from "./SessionRefScreen.tsx";
import type { Agent, SessionEntry } from "../../lib/types.ts";
import { isAgentInTurn } from "../../lib/agent-state.ts";
import { invokeSession, resumableHarnessFromAdapterType, resumeAgentSession } from "../../lib/session-start.ts";

export type SessionDeliveryTarget = {
  sessionId: string;
  blockedReason?: string | null;
  interruptLocal?: boolean;
  agentId?: string | null;
  projectPath?: string | null;
  harness?: string | null;
  model?: string | null;
};
export type SessionDeliveryMode = "live" | "scout";
export function sessionDeliveryAvailability(target: SessionDeliveryTarget) {
  const resumable = Boolean(!target.blockedReason && target.sessionId && (target.agentId || target.projectPath && resumableHarnessFromAdapterType(target.harness)));
  return {
    // The pairing bridge exposes prompt/send, but it is not a browser API.
    // /sessions/reply may fall back to a traced ask. Deck's route is agent-only.
    // Neither satisfies an untraced, session-addressed promise for a pinned tab.
    live: { available: false, reason: "No session-addressed direct web transport is exposed. Use the live harness; Scout will not fall back to an ask." },
    scout: { available: resumable, reason: target.blockedReason || (resumable ? null : "This session has no registered owner or resumable harness and project.") },
  };
}
export async function sendSessionDraft(mode: SessionDeliveryMode, target: SessionDeliveryTarget, body: string): Promise<void> {
  const availability = sessionDeliveryAvailability(target)[mode];
  if (!availability.available) throw new Error(availability.reason ?? "This delivery mode is unavailable.");
  if (!body.trim()) return;
  // One explicit mode, one exact session. Errors remain errors, not retries on
  // /send or /sessions/reply (whose delivery contracts are different).
  if (target.agentId) {
    await resumeAgentSession({ agentId: target.agentId, sessionId: target.sessionId, instructions: body });
  } else {
    await invokeSession({ projectPath: target.projectPath!, sessionId: target.sessionId,
      harness: resumableHarnessFromAdapterType(target.harness), model: target.model ?? undefined, instructions: body });
  }
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
  return { sessionId, agentId, blockedReason, interruptLocal: !machineId || machineId === localNodeId, projectPath: meta?.cwd ?? conversation?.workspaceRoot,
    harness: meta?.adapterType ?? conversation?.harness, model: meta?.model ?? conversation?.model };
}

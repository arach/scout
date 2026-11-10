import type { AgentEndpoint } from "@openscout/protocol";
import { TailObservationError, type TailObservationBinding, type TailObservationTarget } from "./tail-observations.js";

/** Resolve recorded native identity. A tmux session name is never a transcript ID. */
export function bindTailObservation(target: TailObservationTarget, endpoint: AgentEndpoint | undefined, localNodeId: string, hostLabel: string): TailObservationBinding {
  if (!endpoint || endpoint.id !== target.endpointId || endpoint.nodeId !== target.nodeId || target.nodeId !== localNodeId)
    throw new TailObservationError("The exact session endpoint is unavailable on this host.", 404);
  const meta = endpoint.metadata ?? {};
  const text = (key: string) => typeof meta[key] === "string" && (meta[key] as string).trim() ? (meta[key] as string).trim() : null;
  let sessionId: string | null;
  if (endpoint.transport === "tmux") {
    const evidence = meta.observedSessionEvidence as { source?: unknown } | undefined;
    sessionId = text("observedSessionId");
    if (meta.pendingExternalSession === true || typeof meta.externalSessionAdoptedAt === "number"
      || evidence?.source !== "claude-session-record" || sessionId === endpoint.sessionId
      || ["externalSessionId", "nativeSessionId", "threadId"].some(key => text(key) && text(key) !== sessionId)) sessionId = null;
  } else sessionId = text("externalSessionId") ?? text("nativeSessionId") ?? text("threadId");
  if (!sessionId || sessionId.length > 512) throw new TailObservationError("Waiting for this endpoint's verified native session identity.");
  const source = endpoint.harness.replace(/-acp$/, "");
  return { ...target, sessionId, source, hostLabel };
}

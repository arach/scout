import type {
  AgentDefinition,
  AgentEndpoint,
  NodeDefinition,
  ScoutDispatchEnvelope,
  ScoutDispatchUnavailableTarget,
} from "@openscout/protocol";

import { brokerTargetProjectRoot } from "./broker-conversation-helpers.js";
import {
  staleLocalAgentReason,
} from "./broker-local-invocation-helpers.js";
import {
  evaluateBrokerAvailability,
  endpointMatchesTargetSession,
  type BrokerAvailability,
  type VerifiedLaunchRoute,
  endpointCandidateState,
  homeEndpointForAgent,
  hasRetiredEndpointRegistration,
  latestEndpointForAgent,
  isEndpointOnlineState,
} from "./broker-endpoint-selection.js";
import { isA2AHttpEndpoint } from "./a2a-http-endpoint.js";
import { isExternalSessionEndpoint } from "./external-session-transport.js";
import { isBrokerRunnableLocalAgentTransport, isDirectLocalAgentTransport } from "./local-agent-transports.js";
import type { RuntimeRegistrySnapshot } from "./registry.js";

/** Transport-owned receive evidence; a cloud/mailbox route is not a tmux process. */
export function localEndpointCanReceive(endpoint: AgentEndpoint, localProcessAlive: (endpoint: AgentEndpoint) => boolean): boolean {
  if (isExternalSessionEndpoint(endpoint) || isA2AHttpEndpoint(endpoint)) {
    return isEndpointOnlineState(endpoint.state)
      || (endpoint.transport === "mcp_poll" && endpoint.state === "registered");
  }
  return localProcessAlive(endpoint);
}

/** These adapters execute behind the broker's endpoint-owner lane or durable mailbox. */
export function localEndpointSupportsQueue(
  endpoint: AgentEndpoint,
  directQueueSupported?: (endpoint: AgentEndpoint) => boolean,
): boolean {
  // Direct adapters own their serialization guarantees, including uncertain
  // native turns. External mailbox and bridge routes retain their own queues.
  if (isDirectLocalAgentTransport(endpoint.transport)) {
    return directQueueSupported ? directQueueSupported(endpoint) : endpoint.transport !== "codex_app_server";
  }
  if (isExternalSessionEndpoint(endpoint)) return endpoint.transport === "mcp_poll";
  return isBrokerRunnableLocalAgentTransport(endpoint.transport)
    || endpoint.transport === "pairing_bridge"
    || isA2AHttpEndpoint(endpoint);
}

type BrokerUnavailableTargetServiceDeps = {
  nodeId: string;
  describeRemoteAuthorityIssue: (
    agent: AgentDefinition,
    authorityNode: NodeDefinition | undefined,
  ) => ScoutDispatchUnavailableTarget | null;
  now?: () => number;
  isEndpointAlive?: (endpoint: AgentEndpoint) => boolean;
  supportsQueue?: (endpoint: AgentEndpoint) => boolean;
  /** Must verify compatible launcher AND project mapping on this authority. */
  verifiedLaunchRoute?: (
    agent: AgentDefinition, endpoint: AgentEndpoint | null,
  ) => VerifiedLaunchRoute | null;
};

export class BrokerUnavailableTargetService {
  readonly #deps: BrokerUnavailableTargetServiceDeps;

  constructor(deps: BrokerUnavailableTargetServiceDeps) {
    this.#deps = deps;
  }

  describe(
    snapshot: RuntimeRegistrySnapshot,
    agent: AgentDefinition,
    targetSessionId?: string,
  ): ScoutDispatchUnavailableTarget | null {
    const availability = this.evaluate(snapshot, agent, targetSessionId);
    if (availability.state !== "gone") return null;
    const endpoint = latestEndpointForAgent(snapshot, agent.id);
    const projectRoot = brokerTargetProjectRoot(agent, endpoint);
    const remoteIssue = agent.authorityNodeId !== this.#deps.nodeId
      ? this.#deps.describeRemoteAuthorityIssue(agent, snapshot.nodes[agent.authorityNodeId])
      : null;
    const staleReason = staleLocalAgentReason(snapshot, agent);
    const harness = endpoint?.harness
      ?? (typeof agent.metadata?.harness === "string" ? agent.metadata.harness : "codex");
    const remediation = `Start fresh explicitly: scout ask --project ${JSON.stringify(projectRoot ?? "/path/to/project")} --harness ${harness} "your request".`;
    return {
      agentId: agent.id,
      displayName: agent.displayName ?? agent.id,
      reason: targetSessionId ? "session_reference_not_attachable"
        : availability.reason === "retired" ? "retired"
        : availability.reason === "stale_registration" ? "superseded_registration"
        : agent.wakePolicy === "manual" ? "manual_wake_required" : "unknown",
      detail: `${agent.displayName ?? agent.id} is Gone: ${availability.reason}. ${remoteIssue?.detail ?? staleReason ?? ""} ${remediation}`,
      wakePolicy: agent.wakePolicy,
      endpointState: endpointCandidateState(endpoint?.state),
      transport: endpoint?.transport ?? null,
      projectRoot,
    };
  }

  evaluate(
    snapshot: RuntimeRegistrySnapshot,
    agent: AgentDefinition,
    targetSessionId?: string,
  ): BrokerAvailability {
    const endpoint = targetSessionId
      ? Object.values(snapshot.endpoints).find((candidate) =>
          candidate.agentId === agent.id && endpointMatchesTargetSession(candidate, targetSessionId)) ?? null
      : homeEndpointForAgent(snapshot, agent.id) ?? latestEndpointForAgent(snapshot, agent.id);
    const remote = agent.authorityNodeId !== this.#deps.nodeId;
    const authorityAvailable = !remote || !this.#deps.describeRemoteAuthorityIssue(
      agent, snapshot.nodes[agent.authorityNodeId],
    );
    const checkedAt = this.#deps.now?.() ?? Date.now();
    const lastSeenAt = endpoint?.metadata?.lastSeenAt;
    // Remote state alone is not fresh receive evidence. Use the existing
    // endpoint refresh timestamp; no heartbeat, card mutation or new lease.
    const freshRemoteEndpoint = typeof lastSeenAt === "number"
      && lastSeenAt <= checkedAt && checkedAt - lastSeenAt <= 90_000;
    const alive = endpoint ? (remote ? freshRemoteEndpoint : this.#deps.isEndpointAlive?.(endpoint)) : false;
    // A local Codex connection is stronger evidence than an old turn-failure
    // latch. Admit recovery; the resolver durably repairs the endpoint state.
    // A remote refresh timestamp is NOT physical process evidence.
    const evaluatedEndpoint = !remote && endpoint?.transport === "codex_app_server"
      && endpoint.state === "offline" && alive === true && !hasRetiredEndpointRegistration(endpoint) ? { ...endpoint, state: "idle" as const } : endpoint;
    return evaluateBrokerAvailability({
      agent, endpoint: evaluatedEndpoint, authority: agent.authorityNodeId,
      authorityAvailable, checkedAt,
      targetSessionId,
      alive,
      queueSupported: endpoint ? this.#deps.supportsQueue?.(endpoint) === true : false,
      launchRoute: this.#deps.verifiedLaunchRoute?.(agent, endpoint) ?? null,
    });
  }

  buildEnvelope(
    askedLabel: string,
    target: ScoutDispatchUnavailableTarget,
  ): ScoutDispatchEnvelope {
    return {
      kind: "unavailable",
      askedLabel,
      detail: target.detail,
      candidates: [],
      target,
      dispatchedAt: this.#deps.now?.() ?? Date.now(),
      dispatcherNodeId: this.#deps.nodeId,
    };
  }
}

import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import type { ControlCommand, InvocationRequest, ScoutDeliverRequest } from "@openscout/protocol";
import type { ActiveScoutBrokerService } from "./broker-api.js";

export const ASSISTANT_CLAIMS_CAPABILITY = "assistant-answerer-claims/1";
export const ASSISTANT_CLAIM_HEADER = "x-scout-assistant-claim-token";

export class AssistantClaimError extends Error {
  constructor(readonly code: string, readonly status = 409, readonly retryAfterMs?: number) {
    super(code);
    this.name = "AssistantClaimError";
  }
}

type Lease = { token: string; holderId: string; deadline: number; admitted: number };

/** Broker-lifetime, machine-local ownership, not a mesh lock or persisted credential.
 * Admission pins the owner until its mutation settles, even across lease expiry. */
export class BrokerAssistantClaims {
  private readonly leases = new Map<string, Lease>();
  private readonly context = new AsyncLocalStorage<string | undefined>();
  private readonly protectedAgents: ReadonlySet<string>;
  readonly ttlMs: number;
  private readonly now: () => number;

  constructor(agentIds: readonly string[], options: { ttlMs?: number; now?: () => number } = {}) {
    this.protectedAgents = new Set(agentIds);
    this.ttlMs = options.ttlMs ?? 30_000;
    if (!Number.isFinite(this.ttlMs) || this.ttlMs <= 0) throw new Error("invalid assistant claim TTL");
    this.now = options.now ?? (() => performance.now());
  }

  capability() {
    return { capability: ASSISTANT_CLAIMS_CAPABILITY, agentIds: [...this.protectedAgents], ttlMs: this.ttlMs };
  }

  acquire(agentId: string, holderId: string) {
    this.requireAgent(agentId);
    if (typeof holderId !== "string" || !holderId.trim() || holderId.length > 256) throw new AssistantClaimError("invalid_assistant_holder", 400);
    const current = this.leases.get(agentId);
    if (current && (current.deadline > this.now() || current.admitted > 0)) {
      throw new AssistantClaimError("assistant_claim_busy", 409, Math.max(0, current.deadline - this.now()));
    }
    const lease = { token: randomBytes(32).toString("hex"), holderId, deadline: this.now() + this.ttlMs, admitted: 0 };
    this.leases.set(agentId, lease);
    return { agentId, token: lease.token, ttlMs: this.ttlMs };
  }

  renew(agentId: string) {
    const lease = this.authorized(agentId);
    lease.deadline = this.now() + this.ttlMs;
    return { agentId, ttlMs: this.ttlMs };
  }

  release(agentId: string) {
    const lease = this.authorized(agentId);
    lease.deadline = -Infinity;
    if (!lease.admitted) this.leases.delete(agentId);
    return { ok: true, draining: lease.admitted > 0 };
  }

  withToken<T>(token: string | undefined, action: () => T): T {
    return this.context.run(token, action);
  }

  async admit<T>(agentId: string | undefined, action: () => Promise<T>): Promise<T> {
    if (!agentId || !this.protectedAgents.has(agentId)) return action();
    const lease = this.authorized(agentId);
    lease.admitted++;
    try { return await action(); }
    finally { lease.admitted--; }
  }

  commandAgent(command: ControlCommand): string | undefined {
    switch (command.kind) {
      case "actor.upsert": return command.actor.id;
      case "agent.upsert": return command.agent.id;
      case "agent.endpoint.upsert": return command.endpoint.agentId;
      case "conversation.post": return command.message.actorId;
      case "agent.invoke": return this.invocationAgent(command.invocation);
      default: return undefined;
    }
  }

  invocationAgent(request: InvocationRequest): string | undefined {
    // An ordinary ask to the assistant is not an answerer registration. The
    // legacy web runner delegates its answers under this explicit provenance.
    return this.provenanceAgent(request.metadata) ?? request.requesterId;
  }

  deliveryAgent(request: ScoutDeliverRequest): string | undefined {
    return this.provenanceAgent(request.messageMetadata) ?? this.provenanceAgent(request.invocationMetadata)
      ?? request.caller?.actorId ?? request.requesterId;
  }

  private provenanceAgent(metadata?: Record<string, unknown>): string | undefined {
    for (const key of ["source", "generatedBy"]) {
      const value = metadata?.[key];
      if (typeof value === "string" && this.protectedAgents.has(value)) return value;
    }
    return undefined;
  }

  private requireAgent(agentId: string) {
    if (!this.protectedAgents.has(agentId)) throw new AssistantClaimError("unsupported_assistant_identity", 400);
  }

  private authorized(agentId: string): Lease {
    this.requireAgent(agentId);
    const token = this.context.getStore();
    if (!token) throw new AssistantClaimError("assistant_claim_required");
    const lease = this.leases.get(agentId);
    if (!lease || lease.token !== token || lease.deadline <= this.now()) throw new AssistantClaimError("assistant_claim_lost");
    return lease;
  }
}

/** Guard the common client-write boundary, including in-process API shortcuts.
 * Tokens are request context only: never add them to canonical records. */
export function protectAssistantService(service: ActiveScoutBrokerService, claims: BrokerAssistantClaims): ActiveScoutBrokerService {
  return {
    ...service,
    assistantClaims: claims,
    executeCommand: command => claims.admit(claims.commandAgent(command), () => service.executeCommand(command)),
    ...(service.postConversationMessage ? { postConversationMessage: (message: Parameters<NonNullable<ActiveScoutBrokerService["postConversationMessage"]>>[0]) =>
      claims.admit(message.actorId, () => service.postConversationMessage!(message)) } : {}),
    ...(service.deliver ? { deliver: (request: ScoutDeliverRequest, options?: { signal?: AbortSignal }) =>
      claims.admit(claims.deliveryAgent(request), () => service.deliver!(request, options)) } : {}),
    ...(service.invokeAgent ? { invokeAgent: (request: Parameters<NonNullable<ActiveScoutBrokerService["invokeAgent"]>>[0]) =>
      claims.admit(claims.invocationAgent(request), () => service.invokeAgent!(request)) } : {}),
  };
}

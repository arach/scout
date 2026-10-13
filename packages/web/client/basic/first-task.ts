/**
 * The Solo first task: one small, read-only request the operator reviews and
 * sends themselves, followed through its real lifecycle to a result.
 *
 * Everything here is pure so the readiness and lifecycle rules can be tested
 * without a broker. The UI (FirstTask.tsx) feeds it observations — the
 * roster, runtime readiness, broker health, flights, operator attention — and
 * renders what comes back. Nothing in this module may claim readiness or
 * progress that an observation did not show.
 */
import { isSyntheticAgentId } from "../lib/synthetic-agent-routing.ts";
import { isAgentBlocked } from "../lib/agent-state.ts";
import type { Agent, AgentConfigurationRuntime } from "../lib/types.ts";

/* ── Readiness ─────────────────────────────────────────────────────────── */

export type FirstTaskRuntime = Pick<AgentConfigurationRuntime, "id" | "label" | "state" | "loginCommand" | "detail">;

export type FirstTaskObservations = {
  /** Web API answered at all. */
  apiOnline: boolean;
  /** `/api/broker/health`; null while unknown or on servers without the route. */
  brokerReachable: boolean | null;
  catalogFailed?: boolean;
  agentsLoaded: boolean;
  agents: readonly Agent[];
  /** `/api/agent-config/snapshot` runtimes; null while unknown. */
  runtimes: readonly FirstTaskRuntime[] | null;
  /** The project setup recorded (`onboarding.projectRoot` / `contextRoot`), if any. */
  projectRoot: string | null;
};

export type FirstTaskCandidate = {
  agent: Agent;
  runtime: FirstTaskRuntime | null;
  /** True when the agent's harness runtime reported `ready`. */
  ready: boolean;
};

export type FirstTaskReadiness =
  | { kind: "checking" }
  | { kind: "verification_unavailable" }
  | { kind: "scout_offline" }
  | { kind: "broker_unreachable" }
  /** No agent is registered for any project yet. */
  | { kind: "no_agent" }
  /** Agents exist, but none has a signed-in runtime; `login` names the fix. */
  | { kind: "runtime_not_ready"; candidates: FirstTaskCandidate[]; login: { label: string; command: string | null }[] }
  | { kind: "ready"; candidates: FirstTaskCandidate[] };

function normalizedHarness(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function samePath(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = (a ?? "").replace(/\/+$/, "");
  const right = (b ?? "").replace(/\/+$/, "");
  return Boolean(left) && left === right;
}

/** Agents a first task can address: real, registered, local-addressable, not retired. */
export function firstTaskAgents(agents: readonly Agent[]): Agent[] {
  return agents.filter((agent) =>
    !isSyntheticAgentId(agent.id)
    && !isAgentBlocked(agent)
    && Boolean(agent.harness)
    && agent.agentClass !== "operator"
    && agent.id !== "scoutbot",
  );
}

/**
 * Rank candidates: ready runtimes first, then the project setup recorded,
 * then the most recently active. A not-ready candidate is kept so the UI can
 * name the exact login it needs.
 */
export function firstTaskCandidates(
  agents: readonly Agent[],
  runtimes: readonly FirstTaskRuntime[] | null,
  projectRoot: string | null,
): FirstTaskCandidate[] {
  const runtimeById = new Map((runtimes ?? []).map((runtime) => [normalizedHarness(runtime.id), runtime]));
  return firstTaskAgents(agents)
    .map((agent) => {
      const runtime = runtimeById.get(normalizedHarness(agent.harness)) ?? null;
      // Unknown runtime catalog: don't invent readiness either way. An agent
      // whose harness the catalog doesn't list is treated as unverified.
      return { agent, runtime, ready: runtime?.state === "ready" };
    })
    .sort((left, right) =>
      Number(right.ready) - Number(left.ready)
      || Number(samePath(right.agent.projectRoot, projectRoot)) - Number(samePath(left.agent.projectRoot, projectRoot))
      || (right.agent.updatedAt ?? 0) - (left.agent.updatedAt ?? 0)
      || left.agent.name.localeCompare(right.agent.name),
    );
}

export function firstTaskReadiness(observed: FirstTaskObservations): FirstTaskReadiness {
  if (!observed.apiOnline) return observed.agentsLoaded ? { kind: "scout_offline" } : { kind: "checking" };
  if (observed.brokerReachable === null || observed.catalogFailed) return { kind: "verification_unavailable" };
  if (observed.brokerReachable === false) return { kind: "broker_unreachable" };
  if (!observed.agentsLoaded || observed.runtimes === null) return { kind: "checking" };
  const candidates = firstTaskCandidates(observed.agents, observed.runtimes, observed.projectRoot);
  if (candidates.length === 0) return { kind: "no_agent" };
  if (candidates.some((candidate) => candidate.ready)) {
    return { kind: "ready", candidates: candidates.filter((candidate) => candidate.ready) };
  }
  const seen = new Set<string>();
  const login: { label: string; command: string | null }[] = [];
  for (const candidate of candidates) {
    const key = normalizedHarness(candidate.agent.harness);
    if (seen.has(key)) continue;
    seen.add(key);
    login.push({
      label: candidate.runtime?.label ?? candidate.agent.harness ?? key,
      command: candidate.runtime?.loginCommand ?? null,
    });
  }
  return { kind: "runtime_not_ready", candidates, login };
}

/* ── The task ──────────────────────────────────────────────────────────── */

/** A small, read-only starter the operator reviews and may edit before sending. */
export function suggestedFirstTask(projectLabel: string | null): string {
  const where = projectLabel ? ` ${projectLabel}` : " this project";
  return [
    `Read-only task: take a quick look at${where} and tell me, in 3–5 bullets, what it is and how it is organized.`,
    "Do not change, create, or delete any files, and do not run commands that modify anything.",
  ].join(" ");
}

export function projectLabelFor(agent: Pick<Agent, "project" | "projectRoot"> | null): string | null {
  if (!agent) return null;
  if (agent.project?.trim()) return agent.project.trim();
  const root = agent.projectRoot?.replace(/\/+$/, "");
  return root ? root.split("/").pop() || root : null;
}

/* ── Lifecycle ─────────────────────────────────────────────────────────── */

export type FirstTaskPhase =
  | "sending"
  | "accepted"
  | "starting"
  | "running"
  | "awaiting_input"
  | "completed"
  | "failed"
  | "cancelled"
  | "unknown";

export const FIRST_TASK_PHASE_LABEL: Record<FirstTaskPhase, string> = {
  sending: "Sending",
  accepted: "Accepted",
  starting: "Starting",
  running: "Running",
  awaiting_input: "Awaiting input",
  completed: "Check reply",
  failed: "Failed",
  cancelled: "Cancelled",
  unknown: "Unknown",
};

/** The steps the lifecycle strip shows, in order. Terminal failures replace the tail. */
export const FIRST_TASK_STEPS: readonly FirstTaskPhase[] = ["accepted", "starting", "running", "completed"];

export function isTerminalPhase(phase: FirstTaskPhase): boolean {
  return phase === "completed" || phase === "failed" || phase === "cancelled";
}

/**
 * Broker flight states → what the operator is told. `queued` means the broker
 * accepted the ask; `waking` means it is starting the agent; `waiting` is the
 * agent asking for something (an approval or an answer).
 */
export function phaseForFlightState(state: string | null | undefined): FirstTaskPhase {
  switch ((state ?? "").trim().toLowerCase()) {
    case "queued":
    case "pending":
      return "accepted";
    case "waking":
      return "starting";
    case "running":
      return "running";
    case "waiting":
      return "awaiting_input";
    case "completed":
    case "succeeded":
      return "completed";
    case "failed":
    case "error":
      return "failed";
    case "cancelled":
    case "canceled":
      return "cancelled";
    default:
      return "unknown";
  }
}

/** Where the strip should mark progress up to, given the current phase. */
export function stepIndexForPhase(phase: FirstTaskPhase): number {
  switch (phase) {
    case "sending":
      return -1;
    case "accepted":
      return 0;
    case "starting":
      return 1;
    case "running":
    case "awaiting_input":
      return 2;
    case "completed":
      return 3;
    default:
      return -1;
  }
}

/* ── Persistence (authenticated broker/operator scope) ─────────────────────────────────────────── */

export const FIRST_TASK_STORAGE_KEY = "scout:solo:first-task:v2";

export type FirstTaskRecord = {
  flightId: string;
  invocationId?: string | null;
  workId?: string | null;
  conversationId: string;
  messageId: string | null;
  agentId: string;
  agentName: string;
  body: string;
  sentAt: number;
  /** Last phase seen, so a reload paints something true before the next read. */
  lastPhase: FirstTaskPhase;
};

/** The selected card is a routing request, not the actor that executes it. */
export function firstTaskExecutionTarget(response: {
  targetAgentId?: string | null;
  flight?: { targetAgentId?: string | null } | null;
}): string {
  const target = response.targetAgentId?.trim();
  const flightTarget = response.flight?.targetAgentId?.trim();
  if (target && flightTarget && target !== flightTarget) {
    throw new Error("Scout returned conflicting execution targets. Inspect the request in Dispatch before sending again.");
  }
  const resolved = target || flightTarget;
  if (!resolved) throw new Error("Scout returned no execution target. Inspect the request in Dispatch before sending again.");
  return resolved;
}

export type FirstTaskStore = {
  /** "Skip for now" — the card collapses to a resume chip. */
  skippedAt: number | null;
  /** The operator closed a finished first task; Home stops showing it. */
  dismissedAt: number | null;
  task: FirstTaskRecord | null;
};

export const EMPTY_FIRST_TASK_STORE: FirstTaskStore = { skippedAt: null, dismissedAt: null, task: null };

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseFirstTaskStore(raw: string | null): FirstTaskStore {
  if (!raw) return EMPTY_FIRST_TASK_STORE;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const task = value.task && typeof value.task === "object" ? value.task as Record<string, unknown> : null;
    const flightId = asString(task?.flightId);
    const conversationId = asString(task?.conversationId);
    const agentId = asString(task?.agentId);
    const sentAt = asNumber(task?.sentAt);
    const lastPhase = asString(task?.lastPhase) as FirstTaskPhase | null;
    return {
      skippedAt: asNumber(value.skippedAt),
      dismissedAt: asNumber(value.dismissedAt),
      task: flightId && conversationId && agentId && sentAt
        ? {
          flightId,
          invocationId: asString(task?.invocationId),
          workId: asString(task?.workId),
          conversationId,
          agentId,
          sentAt,
          messageId: asString(task?.messageId),
          agentName: asString(task?.agentName) ?? agentId,
          body: asString(task?.body) ?? "",
          lastPhase: lastPhase && lastPhase in FIRST_TASK_PHASE_LABEL ? lastPhase : "unknown",
        }
        : null,
    };
  } catch {
    return EMPTY_FIRST_TASK_STORE;
  }
}

export function firstTaskStorageKey(identity: string | null): string | null {
  return identity ? `${FIRST_TASK_STORAGE_KEY}:${encodeURIComponent(identity)}` : null;
}

export function readFirstTaskStore(identity: string | null = null): FirstTaskStore {
  try {
    const key = firstTaskStorageKey(identity);
    return key ? parseFirstTaskStore(window.localStorage.getItem(key)) : EMPTY_FIRST_TASK_STORE;
  } catch {
    return EMPTY_FIRST_TASK_STORE;
  }
}

export function writeFirstTaskStore(store: FirstTaskStore, identity: string | null = null): void {
  try {
    const key = firstTaskStorageKey(identity);
    if (key) window.localStorage.setItem(key, JSON.stringify(store));
  } catch {
    /* private window / blocked storage: the flow still works for this visit */
  }
}

export type FirstTaskScopedState = { identity: string | null; store: FirstTaskStore };

/** React must receive its original state on a no-op, not a new wrapper.
 * This also prevents an unchanged observed phase from rewriting storage.
 */
export function updateFirstTaskScopedState(
  current: FirstTaskScopedState,
  identity: string | null,
  next: (store: FirstTaskStore) => FirstTaskStore,
  persist: (store: FirstTaskStore, identity: string | null) => void = writeFirstTaskStore,
): FirstTaskScopedState {
  const value = next(current.identity === identity ? current.store : EMPTY_FIRST_TASK_STORE);
  if (current.identity === identity && value === current.store) return current;
  persist(value, identity);
  return { identity, store: value };
}

/** What Home shows for the first task. */
export type FirstTaskPresentation = "card" | "resume_chip" | "hidden";

export function firstTaskPresentation(store: FirstTaskStore): FirstTaskPresentation {
  if (store.dismissedAt) return "hidden";
  if (store.skippedAt && !store.task) return "resume_chip";
  return "card";
}

/* ── Result + approvals ────────────────────────────────────────────────── */

export type FirstTaskMessage = {
  id: string;
  actorId: string;
  class?: string;
  body: string;
  createdAt: number;
  replyToMessageId: string | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * The agent's answer: a reply to the ask message, or one tagged with the
 * flight. Uncorrelated chatter is never this task's reply.
 */
export function pickFirstTaskResult(
  messages: readonly FirstTaskMessage[],
  task: Pick<FirstTaskRecord, "agentId" | "messageId" | "flightId" | "sentAt" | "invocationId" | "workId">,
): FirstTaskMessage | null {
  // Positive correlation never overrides explicit conflicts. Same agent/time
  // is not identity: concurrent asks routinely share both.
  return messages.filter((message) => {
    const flightId = asString(message.metadata?.flightId);
    const requestId = message.replyToMessageId;
    const invocationId = asString(message.metadata?.invocationId);
    const workId = asString(message.metadata?.workId) ?? asString(message.metadata?.collaborationRecordId);
    if (message.actorId !== task.agentId || !message.body.trim() || message.class === "status") return false;
    if (requestId && requestId !== task.messageId) return false;
    if (flightId && flightId !== task.flightId) return false;
    if (invocationId && task.invocationId && invocationId !== task.invocationId) return false;
    if (workId && task.workId && workId !== task.workId) return false;
    return Boolean((task.messageId && requestId === task.messageId) || flightId === task.flightId
      || (task.invocationId && invocationId === task.invocationId) || (task.workId && workId === task.workId));
  }).sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))[0] ?? null;
}

export type FirstTaskApprovalItem = {
  id: string;
  kind: string;
  title: string;
  summary?: string | null;
  agentId?: string | null;
  agentName?: string | null;
  conversationId?: string | null;
  sourceLabel?: string | null;
  updatedAt?: number | null;
  approval?: {
    sessionId: string;
    turnId: string;
    blockId: string;
    version: number;
    title?: string;
    description?: string;
    adapterType?: string;
    sessionName?: string;
    risk?: string;
  } | null;
};

/**
 * Session-level attention lacks authoritative ask ownership. This flow must
 * remain non-actionable until the API provides exact execution correlation.
 */
export function approvalsForFirstTask(
  items: readonly FirstTaskApprovalItem[],
  task: Pick<FirstTaskRecord, "agentId" | "conversationId">,
  flightSessionIds: readonly string[],
): FirstTaskApprovalItem[] {
  // The attention API carries session/turn/block/version, but no authoritative
  // ask/attempt identity. Even a current session may serve overlapping asks.
  // Do not offer a decision for guessed work; the owning harness owns unblock.
  void items; void task; void flightSessionIds;
  return [];
}

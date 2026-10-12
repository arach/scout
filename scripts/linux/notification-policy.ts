import type { ActorIdentity, ControlEvent, ConversationDefinition, InvocationRequest, MessageRecord } from "../../packages/protocol/src/index.js";

export type NotificationSettings = {
  enabled: boolean;
  inbound: boolean;
  outbound: boolean;
  attention: boolean;
  previews: boolean;
  scope: "all" | "operator";
  maxPerMinute: number;
};

export const defaultSettings: NotificationSettings = {
  enabled: true, inbound: true, outbound: true, attention: true,
  previews: true, scope: "all", maxPerMinute: 12,
};

export function parseSettings(value: unknown): NotificationSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Notification settings must be an object");
  const result = { ...defaultSettings };
  for (const [key, item] of Object.entries(value)) {
    if (!Object.hasOwn(defaultSettings, key)) throw new Error(`Unknown notification setting: ${key}`);
    if (key === "scope") {
      if (item !== "all" && item !== "operator") throw new Error("scope must be all or operator");
      result.scope = item;
    } else if (key === "maxPerMinute") {
      if (!Number.isInteger(item) || Number(item) < 1 || Number(item) > 120) throw new Error("maxPerMinute must be 1–120");
      result.maxPerMinute = Number(item);
    } else {
      if (typeof item !== "boolean") throw new Error(`${key} must be true or false`);
      (result as unknown as Record<string, unknown>)[key] = item;
    }
  }
  return result;
}

export type DesktopNotification = {
  key: string;
  category: "inbound" | "outbound" | "attention";
  title: string;
  body: string;
  path: string;
};

export function plainPreview(text: string, limit = 240): string {
  return text.replace(/\[ask:[^\]]+\]\s*/g, "").replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, limit);
}

// Notifications render body markup. Escape message text rather than treating
// agent-authored text as links, images, or commands.
export function escapeMarkup(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export class NotificationProjection {
  nodeId = "";
  readonly actors = new Map<string, ActorIdentity>();
  readonly conversations = new Map<string, Pick<ConversationDefinition, "id" | "participantIds" | "title">>();
  readonly invocations = new Map<string, Pick<InvocationRequest, "id" | "requesterId" | "conversationId" | "metadata"> & { task?: string }>();
  private readonly attentionStates = new Map<string, string>();

  hydrate(snapshot: { actors?: Record<string, ActorIdentity>; conversations?: Record<string, Pick<ConversationDefinition, "id" | "participantIds" | "title">>; invocations?: Record<string, Pick<InvocationRequest, "id" | "requesterId" | "conversationId" | "metadata"> & { task?: string }> }): void {
    for (const actor of Object.values(snapshot.actors ?? {})) this.actors.set(actor.id, actor);
    for (const conversation of Object.values(snapshot.conversations ?? {})) this.conversations.set(conversation.id, conversation);
    for (const invocation of Object.values(snapshot.invocations ?? {}).slice(-2000)) this.invocations.set(invocation.id, invocation);
  }

  label(id: string): string {
    return id === "operator" ? "You" : plainPreview(this.actors.get(id)?.displayName ?? id, 80);
  }

  private forOperator(message: MessageRecord): boolean {
    const conversation = this.conversations.get(message.conversationId);
    return message.actorId === "operator"
      || !!message.mentions?.some(mention => mention.actorId === "operator")
      || [message.audience?.notify, message.audience?.invoke, message.audience?.visibleTo].some(ids => ids?.includes("operator"))
      || !!conversation?.participantIds.includes("operator");
  }

  private message(message: MessageRecord, settings: NotificationSettings): DesktopNotification | null {
    const metadata = message.metadata ?? {};
    const signal = metadata.operatorSignal as { kind?: string } | undefined;
    const requiresAttention = signal?.kind === "need" || metadata.operatorAttention === "delivery_issue" || metadata.routingState === "failed";
    if (requiresAttention) {
      if (!settings.attention) return null;
      return {
        key: `message:${message.id}`, category: "attention",
        title: signal?.kind === "need" ? `Scout · ${this.label(message.actorId)} needs you` : "Scout · Delivery needs attention",
        body: settings.previews ? plainPreview(message.body) : "Open Scout to review the request.",
        path: `/messages/${encodeURIComponent(message.conversationId)}`,
      };
    }
    if (message.class !== "agent") return null;
    if (settings.scope === "operator" && !this.forOperator(message)) return null;
    // Human conversations are directional relative to the operator. Other
    // traffic is directional relative to this broker's node, never body text.
    const category = message.actorId === "operator" ? "outbound"
      : this.forOperator(message) ? "inbound"
      : message.originNodeId === this.nodeId ? "outbound" : "inbound";
    if (!this.nodeId || !settings[category]) return null;
    const conversation = this.conversations.get(message.conversationId);
    const recipients = new Set([...(message.audience?.invoke ?? []), ...(message.audience?.notify ?? []),
      ...(conversation?.participantIds ?? [])].filter(id => id !== message.actorId));
    const destination = recipients.size ? [...recipients].slice(0, 2).map(id => this.label(id)).join(", ")
      : plainPreview(conversation?.title ?? "Scout", 80);
    return {
      key: `message:${message.id}`, category,
      title: `Scout · ${category === "inbound" ? "Incoming" : "Outgoing"} · ${this.label(message.actorId)} → ${destination}`,
      body: settings.previews ? plainPreview(message.body) || "Message with attachments" : "Open Scout to read the message.",
      path: `/messages/${encodeURIComponent(message.conversationId)}`,
    };
  }

  project(event: ControlEvent, settings: NotificationSettings): DesktopNotification | null {
    // Keep routing metadata current even while notifications are disabled.
    if (event.kind === "actor.registered") this.actors.set(event.payload.actor.id, event.payload.actor);
    if (event.kind === "agent.registered") this.actors.set(event.payload.agent.id, event.payload.agent);
    if (event.kind === "conversation.upserted") this.conversations.set(event.payload.conversation.id, event.payload.conversation);
    if (event.kind === "invocation.requested") {
      this.invocations.set(event.payload.invocation.id, event.payload.invocation);
      if (this.invocations.size > 2000) this.invocations.delete(this.invocations.keys().next().value!);
    }
    if (!settings.enabled) return null;
    if (event.kind === "message.posted") return this.message(event.payload.message, settings);
    if (event.kind === "collaboration.upserted") {
      const record = event.payload.record;
      const needsYou = record.nextMoveOwnerId === "operator"
        || (record.kind === "question" && record.ownerId === "operator");
      const alertable = needsYou && (record.kind === "question" ? record.state === "open" : ["waiting", "review"].includes(record.state));
      const state = alertable ? `${record.state}:${record.nextMoveOwnerId ?? record.ownerId}` : "";
      const previous = this.attentionStates.get(record.id);
      this.attentionStates.set(record.id, state);
      if (this.attentionStates.size > 2000) this.attentionStates.delete(this.attentionStates.keys().next().value!);
      if (!settings.attention || !alertable || previous === state) return null;
      return {
        key: `attention:${record.id}:${event.id}`, category: "attention", title: "Scout · Your input is needed",
        body: settings.previews ? plainPreview(record.title) : "Open Scout to review the request.",
        path: record.conversationId ? `/messages/${encodeURIComponent(record.conversationId)}` : "/requests",
      };
    }
    if (event.kind === "flight.updated" && settings.attention) {
      const flight = event.payload.flight;
      const invocation = this.invocations.get(flight.invocationId);
      if (!invocation || !["completed", "failed"].includes(flight.state)) return null;
      if (flight.state === "completed" && invocation.metadata?.replyMode !== "notify") return null;
      if (settings.scope === "operator" && invocation.requesterId !== "operator") return null;
      return {
        key: `flight:${flight.id}:${flight.state}`, category: "attention",
        title: `Scout · ${this.label(flight.targetAgentId)} ${flight.state === "failed" ? "failed" : "finished"}`,
        body: settings.previews ? plainPreview(flight.error || flight.summary || invocation.task || "Open Scout for the result.") : "Open Scout for the result.",
        path: invocation.conversationId ? `/messages/${encodeURIComponent(invocation.conversationId)}` : `/flights/${encodeURIComponent(flight.id)}/observe`,
      };
    }
    return null;
  }
}

/** No backlog on startup: only live SSE frames are consumed. */
export class SseDecoder {
  private buffer = "";
  private data: string[] = [];
  private event = "message";
  private frameSize = 0;

  constructor(private readonly emit: (event: string, data: string) => void) {}

  push(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > 2_000_000) throw new Error("Broker SSE line exceeded its limit");
    let end: number;
    while ((end = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, end).replace(/\r$/, "");
      this.buffer = this.buffer.slice(end + 1);
      this.frameSize += line.length;
      if (this.frameSize > 2_000_000) throw new Error("Broker SSE frame exceeded its limit");
      if (!line) {
        if (this.data.length) this.emit(this.event, this.data.join("\n"));
        this.data = []; this.event = "message"; this.frameSize = 0;
      } else if (line.startsWith("event:")) this.event = line.slice(6).trim();
      else if (line.startsWith("data:")) this.data.push(line.slice(5).replace(/^ /, ""));
    }
  }
}

export class NotificationGate {
  private readonly recent = new Set<string>();
  private readonly times: number[] = [];

  constructor(keys: string[] = []) { for (const key of keys.slice(-1000)) this.recent.add(key); }

  admit(notification: DesktopNotification, maxPerMinute: number, now = Date.now()): boolean {
    if (this.recent.has(notification.key)) return false;
    this.recent.add(notification.key);
    if (this.recent.size > 1000) this.recent.delete(this.recent.values().next().value!);
    while (this.times.length && this.times[0]! <= now - 60_000) this.times.shift();
    // Attention has its own lifecycle dedupe and never loses to chat bursts.
    if (notification.category === "attention") return true;
    if (this.times.length >= maxPerMinute) return false;
    this.times.push(now);
    return true;
  }

  keys(): string[] { return [...this.recent]; }
}

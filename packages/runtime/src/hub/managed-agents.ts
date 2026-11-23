/**
 * Scout Hub's pull connector for Claude Managed Agents. Anthropic already keeps
 * each session's full event history, so nothing runs in the sandbox: the
 * runtime lists recent sessions with an API key, fetches the events it has not
 * mirrored yet, and appends them to local files that the Managed Agents tail
 * source reads.
 *
 * Under <OPENSCOUT_HOME>/hub:
 *   managed-agents.json         API key, label and look-back window (0600)
 *   managed-agents.state.json   per-session progress (0600)
 *   managed-agents.status.json  what the last pass did
 *   managed-agents/<label>/<session>.jsonl         one event per line, in server order
 *   managed-agents/<label>/<session>.session.json  title, status and agent of the session
 *
 * The connector only reads. It never sends events, archives or deletes.
 */

import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import Anthropic from "@anthropic-ai/sdk";

import { takeHubPassLock } from "./pass-lock.js";
import { recordActivity } from "./activity.js";
import { readInboxObservation } from "./inbox-health.js";
import { loadHubConfig, readHubJson as readJson, writePrivateJson, resolveHubHome, resolveManagedAgentsMirrorRoot, type ManagedAgentsSessionMeta } from "./state.js";

export { resolveManagedAgentsMirrorRoot, type ManagedAgentsSessionMeta };

const CONFIG_FILE = "managed-agents.json";
const STATE_FILE = "managed-agents.state.json";
const STATUS_FILE = "managed-agents.status.json";
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/u;

export type ManagedAgentsConfig = {
  v: 1;
  /** Folder name for this workspace's sessions under the mirror root. */
  label: string;
  apiKey: string;
  /** Only for tests and proxies; the SDK default otherwise. */
  baseURL?: string;
  /** How far back to list sessions. */
  lookbackDays: number;
  createdAt: string;
};


type SessionProgress = {
  updatedAt: string;
  /** processed_at of the newest mirrored event. */
  lastProcessedAt: string | null;
  /** Ids of the mirrored events that share lastProcessedAt, so a resume skips them. */
  idsAtLast: string[];
  events: number;
  lastNoteAt?: string;
  unannouncedAt?: string;
};

type ProgressState = { v: 1; sessions: Record<string, SessionProgress> };

export type ManagedAgentsPullSummary = {
  at: string;
  configured: boolean;
  listed: number;
  changed: number;
  appended: number;
  sessions: string[];
  keyRejectedSince?: string;
  error?: string;
  notes: string[];
  /** When the last webhook note arrived through the inbox, if any. */
  lastWebhookAt?: string;
};


export const WEBHOOK_GRACE_MS = 120_000;

export function isSessionId(id: string): boolean {
  return SESSION_ID.test(id) && !Object.hasOwn(Object.prototype, id);
}

export function unannouncedSessions(home: string, enabledSince: string, now: number) {
  const state = readJson<ProgressState>(join(home, STATE_FILE));
  return Object.entries(state?.sessions ?? {}).flatMap(([id, p]) =>
    p.unannouncedAt && p.unannouncedAt >= enabledSince && now - Date.parse(p.unannouncedAt) >= WEBHOOK_GRACE_MS
      && now - Date.parse(p.unannouncedAt) < 86_400_000 ? [{ id, since: p.unannouncedAt }] : []);
}

export function isValidManagedAgentsLabel(label: string): boolean {
  return LABEL.test(label) && label !== "." && label !== "..";
}

export function loadManagedAgentsConfig(home = resolveHubHome()): ManagedAgentsConfig | null {
  const config = readJson<ManagedAgentsConfig>(join(home, CONFIG_FILE));
  if (!config) return null;
  if (config.v !== 1 || typeof config.apiKey !== "string" || !config.apiKey || !isValidManagedAgentsLabel(config.label ?? "")) {
    throw new Error(`${join(home, CONFIG_FILE)} is not a valid Managed Agents config`);
  }
  return config;
}

export function saveManagedAgentsConfig(config: ManagedAgentsConfig, home = resolveHubHome()): void {
  if (!isValidManagedAgentsLabel(config.label)) throw new Error(`Label "${config.label}" must be letters, digits, dot, dash or underscore`);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writePrivateJson(join(home, CONFIG_FILE), config);
}

/** Removes the key and progress. Mirrored sessions stay, like other transcripts. */
export function removeManagedAgentsConfig(home = resolveHubHome()): boolean {
  const existed = existsSync(join(home, CONFIG_FILE));
  for (const name of [CONFIG_FILE, STATE_FILE, STATUS_FILE]) rmSync(join(home, name), { force: true });
  return existed;
}

export function readManagedAgentsStatus(home = resolveHubHome()): ManagedAgentsPullSummary | null {
  try {
    return readJson<ManagedAgentsPullSummary>(join(home, STATUS_FILE));
  } catch {
    return null;
  }
}

export function managedAgentsSessionPaths(root: string, label: string, sessionId: string): { events: string; meta: string } | null {
  if (!isValidManagedAgentsLabel(label) || !isSessionId(sessionId)) return null;
  const dir = join(root, label);
  return { events: join(dir, `${sessionId}.jsonl`), meta: join(dir, `${sessionId}.session.json`) };
}

type SessionLike = {
  id: string;
  title?: string | null;
  status: string;
  agent?: { id: string; name: string; version: number } | null;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
};

type EventLike = { id: string; type: string; processed_at?: string | null };

function metaFromSession(session: SessionLike): ManagedAgentsSessionMeta {
  return {
    id: session.id,
    title: session.title ?? null,
    status: session.status,
    agent: session.agent ? { id: session.agent.id, name: session.agent.name, version: session.agent.version } : null,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    archivedAt: session.archived_at ?? null,
  };
}

export type ManagedAgentsPullerOptions = {
  home?: string;
  mirrorRoot?: string;
  intervalMs?: number;
  /** The slower full poll used while webhook notes keep arriving. */
  webhookIntervalMs?: number;
  /** Upper bound on sessions listed per pass. */
  maxSessions?: number;
  /** Builds the client; tests pass one pointed at a fake server. */
  client?: (config: ManagedAgentsConfig) => Anthropic;
  log?: (message: string) => void;
  now?: () => number;
};

export class ManagedAgentsPuller {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<ManagedAgentsPullSummary> | null = null;
  private stopped = true;
  private lastError: string | null = null;
  private lastWebhookAt: number | null = null;
  private full: Promise<ManagedAgentsPullSummary> | null = null;

  constructor(private readonly options: ManagedAgentsPullerOptions = {}) {}

  /** A webhook and an operator re-pull share the targeted path. Only a real
   * note supplies received, so a manual repair never counts as a webhook. */
  nudge(id: string, received?: string): Promise<ManagedAgentsPullSummary> {
    if (!isSessionId(id)) throw new Error("Invalid Managed Agents session id.");
    return this.serialize({ id, received });
  }

  private nextDelay(): number {
    const now = this.options.now?.() ?? Date.now();
    const webhooksLive = this.lastWebhookAt !== null && now - this.lastWebhookAt < 24 * 3_600_000;
    return webhooksLive ? this.options.webhookIntervalMs ?? 120_000 : this.options.intervalMs ?? 15_000;
  }

  private get home(): string {
    return this.options.home ?? resolveHubHome();
  }

  private get mirrorRoot(): string {
    return this.options.mirrorRoot ?? resolveManagedAgentsMirrorRoot();
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(2_000);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.running?.catch(() => undefined);
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.pullOnce().finally(() => this.schedule(this.nextDelay()));
    }, delayMs);
    this.timer.unref?.();
  }

  /** One pass. Concurrent calls share the pass in progress. */
  pullOnce(): Promise<ManagedAgentsPullSummary> {
    this.full ??= this.serialize().finally(() => { this.full = null; });
    return this.full;
  }

  private async serialize(target?: { id: string; received?: string }): Promise<ManagedAgentsPullSummary> {
    while (this.running) await this.running;
    this.running = this.pass(target).finally(() => { this.running = null; });
    return this.running;
  }

  private async pass(target?: { id: string; received?: string }): Promise<ManagedAgentsPullSummary> {
    const now = this.options.now?.() ?? Date.now();
    const summary: ManagedAgentsPullSummary = { at: new Date(now).toISOString(), configured: false, listed: 0, changed: 0, appended: 0, sessions: [], notes: [] };

    let config: ManagedAgentsConfig | null;
    try {
      config = loadManagedAgentsConfig(this.home);
    } catch (error) {
      summary.error = error instanceof Error ? error.message : String(error);
      return this.finish(summary);
    }
    if (!config) return summary;
    summary.configured = true;

    const release = takeHubPassLock(this.home, "managed-agents");
    if (!release) { summary.notes.push("another pull is running"); return summary; }
    try {
      const client = this.options.client?.(config)
        ?? new Anthropic({ apiKey: config.apiKey, ...(config.baseURL ? { baseURL: config.baseURL } : {}), maxRetries: 2, timeout: 60_000 });
      const last = readManagedAgentsStatus(this.home)?.lastWebhookAt;
      this.lastWebhookAt = last ? Date.parse(last) : null;
      if (target?.received) this.lastWebhookAt = Math.max(this.lastWebhookAt ?? 0, Date.parse(target.received));
      if (this.lastWebhookAt !== null) summary.lastWebhookAt = new Date(this.lastWebhookAt).toISOString();
      await this.pull(client, config, now, summary, target);
      this.lastError = null;
    } catch (error) {
      summary.error = target && error instanceof Anthropic.NotFoundError
        ? "Managed Agents session not found (404)" : describeError(error);
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
        summary.keyRejectedSince = readManagedAgentsStatus(this.home)?.keyRejectedSince ?? summary.at;
      }
    }
    try {
      return this.finish(summary);
    } finally {
      release();
    }
  }

  private async pull(client: Anthropic, config: ManagedAgentsConfig, now: number, summary: ManagedAgentsPullSummary, target?: { id: string; received?: string }): Promise<void> {
    const statePath = join(this.home, STATE_FILE);
    const state: ProgressState = readJson<ProgressState>(statePath) ?? { v: 1, sessions: {} };
    const since = new Date(now - Math.max(1, config.lookbackDays) * 86_400_000).toISOString();
    const max = this.options.maxSessions ?? 200;
    const changed: SessionLike[] = [];
    let enabledSince: string | null = null;
    if (target) {
      if (target.received) {
        // A note is evidence even when the vendor read fails. Record receipt
        // before retrieval so a later backstop does not infer a missed webhook.
        const prior = state.sessions[target.id] ??= { updatedAt: "", lastProcessedAt: null, idsAtLast: [], events: 0 };
        if (!prior.lastNoteAt || target.received > prior.lastNoteAt) prior.lastNoteAt = target.received;
        if (prior.unannouncedAt && Date.parse(target.received) >= Date.parse(prior.unannouncedAt) - WEBHOOK_GRACE_MS) {
          delete prior.unannouncedAt;
        }
        writePrivateJson(statePath, state);
      }
      const session = await client.beta.sessions.retrieve(target.id);
      if (session.id !== target.id) throw new Error("Managed Agents returned a different session.");
      changed.push(session); // Force the event cursor read, even if metadata did not change.
      summary.listed = 1;
    } else {
      const inbox = loadHubConfig(this.home)?.inbox;
      enabledSince = inbox ? readInboxObservation(this.home, inbox)?.enabledSince ?? null : null;
      for await (const session of client.beta.sessions.list({ "created_at[gte]": since, order: "desc", limit: 100, include_archived: true })) {
        summary.listed += 1;
        const paths = managedAgentsSessionPaths(this.mirrorRoot, config.label, session.id);
        if (!paths) { summary.notes.push("Skipped an invalid session id."); continue; }
        const progress = state.sessions[session.id];
        if (!progress || progress.updatedAt !== session.updated_at || !existsSync(paths.events)) changed.push(session);
        if (summary.listed >= max) break;
      }
    }
    // Oldest first, so a pass cut short by an error still advances in order.
    for (const session of changed.reverse()) {
      try {
        const prior = state.sessions[session.id];
        const metadataChanged = prior?.updatedAt !== session.updated_at;
        const appended = await this.pullSession(client, config, session, state);
        if (metadataChanged || appended || !target) summary.changed++;
        const progress = state.sessions[session.id]!;
        if (!target && enabledSince && metadataChanged && Date.parse(session.updated_at) >= Date.parse(enabledSince)
          && (!progress.lastNoteAt || now - Date.parse(progress.lastNoteAt) > WEBHOOK_GRACE_MS)) {
          if (!progress.unannouncedAt || progress.unannouncedAt < enabledSince || now - Date.parse(progress.unannouncedAt) >= 86_400_000) {
            progress.unannouncedAt = summary.at;
          }
        }
        summary.appended += appended;
        if (appended > 0) summary.sessions.push(`${config.label}/${session.id}`);
      } finally {
        writePrivateJson(statePath, state);
      }
    }
  }

  private async pullSession(client: Anthropic, config: ManagedAgentsConfig, session: SessionLike, state: ProgressState): Promise<number> {
    const paths = managedAgentsSessionPaths(this.mirrorRoot, config.label, session.id)!;
    mkdirSync(join(this.mirrorRoot, config.label), { recursive: true, mode: 0o700 });
    const previous = state.sessions[session.id];
    const fileExists = existsSync(paths.events);
    const progress: SessionProgress = previous && fileExists
      ? { ...previous, idsAtLast: [...previous.idsAtLast] }
      : { updatedAt: "", lastProcessedAt: null, idsAtLast: [], events: 0, lastNoteAt: previous?.lastNoteAt };
    if (!fileExists) writeFileSync(paths.events, "", { mode: 0o600 });

    const skip = new Set(progress.idsAtLast);
    const query = { order: "asc" as const, limit: 1000, ...(progress.lastProcessedAt ? { "created_at[gte]": progress.lastProcessedAt } : {}) };
    let batch = "";
    let appended = 0;
    const flush = () => {
      if (batch) appendFileSync(paths.events, batch);
      batch = "";
    };
    try {
      for await (const event of client.beta.sessions.events.list(session.id, query) as AsyncIterable<EventLike>) {
        // A queued user message has no processed_at yet; take it once it is processed.
        if (!event.processed_at) continue;
        if (progress.lastProcessedAt && event.processed_at < progress.lastProcessedAt) continue;
        if (event.processed_at === progress.lastProcessedAt && skip.has(event.id)) continue;
        batch += `${JSON.stringify(event)}\n`;
        appended += 1;
        if (event.processed_at !== progress.lastProcessedAt) {
          progress.lastProcessedAt = event.processed_at;
          progress.idsAtLast = [];
          skip.clear();
        }
        progress.idsAtLast.push(event.id);
        skip.add(event.id);
        if (batch.length > 1 << 20) flush();
      }
    } finally {
      // Keep what was written, even when a page fails; updatedAt moves only on
      // a complete read, so the next pass resumes this session from here.
      flush();
      progress.events += appended;
      state.sessions[session.id] = progress;
    }
    progress.updatedAt = session.updated_at;
    writePrivateJson(paths.meta, metaFromSession(session));
    return appended;
  }

  private finish(summary: ManagedAgentsPullSummary): ManagedAgentsPullSummary {
    if (summary.error && summary.error !== this.lastError) this.options.log?.(`[openscout-runtime] Managed Agents pull failed: ${summary.error}`);
    this.lastError = summary.error ?? null;
    if (summary.changed || summary.appended || summary.error) {
      recordActivity("pull", summary.error ? `Pull failed: ${summary.error}` : `${summary.changed} changed, ${summary.appended} events appended`, this.home);
    }
    if (summary.configured || summary.error) {
      try {
        mkdirSync(this.home, { recursive: true, mode: 0o700 });
        writePrivateJson(join(this.home, STATUS_FILE), summary);
      } catch { /* status is best effort */ }
    }
    return summary;
  }
}

function describeError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return "the API key was rejected (401)";
  if (error instanceof Anthropic.PermissionDeniedError) return "the API key cannot read Managed Agents sessions (403)";
  if (error instanceof Anthropic.NotFoundError) return "the Managed Agents endpoints were not found (404); check the base URL";
  if (error instanceof Anthropic.RateLimitError) return "rate limited (429); the next pass retries";
  if (error instanceof Anthropic.APIError) return `Anthropic API ${error.status ?? "error"}`;
  return "Could not read the Managed Agents session.";
}

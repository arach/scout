/**
 * What Scout Hub is doing on this runtime, read from local files only: the
 * config, the last collect and pull, and the mirrors. No network calls, and no
 * tokens or keys in the result, so a UI can show it as is.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import type { HubCollectSummary } from "./collector.js";
import { readInboxObservation, type Rejections } from "./inbox-health.js";
import { loadManagedAgentsConfig, unannouncedSessions, readManagedAgentsStatus, type ManagedAgentsPullSummary } from "./managed-agents.js";
import {
  loadHubConfig,
  resolveHubClaudeMirrorRoot,
  resolveHubHome,
  resolveManagedAgentsMirrorRoot,
  type ManagedAgentsSessionMeta,
} from "./state.js";

export type HubMirroredSession = {
  label: string;
  sessionId: string;
  bytes: number;
  updatedAt: string;
  title?: string | null;
  status?: string | null;
  agent?: string | null;
};

export type HubIssue = { id: string; severity: "error" | "warning"; title: string; detail: string; since: string; fix: string };
export type HubStatus = {
  issues: HubIssue[];
  claudeCode: {
    configured: boolean;
    inbox: string | null;
    lastCollect: HubCollectSummary | null;
    mirror: string;
    sessions: HubMirroredSession[];
    error?: string;
  };
  managedAgents: {
    configured: boolean;
    label: string | null;
    lookbackDays: number | null;
    lastPull: ManagedAgentsPullSummary | null;
    mirror: string;
    sessions: HubMirroredSession[];
    error?: string;
  };
  webhooks: {
    anthropic: {
      /** Paste this into Anthropic's Console (Manage → Webhooks). Needs an inbox. */
      url: string | null;
      lastWebhookAt: string | null;
    };
  };
};

const SESSION_LIMIT = 50;

function readJson<T>(path: string): T | null {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as T : null;
  } catch {
    return null;
  }
}

/** Mirrored transcripts under `<root>/<label>/<session>.jsonl`, newest first. */
export function listHubMirroredSessions(root: string, limit = Number.POSITIVE_INFINITY): HubMirroredSession[] {
  const out: HubMirroredSession[] = [];
  let labels: string[] = [];
  try { labels = readdirSync(root); } catch { return out; }
  for (const label of labels) {
    let names: string[] = [];
    try { names = readdirSync(join(root, label)); } catch { continue; }
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue;
      try {
        const stats = statSync(join(root, label, name));
        if (stats.isFile()) out.push({ label, sessionId: name.slice(0, -".jsonl".length), bytes: stats.size, updatedAt: stats.mtime.toISOString() });
      } catch { /* removed while listing */ }
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
}

function withMeta(root: string, session: HubMirroredSession): HubMirroredSession {
  const meta = readJson<ManagedAgentsSessionMeta>(join(root, session.label, `${session.sessionId}.session.json`));
  return meta ? { ...session, title: meta.title, status: meta.status, agent: meta.agent?.name ?? null } : session;
}

type LiveHealth = { at: string; failure?: HubCollectSummary["inboxFailure"]; rejections?: Rejections; enabled?: boolean };

export function readHubStatus(home = resolveHubHome(), live?: LiveHealth): HubStatus {
  const env = { ...process.env, OPENSCOUT_HUB_HOME: home };
  const claudeMirror = resolveHubClaudeMirrorRoot(env);
  const managedMirror = resolveManagedAgentsMirrorRoot(env);
  const status: HubStatus = {
    issues: [],
    claudeCode: { configured: false, inbox: null, lastCollect: null, mirror: claudeMirror, sessions: [] },
    managedAgents: { configured: false, label: null, lookbackDays: null, lastPull: null, mirror: managedMirror, sessions: [] },
    webhooks: { anthropic: { url: null, lastWebhookAt: null } },
  };

  try {
    const config = loadHubConfig(home);
    if (config) {
      status.claudeCode.configured = true;
      status.claudeCode.inbox = config.inbox;
      status.webhooks.anthropic.url = `${config.inbox}/v1/inbox/webhooks/anthropic`;
    }
  } catch (error) {
    status.claudeCode.error = error instanceof Error ? error.message : String(error);
  }
  status.claudeCode.lastCollect = readJson<HubCollectSummary>(join(home, "status.json"));
  status.claudeCode.sessions = listHubMirroredSessions(claudeMirror, SESSION_LIMIT);

  try {
    const config = loadManagedAgentsConfig(home);
    if (config) {
      status.managedAgents.configured = true;
      status.managedAgents.label = config.label;
      status.managedAgents.lookbackDays = config.lookbackDays;
    }
  } catch (error) {
    status.managedAgents.error = error instanceof Error ? error.message : String(error);
  }
  status.managedAgents.lastPull = readManagedAgentsStatus(home);
  status.webhooks.anthropic.lastWebhookAt = status.managedAgents.lastPull?.lastWebhookAt ?? null;
  status.managedAgents.sessions = listHubMirroredSessions(managedMirror, SESSION_LIMIT).map((session) => withMeta(managedMirror, session));
  const last = status.claudeCode.lastCollect;
  const pull = status.managedAgents.lastPull;
  const seen = readInboxObservation(home, status.claudeCode.inbox);
  const failure = live ? live.failure : last?.inboxFailure;
  const since = last?.inboxFailure === failure && last ? last.failureSince ?? last.at : live?.at ?? new Date().toISOString();
  const issues = status.issues;
  if (status.claudeCode.configured && failure === "unauthorized") issues.push({
    id: "inbox_read_token", severity: "error", title: "Inbox refused the read token", since,
    detail: "The inbox answered 401.", fix: "Set the same read token on the inbox and in the hub folder.",
  });
  if (status.claudeCode.configured && failure === "unreachable") issues.push({
    id: "inbox_unreachable", severity: "error", title: "Inbox unavailable", since,
    detail: "The runtime could not read the inbox.", fix: "Check the inbox URL, network and Worker. Run scout hub test.",
  });
  if (status.managedAgents.configured && pull?.keyRejectedSince) issues.push({
    id: "managed_agents_key", severity: "error", title: "Managed Agents key refused", since: pull.keyRejectedSince,
    detail: pull.error ?? "Anthropic refused access.", fix: "Reconnect Managed Agents with a key that can read this workspace.",
  });
  const now = Date.now();
  for (const file of last?.waitingFiles ?? []) {
    if (now - Date.parse(file.waitingSince) <= 3_600_000) continue;
    issues.push({ id: `gap:${file.label}/${file.file}`, severity: "warning", title: "File waiting for earlier bytes",
      detail: `${file.label}/${file.file}: have ${file.mirroredBytes} bytes, next chunk starts at ${file.waitingOffset}.`,
      since: file.waitingSince, fix: "Check the reporter on the source session for the missing bytes." });
  }
  const fixes: Record<string, string> = {
    bad_signature: "Check for a signing secret mismatch between the inbox and Anthropic.",
    missing_signature: "Check that the sender includes the webhook signature headers.",
    stale_timestamp: "Check the sender clock and delivery delay.",
    not_enabled: "Set the Anthropic webhook signing secret on the inbox.",
    too_large: "Check the webhook payload size in the sender delivery log.",
    bad_body: "Check the event type and session id in the sender delivery log.",
  };
  for (const [key, r] of Object.entries((live && !live.failure ? live.rejections : seen?.rejections) ?? {})) {
    if (!key.startsWith("webhooks/anthropic.") || !r.count || now - Date.parse(r.lastAt) >= 86_400_000) continue;
    const reason = key.slice("webhooks/anthropic.".length);
    issues.push({ id: key, severity: "warning", title: `Webhook refused: ${reason}`, since: r.lastAt,
      detail: `${r.count} refused in the last 24 hours at the last check.`, fix: fixes[reason] ?? "Check the sender delivery log." });
  }
  if (seen?.enabledSince && live?.enabled !== false && status.managedAgents.configured) {
    const missed = unannouncedSessions(home, seen.enabledSince, now).sort((a, b) => a.since.localeCompare(b.since));
    if (missed.length) issues.push({ id: "webhooks_look_broken", severity: "warning", title: "Webhooks look broken",
      since: missed[0]!.since, detail: `A full poll found changes without a matching webhook: ${missed.slice(0, 5).map(m => m.id).join(", ")}.`,
      fix: "Check the session event subscription, address and signing secret in Anthropic. Polling still mirrors changes." });
  }
  return status;
}

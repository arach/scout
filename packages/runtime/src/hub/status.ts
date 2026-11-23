/**
 * What Scout Hub is doing on this runtime, read from local files only: the
 * config, the last collect and pull, and the mirrors. No network calls, and no
 * tokens or keys in the result, so a UI can show it as is.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import type { HubCollectSummary } from "./collector.js";
import { loadManagedAgentsConfig, readManagedAgentsStatus, type ManagedAgentsPullSummary } from "./managed-agents.js";
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

export type HubStatus = {
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

export function readHubStatus(home = resolveHubHome()): HubStatus {
  const claudeMirror = resolveHubClaudeMirrorRoot();
  const managedMirror = resolveManagedAgentsMirrorRoot();
  const status: HubStatus = {
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
  return status;
}

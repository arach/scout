import type { RuntimeEnv } from "./portable-types.js";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { execFile, execFileSync } from "node:child_process";

import {
  isTailscaleBackendRunning,
  parseTailscaleStatusJson,
  summarizeTailscaleStatus,
  tailscaleSelfWebHosts,
  tailscaleStatusProbe,
  type TailscalePeerCandidate,
  type TailscaleSelfCandidate,
  type TailscaleStatusJson,
  type TailscaleStatusSummary,
} from "./system-probes/tailscale-status.js";

export type {
  TailscalePeerCandidate,
  TailscaleSelfCandidate,
  TailscaleStatusSummary,
} from "./system-probes/tailscale-status.js";
export {
  tailscaleSelfWebHosts,
  tailscaleStatusProbe,
} from "./system-probes/tailscale-status.js";

const DEFAULT_TAILSCALE_STATUS_TIMEOUT_MS = 1_500;
const TAILSCALE_STATUS_CACHE_MS = 30_000;
let statusCache: {
  key: string;
  at: number;
  value: TailscaleStatusJson | null;
} | null = null;

// One completed-value cache serves both APIs. Async commands coalesce by the
// same execution key, including custom-env callers (which never use the cache).
let commandSequence = 0;
let cacheSequence = 0;
const statusFlights = new Map<
  string,
  {
    sequence: number;
    result: Promise<TailscaleStatusJson | null>;
  }
>();

function commandKey(env: RuntimeEnv, binary: string): string {
  return [
    binary,
    env.OPENSCOUT_TAILSCALE_AUTO_HOSTS ?? "",
    env.OPENSCOUT_TAILSCALE_STATUS_TIMEOUT_MS ?? "",
  ].join("\0");
}

function cacheStatus(
  key: string,
  sequence: number,
  value: TailscaleStatusJson | null,
): void {
  // A newer synchronous read must not be overwritten by an older async child.
  if (sequence < cacheSequence) return;
  cacheSequence = sequence;
  statusCache = { key, at: Date.now(), value };
}

function readStatusJsonFromFileSync(filePath: string): TailscaleStatusJson {
  const raw = readFileSync(filePath, "utf8");
  return parseTailscaleStatusJson(raw);
}

function statusTimeoutMs(env: RuntimeEnv): number {
  const parsed = Number.parseInt(
    env.OPENSCOUT_TAILSCALE_STATUS_TIMEOUT_MS ?? "",
    10,
  );
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_TAILSCALE_STATUS_TIMEOUT_MS;
}

function readStatusJsonSync(
  env: RuntimeEnv = process.env,
): TailscaleStatusJson | null {
  if (env.OPENSCOUT_TAILSCALE_AUTO_HOSTS === "0") {
    return null;
  }

  const fixturePath = env.OPENSCOUT_TAILSCALE_STATUS_JSON;
  if (fixturePath) {
    try {
      return readStatusJsonFromFileSync(fixturePath);
    } catch {
      return null;
    }
  }

  const tailscaleBin =
    env.OPENSCOUT_TAILSCALE_BIN ??
    (env === process.env ? "tailscale" : undefined);
  if (!tailscaleBin) {
    return null;
  }

  const cacheKey = commandKey(env, tailscaleBin);
  const cached = statusCache;
  if (
    env === process.env &&
    cached?.key === cacheKey &&
    Date.now() - cached.at < TAILSCALE_STATUS_CACHE_MS
  ) {
    return cached.value;
  }

  const sequence = ++commandSequence;
  try {
    const stdout = execFileSync(tailscaleBin, ["status", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: statusTimeoutMs(env),
      windowsHide: true,
    });
    const value = parseTailscaleStatusJson(stdout);
    if (env === process.env) cacheStatus(cacheKey, sequence, value);
    return value;
  } catch {
    if (env === process.env) cacheStatus(cacheKey, sequence, null);
    return null;
  }
}

async function readStatusJsonAsync(
  env: RuntimeEnv,
): Promise<TailscaleStatusJson | null> {
  if (env.OPENSCOUT_TAILSCALE_AUTO_HOSTS === "0") return null;
  const fixturePath = env.OPENSCOUT_TAILSCALE_STATUS_JSON;
  if (fixturePath) {
    try {
      return parseTailscaleStatusJson(await readFile(fixturePath, "utf8"));
    } catch {
      return null;
    }
  }
  const tailscaleBin =
    env.OPENSCOUT_TAILSCALE_BIN ??
    (env === process.env ? "tailscale" : undefined);
  if (!tailscaleBin) return null;
  const key = commandKey(env, tailscaleBin);
  const cached = statusCache;
  if (
    env === process.env &&
    cached?.key === key &&
    Date.now() - cached.at < TAILSCALE_STATUS_CACHE_MS
  )
    return cached.value;

  let flight = statusFlights.get(key);
  if (!flight) {
    const sequence = ++commandSequence;
    const result = new Promise<TailscaleStatusJson | null>((resolve) => {
      try {
        const child = execFile(
          tailscaleBin,
          ["status", "--json"],
          {
            encoding: "utf8",
            timeout: statusTimeoutMs(env),
            windowsHide: true,
          },
          (error, stdout) => {
            if (error) {
              resolve(null);
              return;
            }
            try {
              resolve(parseTailscaleStatusJson(stdout));
            } catch {
              resolve(null);
            }
          },
        );
        // execFile captures both output pipes; never feed input to status.
        child.stdin?.end();
      } catch {
        resolve(null);
      }
    });
    flight = { sequence, result };
    statusFlights.set(key, flight);
    const owned = flight;
    void result.then(() => {
      if (statusFlights.get(key) === owned) statusFlights.delete(key);
    });
  }
  const value = await flight.result;
  if (env === process.env) cacheStatus(key, flight.sequence, value);
  return value;
}

/** Fresh-on-miss host lookup without holding the parent event loop. Same
 * argv/budget/keys/negative TTL as the retained synchronous startup API. */
export async function readTailscaleSelfWebHosts(
  env: RuntimeEnv = process.env,
): Promise<string[]> {
  const status = await readStatusJsonAsync(env);
  if (!status || !isTailscaleBackendRunning(status)) return [];
  return tailscaleSelfWebHosts(summarizeTailscaleStatus(status).self);
}

export async function readTailscalePeers(): Promise<TailscalePeerCandidate[]> {
  const summary = await readTailscaleStatusSummary();
  if (!summary) {
    return [];
  }
  return summary.peers;
}

export async function readTailscaleSelf(): Promise<TailscaleSelfCandidate | null> {
  const summary = await readTailscaleStatusSummary();
  if (!summary) {
    return null;
  }
  return summary.self;
}

export async function readTailscaleStatusSummary(): Promise<TailscaleStatusSummary | null> {
  const snapshot = await tailscaleStatusProbe.fresh();
  return snapshot.value;
}

export function readTailscaleSelfWebHostsSync(
  env: RuntimeEnv = process.env,
): string[] {
  const status = readStatusJsonSync(env);
  if (!status || !isTailscaleBackendRunning(status)) {
    return [];
  }
  return tailscaleSelfWebHosts(summarizeTailscaleStatus(status).self);
}

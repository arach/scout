import { closeSync, constants, existsSync, fstatSync, openSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { request as httpRequest, type ClientRequest, type RequestOptions } from "node:http";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { execProbeFile } from "./system-probes/exec.js";

export type LocalListenerKind = "tcp" | "unix";
export const TAILSCALE_GUARD_ERROR = "tailscale_runtime_listener_guarded";
export const TAILSCALE_GUARD_DETAIL = "A Tailscale Serve or Funnel handler forwards to this runtime listener. Removing the handler restores local access after the next successful status read.";
export const TAILSCALE_GUARD_POLL_MS = 5_000;
export const TAILSCALE_GUARD_MAX_AGE_MS = 10_000;
export const TAILSCALE_GUARD_TIMEOUT_MS = 1_500;
const MAX_BYTES = 2 * 1024 * 1024;

type OwnListeners = { port: number; socketPath: string };
type ParseResult = { outcome: "ok" | "unknown" | "unparseable"; matches: LocalListenerKind[] };
const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
function canonicalSocket(path: string, depth = 0): string | undefined {
  if (!isAbsolute(path) || depth > 8) return undefined;
  try { return realpathSync(path); } catch {
    // Bun on macOS can reject realpath/lstat of the socket itself. Resolve
    // explicit symlinks, then canonicalize its parent plus the socket basename.
    try { return canonicalSocket(resolve(dirname(path), readlinkSync(path)), depth + 1); }
    catch { try { return join(realpathSync(dirname(path)), basename(path)); } catch { return undefined; } }
  }
}

/** Parse only source-defined ServeConfig target fields. No DNS, substring port
 * matching, process arguments or AllowFunnel hostnames confer local authority. */
export function matchTailscaleRuntimeTargets(text: string, own: OwnListeners,
  canonicalize: (path: string) => string | undefined = canonicalSocket): ParseResult {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { outcome: "unparseable", matches: [] }; }
  if (value === null) return { outcome: "ok", matches: [] }; // empty *ServeConfig
  const matches = new Set<LocalListenerKind>();
  let nodes = 0;
  const target = (raw: string, tcp: boolean) => {
    if (raw.startsWith("unix:")) {
      const path = raw.slice(5);
      const canonical = canonicalize(path), owned = canonicalize(own.socketPath);
      if (canonical && owned && canonical === owned) matches.add("unix");
      return;
    }
    try {
      if (!tcp && /^\d+$/.test(raw)) raw = `http://127.0.0.1:${raw}`;
      const url = new URL(raw.includes("://") ? raw : `${tcp ? "tcp" : "http"}://${raw}`);
      if (!(tcp ? ["tcp:"] : ["http:", "https:", "https+insecure:"]).includes(url.protocol) || url.username || url.password) return;
      const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
      const loopback = host === "localhost" || host === "localhost." || host === "::1" ||
        /^127(?:\.\d{1,3}){3}$/.test(host) || /^::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(host);
      const port = url.port ? Number(url.port) : url.protocol === "http:" ? 80 : ["https:", "https+insecure:"].includes(url.protocol) ? 443 : NaN;
      if (loopback && port === own.port) matches.add("tcp");
    } catch { /* An unrecognized target has no enforcing evidence. */ }
  };
  // Additive or unrelated fields cannot veto evidence from recognized target
  // positions. Malformed target fields/branches are skipped, never coerced.
  let malformed = false;
  const map = (v: unknown): Record<string, unknown> | undefined => {
    if (object(v)) return v;
    malformed = true; return undefined;
  };
  const entries = (v: unknown): [string, unknown][] => v == null ? [] : Object.entries(map(v) ?? {});
  const visit = (config: unknown, depth: number, service = false) => {
    if (++nodes > 4096 || depth > 3) { malformed = true; return; }
    const c = map(config); if (!c) return;
    if (service && c.Tun === true) return; // L3 mode does not use HTTP/TCP forwarding.
    for (const [port, handler] of entries(c.TCP)) {
      if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) { malformed = true; continue; }
      const h = map(handler); if (!h || !("TCPForward" in h)) continue;
      if (typeof h.TCPForward === "string") target(h.TCPForward, true);
      else malformed = true;
    }
    for (const [, web] of entries(c.Web)) {
      const w = map(web); if (!w) continue;
      for (const [, handler] of entries(w.Handlers)) {
        const h = map(handler); if (!h || !("Proxy" in h)) continue;
        if (typeof h.Proxy === "string") target(h.Proxy, false);
        else malformed = true;
      }
    }
    for (const [, f] of entries(c.Foreground)) visit(f, depth + 1);
    for (const [, serviceConfig] of entries(c.Services)) visit(serviceConfig, depth + 1, true);
  };
  visit(value, 0);
  return { outcome: matches.size || !malformed ? "ok" : "unknown", matches: [...matches].sort() };
}

export type TailscaleStatusRead = {
  ok: boolean; stdout: string; source: "localapi" | "macos-localapi" | "cli"; unavailable?: boolean;
};
export type TailscaleStatusReaderOptions = {
  platform?: NodeJS.Platform;
  /** Dependency injection for isolated tests, not an operator environment switch. */
  discoveryDirectory?: string;
  unixSocketPaths?: readonly string[];
  env?: NodeJS.ProcessEnv;
  exec?: (file: string, args: readonly string[], signal: AbortSignal, env: NodeJS.ProcessEnv) => Promise<{ stdout: string }>;
};
function isUnavailable(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return typeof code === "string" && ["ENOENT", "ENOTDIR", "EACCES", "EPERM", "ECONNREFUSED", "ENOTFOUND"].includes(code);
}
/** One fixed GET, no redirects, no reusable credential-bearing HTTP agent.
 * Error bodies and transport exceptions never escape into reports. */
async function readLocalApi(options: RequestOptions, source: TailscaleStatusRead["source"]): Promise<TailscaleStatusRead> {
  return new Promise((resolve) => {
    let bytes = 0, settled = false; const chunks: Buffer[] = [];
    let request: ClientRequest | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (ok: boolean, stdout = "", unavailable = false) => {
      if (settled) return; settled = true; clearTimeout(timer);
      resolve({ ok, stdout: ok ? stdout : "", source, ...(unavailable ? { unavailable: true } : {}) });
    };
    try {
      request = httpRequest({ ...options, method: "GET", path: "/localapi/v0/serve-config", agent: false,
        headers: { host: "local-tailscaled.sock" } }, (res) => {
        res.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > MAX_BYTES) { finish(false); request?.destroy(); } else chunks.push(chunk); });
        res.on("error", () => finish(false)); res.on("aborted", () => finish(false));
        res.on("end", () => finish(res.statusCode === 200, Buffer.concat(chunks).toString("utf8"), res.statusCode === 401 || res.statusCode === 403));
      });
      timer = setTimeout(() => { finish(false); request?.destroy(); }, TAILSCALE_GUARD_TIMEOUT_MS);
      request.on("error", (error) => finish(false, "", isUnavailable(error))); request.end();
    } catch (error) { finish(false, "", isUnavailable(error)); }
  });
}
/** Mirrors safesocket/readMacsysSameUserProof. The port is the symlink TARGET,
 * not a file's contents. Root:admin 0640 proof files are supported. No token is
 * cached, logged, returned or written; it is read anew for this one request. */
async function readMacosLocalApi(directory: string): Promise<TailscaleStatusRead | undefined> {
  try {
    const portString = readlinkSync(join(directory, "ipnport"));
    if (!/^[1-9]\d{0,4}$/.test(portString) || Number(portString) > 65535) return undefined;
    const fd = openSync(join(directory, `sameuserproof-${portString}`), constants.O_RDONLY | constants.O_NOFOLLOW);
    let token: string;
    try {
      const info = fstatSync(fd);
      if (!info.isFile() || info.size > 4096) return undefined;
      token = readFileSync(fd, "utf8").trim();
    } finally { closeSync(fd); }
    if (!token) return undefined;
    return readLocalApi({ hostname: "127.0.0.1", port: Number(portString), auth: `:${token}` }, "macos-localapi");
  } catch { return undefined; }
}
/** Standalone macOS and Unix installations use processless LocalAPI reads.
 * CLI resolution honors the existing probe's override, then the app bundle. */
export async function readTailscaleServeConfig(options: TailscaleStatusReaderOptions = {}): Promise<TailscaleStatusRead> {
  const platform = options.platform ?? process.platform, env = options.env ?? process.env;
  if (platform === "darwin") {
    const read = await readMacosLocalApi(options.discoveryDirectory ?? "/Library/Tailscale");
    if (read) return read;
  }
  const socketPath = (options.unixSocketPaths ?? ["/var/run/tailscale/tailscaled.sock", "/var/run/tailscaled.socket"]).find(existsSync);
  if (socketPath) return readTailscaleServeConfigFromSocket(socketPath);
  const candidates = [...new Set([env.OPENSCOUT_TAILSCALE_BIN ?? "tailscale",
    ...(platform === "darwin" ? ["/Applications/Tailscale.app/Contents/MacOS/Tailscale"] : [])])];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TAILSCALE_GUARD_TIMEOUT_MS);
  const exec = options.exec ?? ((file, args, signal, env) => execProbeFile({ probeId: "tailscale-listener-guard", signal,
    timeoutMs: TAILSCALE_GUARD_TIMEOUT_MS, startedAt: Date.now() }, file, args, { env, maxStdoutBytes: MAX_BYTES, maxStderrBytes: 128 * 1024 }));
  try {
    for (const file of candidates) {
      try { const { stdout } = await exec(file, ["serve", "status", "--json"], controller.signal, env);
        return { ok: true, stdout, source: "cli" };
      } catch (error) {
        if (!isUnavailable(error)) return { ok: false, stdout: "", source: "cli" };
      }
    }
    return { ok: false, stdout: "", source: "cli", unavailable: true };
  } finally { clearTimeout(timer); }
}

/** Socket-only LocalAPI transport; explicit path is injectable for fixture tests. */
export async function readTailscaleServeConfigFromSocket(socketPath: string): Promise<TailscaleStatusRead> {
  return readLocalApi({ socketPath }, "localapi");
}

/** True only for the runtime's actual loopback TCP receiving address/port.
 * Unix identity is bound by the owning server, never guessed from empty fields. */
export function isRuntimeLoopbackTcpSocket(socket: { localPort?: number; localAddress?: string }, port: number): boolean {
  return socket.localPort === port && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(socket.localAddress ?? "");
}

export type TailscaleListenerGuardReport = {
  outcome: "not-read" | "ok" | "unknown" | "unparseable" | "failed" | "unavailable" | "stale";
  source: TailscaleStatusRead["source"] | null;
  attemptedAt: number | null; completedAt: number | null; ageMs: number | null;
  pollIntervalMs: number; maxAgeMs: number; guardedListeners: LocalListenerKind[];
};
export function createTailscaleListenerGuard(own: OwnListeners, options: {
  read?: () => Promise<TailscaleStatusRead>; now?: () => number; wallNow?: () => number;
  canonicalize?: (path: string) => string | undefined;
  onUpdate?: (report: TailscaleListenerGuardReport) => void;
} = {}) {
  const connections = new Map<{ destroy(): unknown; once(event: "close", callback: () => void): unknown }, LocalListenerKind>();
  const now = options.now ?? (() => performance.now()), wallNow = options.wallNow ?? Date.now;
  let completed = -Infinity, attemptedAt: number | null = null, completedAt: number | null = null;
  let result: ParseResult | { outcome: "failed" | "unavailable"; matches: LocalListenerKind[] } | undefined;
  let source: TailscaleStatusRead["source"] | null = null;
  let stopped = false, pending: Promise<void> | undefined, timer: ReturnType<typeof setInterval> | undefined;
  const report = (): TailscaleListenerGuardReport => {
    const age = result ? now() - completed : null;
    const fresh = age !== null && age >= 0 && age < TAILSCALE_GUARD_MAX_AGE_MS;
    return { outcome: result ? fresh ? result.outcome : "stale" : "not-read", source, attemptedAt, completedAt,
      ageMs: age === null ? null : Math.max(0, age), pollIntervalMs: TAILSCALE_GUARD_POLL_MS, maxAgeMs: TAILSCALE_GUARD_MAX_AGE_MS,
      guardedListeners: fresh && result?.outcome === "ok" ? [...result.matches] : [] };
  };
  const refresh = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (pending) return pending;
    attemptedAt = wallNow();
    const started = now();
    pending = (async () => {
      let read: TailscaleStatusRead;
      try { read = await (options.read ?? (() => readTailscaleServeConfig()))(); }
      catch (error) { read = { ok: false, stdout: "", source: "cli", unavailable: isUnavailable(error) }; }
      if (stopped) return;
      const wasGuarded = new Set(report().guardedListeners);
      source = read.source;
      result = read.ok ? matchTailscaleRuntimeTargets(read.stdout, own, options.canonicalize) : { outcome: read.unavailable ? "unavailable" : "failed", matches: [] };
      completed = started; completedAt = wallNow();
      for (const [socket, listener] of connections) if (report().guardedListeners.includes(listener) && !wasGuarded.has(listener)) {
        connections.delete(socket); try { socket.destroy(); } catch { /* Retirement is best effort per socket. */ }
      }
      try { options.onUpdate?.(report()); } catch { /* Observer cannot affect guard state. */ }
    })().finally(() => { pending = undefined; });
    return pending;
  };
  return { report, refresh,
    trackConnection(listener: LocalListenerKind, socket: { destroy(): unknown; once(event: "close", callback: () => void): unknown }) {
      if (stopped) return;
      connections.set(socket, listener); socket.once("close", () => connections.delete(socket));
    },
    isGuarded: (listener: LocalListenerKind) => report().guardedListeners.includes(listener),
    start() { if (!timer && !stopped) { void refresh(); timer = setInterval(() => { void refresh(); }, TAILSCALE_GUARD_POLL_MS); timer.unref(); } },
    stop() { stopped = true; if (timer) clearInterval(timer); result = undefined; connections.clear(); },
  };
}

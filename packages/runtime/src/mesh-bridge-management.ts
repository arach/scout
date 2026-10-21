import type { MeshBridgeLifecycleEvent } from "@openscout/protocol";
import { randomUUID } from "node:crypto";
import { constants, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { meshBridgeConfigPath, meshBridgeStatePath } from "./mesh-bridge-supervisor.js";

import { mcpEventPrincipalSchema } from "./broker-mcp-events.js";

export const bridgeDiagnosticIdentitySchema = mcpEventPrincipalSchema;
const bridgeConfigSchema = z.object({
  enabled: z.boolean(),
  relayUrl: z.string().max(512).refine(value => {
    try { const url = new URL(value); return url.protocol === "https:" && url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash; }
    catch { return false; }
  }),
  tokenKeychainService: z.string().regex(/^[a-zA-Z][a-zA-Z0-9._-]{0,127}$/).optional(),
  sender: z.string().regex(/^[a-zA-Z0-9@._:-]{1,128}$/).optional(),
  node: z.string().regex(/^[a-zA-Z0-9._:-]{1,128}$/).optional(),
  tools: z.union([z.literal("core"), z.array(z.string().regex(/^[a-zA-Z0-9_.-]{1,128}$/)).max(128)]).default("core"),
  remoteDiagnostics: z.array(bridgeDiagnosticIdentitySchema).max(128).default([]),
  // An absent token retains the stored token; null removes it. Never returned.
  token: z.string().min(1).max(8192).regex(/^[\x21-\x7e]+$/).nullable().optional(),
}).strict();
export type MeshBridgeMutation = MeshBridgeLifecycleEvent["payload"]["action"];
export type MeshBridgeLifecyclePhase = MeshBridgeLifecycleEvent["payload"]["phase"];
export class MeshBridgeManagementError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

function readOwnedJson(path: string, maxBytes: number): Record<string, unknown> | null {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes || (typeof process.getuid === "function" && stat.uid !== process.getuid())) return null;
    const body: unknown = JSON.parse(readFileSync(fd, "utf8"));
    return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch { return null; }
  finally { if (fd !== undefined) closeSync(fd); }
}

/** The only process owner is scout-base. Config mtime is its existing reconciliation signal. */
export class MeshBridgeManagement {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly deps: {
    supportDirectory: string; lifecycle: (action: MeshBridgeMutation, phase: MeshBridgeLifecyclePhase) => Promise<void>; now?: () => number;
  }) {}
  private get path() { return meshBridgeConfigPath(this.deps.supportDirectory); }
  read() {
    const raw = readOwnedJson(this.path, 64 * 1024);
    // Explicit projection even for legacy/malformed configuration. No generic object spread.
    const parsed = raw ? bridgeConfigSchema.safeParse({
      enabled: raw.enabled !== false, relayUrl: raw.relayUrl, tokenKeychainService: raw.tokenKeychainService,
      sender: raw.sender, node: raw.node, tools: raw.tools, remoteDiagnostics: raw.remoteDiagnostics, token: raw.token,
    }) : null;
    const config = parsed?.success && !raw?.dir
      && (!raw?.tokenFile || raw.tokenFile === join(this.deps.supportDirectory, "mcp-bridge.token")) ? parsed.data : null;
    const tokenPath = join(this.deps.supportDirectory, "mcp-bridge.token");
    let tokenFileValid = false;
    try {
      const stat = statSync(tokenPath, { throwIfNoEntry: false });
      // Symlinks never count as valid credential references.
      const fd = openSync(tokenPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try { const actual = fstatSync(fd); tokenFileValid = !!stat && actual.isFile() && actual.size > 0 && actual.size <= 8192
        && (actual.mode & 0o777) === 0o600 && (typeof process.getuid !== "function" || actual.uid === process.getuid()); }
      finally { closeSync(fd); }
    } catch { /* missing or invalid token file */ }
    const observed = readOwnedJson(meshBridgeStatePath(this.deps.supportDirectory), 16 * 1024);
    const updatedAt = typeof observed?.updatedAt === "number" && Number.isFinite(observed.updatedAt) ? observed.updatedAt : null;
    const now = (this.deps.now ?? Date.now)();
    return {
      config: config ? { enabled: config.enabled, relayUrl: config.relayUrl,
        sender: config.sender ?? null, node: config.node ?? null, tools: config.tools,
        remoteDiagnostics: config.remoteDiagnostics } : null,
      configValidity: !existsSync(this.path) ? "missing" : config ? "valid" : "invalid",
      credentials: {
        keychainService: config?.tokenKeychainService ?? null,
        tokenFileExists: existsSync(tokenPath), tokenFileValid,
        storedTokenConfigured: typeof raw?.token === "string" && raw.token.length > 0,
        // Validity here describes storage/configuration, not relay authentication.
        validity: !config ? "invalid" : typeof raw?.token === "string" && raw.token.length > 0 ? "configured"
          : config.tokenKeychainService ? "unverified" : tokenFileValid ? "configured" : "missing",
      },
      observed: {
        state: ["running", "idle", "restarting", "unconfigured", "refused"].includes(String(observed?.state)) ? observed!.state : "unavailable",
        pid: typeof observed?.pid === "number" && Number.isInteger(observed.pid) && observed.pid > 1 ? observed.pid : null,
        extensionState: ["ready","absent","refused"].includes(String(observed?.extensionState)) ? observed!.extensionState : "unavailable",
        artifactDigest: typeof observed?.artifactDigest === "string" && /^[a-f0-9]{64}$/.test(observed.artifactDigest) ? observed.artifactDigest : null,
        extensionVersion: typeof observed?.extensionVersion === "string" && /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-zA-Z0-9.-]+)?$/.test(observed.extensionVersion) ? observed.extensionVersion : null,
        updatedAt, ageMs: updatedAt === null ? null : Math.max(0, now - updatedAt),
        stale: updatedAt === null || updatedAt > now || now - updatedAt > 10_000,
      },
    };
  }
  private write(config: Record<string, unknown>) {
    mkdirSync(this.deps.supportDirectory, { recursive: true, mode: 0o700 });
    let previous = 0;
    try { previous = statSync(this.path).mtimeMs; } catch { /* first configuration */ }
    const tmp = `${this.path}.${randomUUID()}.tmp`;
    try {
      const serialized = `${JSON.stringify(config, null, 2)}\n`;
      if (Buffer.byteLength(serialized) > 64 * 1024) throw new MeshBridgeManagementError(413, "bridge_config_too_large");
      writeFileSync(tmp, serialized, { mode: 0o600, flag: "wx" });
      // Ensure even two writes in one filesystem clock tick request reconciliation.
      const time = Math.max(Date.now(), previous + 1) / 1000;
      utimesSync(tmp, time, time);
      renameSync(tmp, this.path);
    } finally { try { unlinkSync(tmp); } catch { /* already renamed or never created */ } }
  }
  private run(action: MeshBridgeMutation, operation: () => void) {
    const result = this.queue.then(async () => {
      try {
        // Persist intent before changing desired state. Never include config or errors.
        await this.deps.lifecycle(action, "requested");
        operation();
        return { ok: true, action, reconciliation: "requested" as const };
      } catch (error) {
        // Preserve the original refusal even if the lifecycle journal is unavailable.
        try { await this.deps.lifecycle(action, "failed"); } catch { /* mutation stays refused */ }
        throw error;
      }
    });
    this.queue = result.catch(() => {});
    return result;
  }
  configure(body: unknown) {
    return this.run("configure", () => {
      const parsed = bridgeConfigSchema.safeParse(body);
      if (!parsed.success) throw new MeshBridgeManagementError(400, "invalid_bridge_config");
      const previous = readOwnedJson(this.path, 64 * 1024);
      const { token, ...config } = parsed.data;
      const retained = token === undefined && typeof previous?.token === "string" ? previous.token : token;
      if (retained && (retained.length > 8192 || !/^[\x21-\x7e]+$/.test(retained))) {
        throw new MeshBridgeManagementError(400, "invalid_bridge_credential");
      }
      this.write({ ...config, ...(retained ? { token: retained } : {}) });
    });
  }
  control(action: unknown) {
    if (action !== "enable" && action !== "disable" && action !== "request-restart") {
      throw new MeshBridgeManagementError(400, "invalid_bridge_action");
    }
    return this.run(action, () => {
      const raw = readOwnedJson(this.path, 64 * 1024);
      if (!raw || this.read().configValidity !== "valid") throw new MeshBridgeManagementError(409, "bridge_not_configured");
      if (action === "request-restart" && raw.enabled === false) throw new MeshBridgeManagementError(409, "bridge_disabled");
      // Keep the existing config (including credentials) private. Never invoke a spawner.
      this.write({ ...raw, ...(action !== "request-restart" ? { enabled: action === "enable" } : {}) });
    });
  }
}

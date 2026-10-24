import { execFile } from "node:child_process";
import { closeSync, constants, fstatSync, openSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { meshBridgeConfigPath } from "./mesh-bridge-supervisor.js";

/**
 * The host's approval: the credential its mesh bridge holds. `scout mesh
 * bridge connect` stores an `osbr_` credential once the account approves the
 * host in the browser, and revoking the host under the console's Access tab
 * ends it. The runtime publishes the host's presence with it, so publishing
 * needs no account session on disk.
 *
 * Read the same credential configuration as `scout mesh bridge`:
 * the config's own token, then the macOS keychain item the config names, or a
 * mode-0600 token file off darwin.
 */
export interface MeshBridgeCredentialOptions {
  supportDirectory: string;
  platform?: NodeJS.Platform;
  readKeychain?: (service: string) => Promise<string | null>;
  now?: () => number;
}

/** After a read finds nothing, an unchanged config is read again this often. */
const MISSING_CREDENTIAL_RETRY_MS = 5 * 60_000;

export async function readMeshBridgeCredential(options: MeshBridgeCredentialOptions): Promise<string | null> {
  let config: unknown;
  try {
    config = JSON.parse(readFileSync(meshBridgeConfigPath(options.supportDirectory), "utf8"));
  } catch {
    return null;
  }
  if (!config || typeof config !== "object") return null;
  const { token, tokenKeychainService, tokenFile } = config as Record<string, unknown>;
  if (typeof token === "string" && token.trim()) return token.trim();
  if ((options.platform ?? process.platform) === "darwin") {
    const service = typeof tokenKeychainService === "string" ? tokenKeychainService.trim() : "";
    return service ? (options.readKeychain ?? readKeychainSecret)(service) : null;
  }
  const path = typeof tokenFile === "string" && tokenFile.trim()
    ? tokenFile.trim()
    : join(options.supportDirectory, "mcp-bridge.token");
  return readMode0600File(path);
}

/**
 * Reads the credential again when the bridge config changes (connect,
 * disconnect), and retries a config that gave nothing every few minutes, so a
 * host approved after startup publishes without a restart.
 */
export function meshBridgeCredentialSource(options: MeshBridgeCredentialOptions): () => Promise<string | null> {
  const now = options.now ?? Date.now;
  let readMtimeMs: number | null | undefined;
  let readAt = 0;
  let credential: string | null = null;
  return async () => {
    const mtimeMs = configMtimeMs(options.supportDirectory);
    if (mtimeMs !== readMtimeMs || (!credential && now() - readAt >= MISSING_CREDENTIAL_RETRY_MS)) {
      readMtimeMs = mtimeMs;
      readAt = now();
      credential = mtimeMs === null ? null : await readMeshBridgeCredential(options);
    }
    return credential;
  };
}

function configMtimeMs(supportDirectory: string): number | null {
  try {
    return statSync(meshBridgeConfigPath(supportDirectory)).mtimeMs;
  } catch {
    return null;
  }
}

function readKeychainSecret(service: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("security", ["find-generic-password", "-s", service, "-w"], { timeout: 5_000, killSignal: "SIGKILL" }, (error, stdout) => {
      const value = error ? "" : String(stdout).trim();
      resolve(value || null);
    });
  });
}

/** Only a regular mode-0600 file this user owns, opened without following a symlink. */
function readMode0600File(path: string): string | null {
  const noFollow = constants.O_NOFOLLOW;
  if (typeof noFollow !== "number" || noFollow === 0) return null;
  let fd: number | null = null;
  try {
    fd = openSync(path, constants.O_RDONLY | noFollow);
    const stats = fstatSync(fd);
    if (!stats.isFile() || (stats.mode & 0o777) !== 0o600) return null;
    if (typeof process.getuid === "function" && stats.uid !== process.getuid()) return null;
    const value = readFileSync(fd, "utf8").trim();
    return value || null;
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // Already released.
      }
    }
  }
}

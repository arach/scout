import { execFile } from "node:child_process";
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";

import { isMeshBridgeToken, readMeshBridgeConfigSnapshot, validateMeshBridgeConfig } from "./mesh-bridge-config.js";
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

/** A credential stays paired with the issuer from the same validated snapshot. */
export interface MeshBridgeCredential {
  token: string;
  relayOrigin: string;
}

type ValidatedSnapshot = ReturnType<typeof validatedSnapshot>;
function validatedSnapshot(options: MeshBridgeCredentialOptions) {
  try {
    const snapshot = readMeshBridgeConfigSnapshot(meshBridgeConfigPath(options.supportDirectory));
    return { ...snapshot, config: validateMeshBridgeConfig(snapshot.value, options.supportDirectory) };
  } catch { return null; }
}

async function readSnapshotCredential(options: MeshBridgeCredentialOptions, snapshot: NonNullable<ValidatedSnapshot>): Promise<string | null> {
  const { token, tokenKeychainService, tokenFile } = snapshot.config;
  if (token) return token;
  if ((options.platform ?? process.platform) === "darwin") {
    const secret = tokenKeychainService ? await (options.readKeychain ?? readKeychainSecret)(tokenKeychainService) : null;
    return isMeshBridgeToken(secret) ? secret : null;
  }
  return readMode0600File(tokenFile);
}

export async function readMeshBridgeCredential(options: MeshBridgeCredentialOptions): Promise<string | null> {
  return (await meshBridgeCredentialSource(options)())?.token ?? null;
}

/** Revalidate the configuration and issuer every call; cache only secret lookup. */
export function meshBridgeCredentialSource(options: MeshBridgeCredentialOptions): () => Promise<MeshBridgeCredential | null> {
  const now = options.now ?? Date.now;
  let readIdentity: string | undefined;
  let readAt = 0;
  let token: string | null = null;
  return async () => {
    const snapshot = validatedSnapshot(options);
    if (!snapshot) { readIdentity = undefined; token = null; return null; }
    const identity = `${snapshot.digest}:${snapshot.mtimeMs}`;
    if (identity !== readIdentity || (!token && now() - readAt >= MISSING_CREDENTIAL_RETRY_MS)) {
      token = await readSnapshotCredential(options, snapshot);
      // A keychain lookup may yield while connect/disconnect rewrites the config.
      const current = validatedSnapshot(options);
      if (!current || current.digest !== snapshot.digest || current.mtimeMs !== snapshot.mtimeMs) {
        readIdentity = undefined; token = null; return null;
      }
      readIdentity = identity;
      readAt = now();
    }
    return token ? { token, relayOrigin: snapshot.config.relayOrigin } : null;
  };
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
    fd = openSync(path, constants.O_RDONLY | noFollow | constants.O_NONBLOCK);
    const stats = fstatSync(fd);
    if (!stats.isFile() || stats.size > 8194 || (stats.mode & 0o777) !== 0o600) return null;
    if (typeof process.getuid === "function" && stats.uid !== process.getuid()) return null;
    const value = readFileSync(fd, "utf8").trim();
    return isMeshBridgeToken(value) ? value : null;
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

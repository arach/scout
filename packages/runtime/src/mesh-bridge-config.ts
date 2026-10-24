import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The one credential/configuration policy used by bridge launch and presence. */
export function validateMeshBridgeConfig(raw: Record<string, unknown>, supportDirectory: string) {
  const relay = new URL(String(raw.relayUrl));
  if (!isMeshBridgeCredentialUrl(relay) || relay.pathname !== "/" || relay.search || relay.hash || raw.dir) {
    throw new Error("invalid bridge launch configuration");
  }
  const tokenFile = join(supportDirectory, "mcp-bridge.token");
  if (raw.tokenFile !== undefined && raw.tokenFile !== tokenFile) throw new Error("invalid bridge token location");
  if (raw.token !== undefined && !isMeshBridgeToken(raw.token)) throw new Error("invalid bridge credential");
  if (raw.tokenKeychainService !== undefined && (
    typeof raw.tokenKeychainService !== "string" || /^[a-zA-Z][a-zA-Z0-9._-]{0,127}$/.exec(raw.tokenKeychainService)?.[0] !== raw.tokenKeychainService
  )) throw new Error("invalid bridge credential reference");
  return {
    relayOrigin: relay.origin,
    token: typeof raw.token === "string" ? raw.token : undefined,
    tokenKeychainService: typeof raw.tokenKeychainService === "string" ? raw.tokenKeychainService : undefined,
    tokenFile,
  };
}

export function isMeshBridgeToken(value: unknown): value is string {
  return typeof value === "string" && /^[\x21-\x7e]{1,8192}$/.exec(value)?.[0] === value;
}

/** Plain HTTP is only for local loopback fixtures, never a remote issuer. */
export function isMeshBridgeCredentialUrl(url: URL): boolean {
  return !url.username && !url.password && (url.protocol === "https:" || (
    url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  ));
}

/** Bounded, owner-controlled snapshot; content identity detects same-mtime edits. */
export function readMeshBridgeConfigSnapshot(path: string): { value: Record<string, unknown>; digest: string; mtimeMs: number } {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 64 * 1024 || (stat.mode & 0o022) || (process.getuid && stat.uid !== process.getuid())) throw new Error();
    const text = readFileSync(fd, "utf8");
    if (Buffer.byteLength(text) > 64 * 1024) throw new Error();
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return { value: value as Record<string, unknown>, digest: createHash("sha256").update(text).digest("hex"), mtimeMs: stat.mtimeMs };
  } catch { throw new Error("invalid bridge configuration"); }
  finally { if (fd !== undefined) closeSync(fd); }
}

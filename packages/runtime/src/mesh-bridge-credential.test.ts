import { DEFAULT_OPENSCOUT_MESH_RELAY_URL } from "@openscout/protocol";
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { meshBridgeCredentialSource, readMeshBridgeCredential } from "./mesh-bridge-credential.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function supportDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "openscout-bridge-credential-test-"));
  directories.push(directory);
  return directory;
}

function writeConfig(directory: string, fields: Record<string, unknown>, mtimeMs?: number): void {
  const path = join(directory, "mcp-bridge.json");
  writeFileSync(path, JSON.stringify({ relayUrl: DEFAULT_OPENSCOUT_MESH_RELAY_URL, ...fields }));
  if (mtimeMs !== undefined) utimesSync(path, new Date(mtimeMs), new Date(mtimeMs));
}

describe("the host's bridge credential", () => {
  test("is the token the bridge config carries", async () => {
    const directory = supportDirectory();
    writeConfig(directory, { token: "osbr_inline" });
    expect(await readMeshBridgeCredential({ supportDirectory: directory, platform: "darwin" })).toBe("osbr_inline");
  });

  test("on a Mac, is the keychain item the config names", async () => {
    const directory = supportDirectory();
    writeConfig(directory, { tokenKeychainService: "OPENSCOUT_MCP_BRIDGE_CREDENTIAL" });
    const asked: string[] = [];
    const credential = await readMeshBridgeCredential({
      supportDirectory: directory,
      platform: "darwin",
      readKeychain: async (service) => {
        asked.push(service);
        return "osbr_keychain";
      },
    });
    expect(credential).toBe("osbr_keychain");
    expect(asked).toEqual(["OPENSCOUT_MCP_BRIDGE_CREDENTIAL"]);
  });

  test("elsewhere, is a token file only this user can read", async () => {
    const directory = supportDirectory();
    writeConfig(directory, {});
    const tokenFile = join(directory, "mcp-bridge.token");
    writeFileSync(tokenFile, "osbr_file\n");
    chmodSync(tokenFile, 0o644);
    expect(await readMeshBridgeCredential({ supportDirectory: directory, platform: "linux" })).toBeNull();
    chmodSync(tokenFile, 0o600);
    expect(await readMeshBridgeCredential({ supportDirectory: directory, platform: "linux" })).toBe("osbr_file");
  });

  test("refuses an arbitrary private-key-shaped 0600 file before reading a credential", async () => {
    const directory = supportDirectory();
    const privateKey = join(directory, "unrelated-private-key");
    writeFileSync(privateKey, "-----BEGIN PRIVATE KEY-----\nsynthetic-fixture-only\n-----END PRIVATE KEY-----\n", { mode: 0o600 });
    expect(statSync(privateKey).mode & 0o777).toBe(0o600);
    if (process.getuid) expect(statSync(privateKey).uid).toBe(process.getuid());
    writeConfig(directory, { tokenFile: privateKey });
    expect(await readMeshBridgeCredential({ supportDirectory: directory, platform: "linux" })).toBeNull();
  });

  test("validates every configured field, even one hidden by inline token precedence", async () => {
    const directory = supportDirectory();
    let lookups = 0;
    for (const fields of [
      { token: " leading-space" }, { token: "trailing\n" }, { token: "" }, { token: "a".repeat(8193) }, { token: "line\nbreak" },
      { token: 7 }, { tokenKeychainService: "bad service" }, { tokenKeychainService: "Valid\n" }, { tokenKeychainService: "-bad" },
      { tokenKeychainService: "a".repeat(129) }, { tokenKeychainService: null },
      { tokenFile: "/unrelated/credential" }, { tokenFile: "" }, { tokenFile: null },
      { relayUrl: "http://issuer.example.test" }, { relayUrl: "https://issuer.example.test/path" },
      { relayUrl: "https://user:password@issuer.example.test" }, { dir: "/caller/dir" },
    ]) {
      writeConfig(directory, { token: "osbr_inline", ...fields });
      expect(await readMeshBridgeCredential({ supportDirectory: directory, platform: "darwin",
        readKeychain: async () => { lookups++; return "osbr_lookup"; } })).toBeNull();
    }
    expect(lookups).toBe(0);
  });

  test("rejects non-token contents from the fixed file or keychain", async () => {
    const directory = supportDirectory();
    writeConfig(directory, { tokenKeychainService: "Valid.Service-1" });
    expect(await readMeshBridgeCredential({ supportDirectory: directory, platform: "darwin",
      readKeychain: async () => "two words" })).toBeNull();
    writeConfig(directory, {});
    writeFileSync(join(directory, "mcp-bridge.token"), "two words", { mode: 0o600 });
    expect(await readMeshBridgeCredential({ supportDirectory: directory, platform: "linux" })).toBeNull();
  });

  test("refreshes issuer and validation on same-mtime edits, not just once at startup", async () => {
    const directory = supportDirectory();
    const source = meshBridgeCredentialSource({ supportDirectory: directory });
    writeConfig(directory, { token: "osbr_inline" }, 1000);
    expect(await source()).toEqual({ token: "osbr_inline", relayOrigin: DEFAULT_OPENSCOUT_MESH_RELAY_URL });
    writeConfig(directory, { token: "osbr_inline", relayUrl: "https://other.example.test" }, 1000);
    expect(await source()).toEqual({ token: "osbr_inline", relayOrigin: "https://other.example.test" });
    writeConfig(directory, { token: "osbr_inline", tokenFile: "/unrelated/credential" }, 1000);
    expect(await source()).toBeNull();
  });

  test("does not pair a yielded keychain result with a changed configuration", async () => {
    const directory = supportDirectory();
    writeConfig(directory, { tokenKeychainService: "Valid.Service" }, 1000);
    const source = meshBridgeCredentialSource({ supportDirectory: directory, platform: "darwin",
      readKeychain: async () => {
        writeConfig(directory, { token: "osbr_new", relayUrl: "https://other.example.test" }, 1000);
        return "osbr_old";
      } });
    expect(await source()).toBeNull();
    expect(await source()).toEqual({ token: "osbr_new", relayOrigin: "https://other.example.test" });
  });

  test("is nothing on a host that was never approved", async () => {
    const directory = supportDirectory();
    expect(await readMeshBridgeCredential({ supportDirectory: directory, platform: "darwin" })).toBeNull();
    writeConfig(directory, {});
    expect(await readMeshBridgeCredential({ supportDirectory: directory, platform: "darwin" })).toBeNull();
  });

  test("is read again when the config changes, and a missing one only every few minutes", async () => {
    const directory = supportDirectory();
    let clock = 1_000_000;
    let reads = 0;
    let keychain: string | null = null;
    const credential = meshBridgeCredentialSource({
      supportDirectory: directory,
      platform: "darwin",
      now: () => clock,
      readKeychain: async () => {
        reads += 1;
        return keychain;
      },
    });

    writeConfig(directory, { tokenKeychainService: "OPENSCOUT_MCP_BRIDGE_CREDENTIAL" }, 1_000);
    expect(await credential()).toBeNull();
    keychain = "osbr_later";
    clock += 60_000;
    expect(await credential()).toBeNull();
    expect(reads).toBe(1);

    clock += 5 * 60_000;
    expect(await credential()).toEqual({ token: "osbr_later", relayOrigin: DEFAULT_OPENSCOUT_MESH_RELAY_URL });
    expect(await credential()).toEqual({ token: "osbr_later", relayOrigin: DEFAULT_OPENSCOUT_MESH_RELAY_URL });
    expect(reads).toBe(2);

    keychain = "osbr_reapproved";
    writeConfig(directory, { tokenKeychainService: "OPENSCOUT_MCP_BRIDGE_CREDENTIAL" }, 2_000);
    expect(await credential()).toEqual({ token: "osbr_reapproved", relayOrigin: DEFAULT_OPENSCOUT_MESH_RELAY_URL });
    expect(reads).toBe(3);
  });
});


test("a SIGTERM-ignoring keychain child exits before the credential promise settles", async () => {
  const directory = supportDirectory();
  const bin = join(directory, "bin"); mkdirSync(bin);
  const pidFile = join(directory, "child.pid");
  writeFileSync(join(bin, "security"), `#!${process.execPath}
import { writeFileSync } from "node:fs";
process.on("SIGTERM", () => {});
writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
setInterval(() => {}, 100);
`, { mode: 0o700 });
  writeConfig(directory, { tokenKeychainService: "fixture-no-native-keychain" });
  const originalPath = process.env.PATH;
  process.env.PATH = bin;
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  let lookup: Promise<string | null> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    lookup = readMeshBridgeCredential({ supportDirectory: directory, platform: "darwin" });
    const exceeded = new Promise<never>((_, reject) => {
      deadline = setTimeout(() => reject(Error("keychain lookup outlived its five-second kill deadline")), 8_000);
    });
    expect(await Promise.race([lookup, exceeded])).toBeNull();
    const pid = Number(readFileSync(pidFile, "utf8"));
    expect(pid).toBeGreaterThan(0);
    expect(alive(pid)).toBe(false);
  } finally {
    if (deadline) clearTimeout(deadline);
    if (originalPath === undefined) delete process.env.PATH; else process.env.PATH = originalPath;
    if (existsSync(pidFile)) {
      const pid = Number(readFileSync(pidFile, "utf8"));
      if (alive(pid)) process.kill(pid, "SIGKILL");
    }
    // The deliberately broken variant must not abandon its still-running child.
    if (lookup) await lookup;
    rmSync(directory, { recursive: true, force: true });
  }
}, 10_000);

import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
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
  writeFileSync(path, JSON.stringify({ relayUrl: "https://mcp.oscout.net", ...fields }));
  if (mtimeMs !== undefined) utimesSync(path, new Date(mtimeMs), new Date(mtimeMs));
}

describe("the host's bridge credential", () => {
  test("is the token the bridge config carries", async () => {
    const directory = supportDirectory();
    writeConfig(directory, { token: " osbr_inline " });
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
    expect(await credential()).toBe("osbr_later");
    expect(await credential()).toBe("osbr_later");
    expect(reads).toBe(2);

    keychain = "osbr_reapproved";
    writeConfig(directory, { tokenKeychainService: "OPENSCOUT_MCP_BRIDGE_CREDENTIAL" }, 2_000);
    expect(await credential()).toBe("osbr_reapproved");
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

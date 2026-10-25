import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ensureScoutLocalEdgeTrust } from "./local-edge-trust.ts";

const testDirectories = new Set<string>();
afterEach(() => {
  for (const directory of testDirectories) rmSync(directory, { recursive: true, force: true });
  testDirectories.clear();
});
function createCaddyRoot(directory: string): string {
  const path = join(directory, "Library", "Application Support", "Caddy", "pki", "authorities", "local", "root.crt");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "test root\n", "utf8");
  return path;
}

describe("local edge trust", () => {
  test("trusts the Caddy root through macOS authorization when the root exists", () => {
    const directory = mkdtempSync(join(tmpdir(), "openscout-caddy-trust-"));
    testDirectories.add(directory);
    const rootPath = createCaddyRoot(directory);
    let trusted = false;
    const calls: string[] = [];

    const report = ensureScoutLocalEdgeTrust({
      env: { PATH: directory, HOME: directory },
      platform: "darwin",
      runCommand: (command, args) => {
        calls.push([command, ...args].join(" "));
        if (command === "security" && args[0] === "verify-cert") {
          return trusted
            ? { status: 0, stdout: "", stderr: "" }
            : { status: 1, stdout: "", stderr: "not trusted" };
        }
        if (command === "osascript") {
          expect(args.join(" ")).toContain(rootPath);
          trusted = true;
          return { status: 0, stdout: "", stderr: "" };
        }
        return { status: 1, stdout: "", stderr: "unexpected command" };
      },
    });

    expect(report.status).toBe("installed");
    expect(report.rootCertificatePath).toBe(rootPath);
    expect(calls.some((call) => call.startsWith("osascript "))).toBe(true);
  });

  test("judges Linux trust from Caddy's CA root under the XDG data directory", () => {
    const directory = mkdtempSync(join(tmpdir(), "openscout-caddy-linux-root-"));
    testDirectories.add(directory);
    const rootPath = join(directory, ".local", "share", "caddy", "pki", "authorities", "local", "root.crt");
    mkdirSync(dirname(rootPath), { recursive: true });
    writeFileSync(rootPath, "test root\n", "utf8");

    const inspect = (status: number | null) => ensureScoutLocalEdgeTrust({
      env: { PATH: directory, HOME: directory },
      platform: "linux",
      runCommand: (command, args) => {
        expect([command, ...args]).toEqual(["openssl", "verify", rootPath]);
        return { status, stdout: "", stderr: "" };
      },
    });

    expect(inspect(0)).toMatchObject({ status: "trusted", rootCertificatePath: rootPath });
    expect(inspect(2)).toMatchObject({ status: "untrusted", trustCommand: "caddy trust" });
    // openssl missing: trust cannot be judged either way.
    expect(inspect(null).status).toBe("skipped");
  });
});

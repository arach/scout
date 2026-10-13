import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The bootstrap half of `bun run dev` (scripts/dev.mjs), without its servers.
import { resolveDevInstanceSetup } from "../scripts/dev-instance.mjs";

function fakeCheckout(): { root: string; web: string } {
  const root = join(mkdtempSync(join(tmpdir(), "openscout-dev-instance-")), "openscout");
  mkdirSync(join(root, "packages", "runtime", "src"), { recursive: true });
  writeFileSync(join(root, "packages", "runtime", "src", "instance.ts"), "");
  mkdirSync(join(root, "packages", "web"), { recursive: true });
  mkdirSync(join(root, ".git"));
  return { root, web: join(root, "packages", "web") };
}

describe("bun run dev picks its instance", () => {
  test("(c) from a prod agent shell it becomes dev with dev ports, even with a prod broker URL and port in env", () => {
    const checkout = fakeCheckout();
    try {
      // What a prod service hands an agent shell (prod keeps its overrides),
      // plus an ambient prod-port broker URL.
      const env: Record<string, string | undefined> = {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        OPENSCOUT_CLIENT_INSTANCE: "prod",
        OPENSCOUT_BROKER_PORT: "43110",
        OPENSCOUT_WEB_PORT: "43120",
        OPENSCOUT_BROKER_URL: "http://127.0.0.1:43110",
        OPENSCOUT_INSTANCE_REGISTRY: join(checkout.root, "registry"),
        // A prod service always carries its runtime dir; dev must not run it.
        OPENSCOUT_RUNTIME_PACKAGE_DIR: "/opt/prod/@openscout/scout",
        OPENSCOUT_INSTANCE_ROOT: undefined,
      };
      const setup = resolveDevInstanceSetup({ packageDirectory: checkout.web, env });
      expect(setup.error).toBeUndefined();
      expect(setup.checkoutInstanceDefault).toBe("dev");
      expect(setup.instance.name).toBe("dev");
      expect(setup.brokerPort).toBe(24400);
      expect(setup.brokerUrl).toBe("http://127.0.0.1:24400");
      expect(setup.explicitWebPort).toBe(24410);
      expect(setup.explicitPairingPort).toBe(24420);
      expect(env.OPENSCOUT_BROKER_URL).toBeUndefined();
      expect(env.OPENSCOUT_RUNTIME_PACKAGE_DIR).toBeUndefined();
    } finally {
      rmSync(join(checkout.root, ".."), { recursive: true, force: true });
    }
  });

  test("an explicit OPENSCOUT_INSTANCE=prod keeps the legacy behaviour and env overrides", () => {
    const checkout = fakeCheckout();
    try {
      const env: Record<string, string | undefined> = {
        PATH: process.env.PATH,
        OPENSCOUT_INSTANCE: "prod",
        OPENSCOUT_BROKER_PORT: "45001",
        OPENSCOUT_WEB_PORT: "45011",
      };
      const setup = resolveDevInstanceSetup({ packageDirectory: checkout.web, env });
      expect(setup.instance.name).toBe("prod");
      expect(setup.brokerPort).toBe(45001);
      expect(setup.explicitWebPort).toBe(45011);
    } finally {
      rmSync(join(checkout.root, ".."), { recursive: true, force: true });
    }
  });

  test("--port does not apply to a non-prod instance", () => {
    const checkout = fakeCheckout();
    try {
      const env: Record<string, string | undefined> = { PATH: process.env.PATH, OPENSCOUT_INSTANCE: "dev" };
      expect(resolveDevInstanceSetup({ packageDirectory: checkout.web, flags: { port: "43120" }, env }).error)
        .toContain("do not apply");
    } finally {
      rmSync(join(checkout.root, ".."), { recursive: true, force: true });
    }
  });
});

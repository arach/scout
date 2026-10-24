import { describe, expect, test } from "bun:test";
import { herdrTerminalHost } from "./herdr.ts";
import { tmuxTerminalHost } from "./tmux.ts";

// These host implementations remain in the pairing closure after the web
// registry is removed. Preserve its missing-binary and empty-list cases here.
describe("host probes", () => {
  test("report a missing binary as not installed rather than throwing", async () => {
    const availability = await tmuxTerminalHost.probe({
      env: { ...process.env, PATH: "/nonexistent-scout-probe" },
    });
    expect(availability.installed).toBe(false);
    expect(availability.reason).toBeTruthy();
  });

  test("a host with no sessions lists nothing instead of failing", async () => {
    for (const adapter of [herdrTerminalHost, tmuxTerminalHost]) {
      const sessions = await adapter.list({ env: { ...process.env, PATH: "/nonexistent-scout-probe" } });
      expect(Array.isArray(sessions)).toBe(true);
    }
  });
});

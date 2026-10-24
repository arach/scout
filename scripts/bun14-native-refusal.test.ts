import { expect, test } from "bun:test";
import { supportedBunVersion } from "../packages/runtime/bin/bun-preflight.mjs";
import { currentExtensionChannelCoordinate } from "../packages/runtime/src/extension-channel-qualification.ts";
import { allocateExtensionChannel } from "../packages/runtime/src/extension-channel-host.ts";
import { directChildCapability, carrierChildCapability } from "../packages/runtime/src/supervision-handoff/child-custody.ts";
import { scoutExtensionContextBackend } from "../packages/cli/src/cli/extension-context-host.ts";

test("Bun 1.4 migration does not silently qualify revision-pinned native backends", () => {
  expect(supportedBunVersion(Bun.version)).toBe(true);
  expect(currentExtensionChannelCoordinate()).toBeNull();
  expect(scoutExtensionContextBackend()).toBe(false);
  expect(directChildCapability()).toEqual({ available: false, reason: "child_custody_backend_unproven" });
  expect(carrierChildCapability()).toEqual({ available: false, reason: "child_custody_backend_unproven" });
  for (const form of ["context", "credential"] as const) {
    expect(() => allocateExtensionChannel(form)).toThrow("extension_channel_host_unavailable");
  }
});

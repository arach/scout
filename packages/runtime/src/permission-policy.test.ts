import { describe, expect, test } from "bun:test";

import { compileCodexPermissionProfile, isolatedCodexPermissionMetadata } from "./permission-policy.js";

describe("permission policy", () => {
  test("keeps legacy Codex posture unless a profile is requested", () => {
    expect(compileCodexPermissionProfile(undefined)).toMatchObject({
      profile: "trusted_local",
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      enforcement: "native",
    });
  });

  test("compiles Scout profiles into native Codex thread parameters", () => {
    expect(compileCodexPermissionProfile("observe")).toMatchObject({
      approvalPolicy: "on-request",
      sandbox: "read-only",
      enforcement: "native",
    });
    expect(compileCodexPermissionProfile("workspace_write")).toMatchObject({
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
      enforcement: "native",
    });
  });
});


describe("isolated Codex permission inheritance", () => {
  const base = { harness: "codex", metadata: { permissionProfile: "observe", approvalPolicy: "on-request", sandbox: "read-only", threadId: "do-not-inherit" } };
  test("keeps read-only approval policy when placement or model creates an isolated session", () => {
    expect(isolatedCodexPermissionMetadata("codex", base)).toEqual({ permissionProfile: "observe", approvalPolicy: "on-request", sandbox: "read-only" });
  });
  test("compiles an explicitly requested profile", () => {
    expect(isolatedCodexPermissionMetadata("codex", base, "workspace_write")).toMatchObject({ permissionProfile: "workspace_write", approvalPolicy: "on-request", sandbox: "workspace-write" });
  });
  test("does not transfer a different harness's metadata", () => {
    expect(isolatedCodexPermissionMetadata("claude", base)).toEqual({});
    expect(isolatedCodexPermissionMetadata("codex", { ...base, harness: "claude" })).toEqual({});
  });
});
